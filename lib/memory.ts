// Typed-constraint memory engine, running entirely in the browser.
//
// This is the same idea behind kith and agent-memory-bench: instead of storing
// statements as opaque text, extract typed (subject, predicate, value) constraints and
// model time. When a new value arrives for a single-valued predicate, the old value is
// *retracted* (its validity window is closed) rather than overwritten — so the history
// stays correct and a stale fact never silently wins.
//
// Extraction here is rule-based so the playground needs no API key. The research uses
// model-backed extraction; the memory semantics are identical.

export type Predicate = "works_at" | "lives_in" | "role_is" | "hq_in" | "interested_in";

export const PREDICATE_LABEL: Record<Predicate, string> = {
  works_at: "works at",
  lives_in: "lives in",
  role_is: "role",
  hq_in: "HQ",
  interested_in: "interested in",
};

const SINGLE_VALUED: ReadonlySet<Predicate> = new Set<Predicate>([
  "works_at",
  "lives_in",
  "role_is",
  "hq_in",
]);

export interface Constraint {
  id: string;
  subject: string;
  predicate: Predicate;
  value: string;
  fromStep: number;
  untilStep: number | null; // null = still current
  sourceStep: number;
}

export interface Episode {
  step: number;
  text: string;
  subject: string | null;
}

export interface MemState {
  episodes: Episode[];
  constraints: Constraint[];
  step: number;
}

export const EMPTY: MemState = { episodes: [], constraints: [], step: 0 };

let idCounter = 0;
const nextId = () => `c${idCounter++}`;

// --- extraction -------------------------------------------------------------

function leadingSubject(text: string): string | null {
  const cleaned = text.replace(/^(actually|correction|note|update|fyi|reminder)[,:]?\s+/i, "");
  const m = cleaned.match(/^([A-Z][\w.]*(?:\s+[A-Z][\w.]*)*)/);
  return m ? m[1]!.trim() : null;
}

function cleanValue(raw: string): string {
  return raw
    .split(/\s+and\s+/)[0]!
    .replace(/[.,;:!?]+$/, "")
    .trim();
}

export interface Extracted {
  subject: string | null;
  facts: Array<{ predicate: Predicate; value: string }>;
}

export function extract(text: string): Extracted {
  const subject = leadingSubject(text);
  const facts: Extracted["facts"] = [];
  if (!subject) return { subject, facts };
  const lc = text.toLowerCase();

  const worksAt = lc.match(/(?:works at|joined) ([a-z0-9 .&-]+)/);
  const movedTo = lc.match(/(?:moved to|lives in|based in) ([a-z0-9 .&-]+)/);
  const roleIs = lc.match(/\bis (?:now )?(?:a|an) ([a-z0-9 .&-]+)/);
  const hqIn = lc.match(/headquartered in ([a-z0-9 .&-]+)/);
  const likes = lc.match(/(?:interested in|likes|into) ([a-z0-9 .&-]+)/);

  if (worksAt) facts.push({ predicate: "works_at", value: cleanValue(worksAt[1]!) });
  if (movedTo) facts.push({ predicate: "lives_in", value: cleanValue(movedTo[1]!) });
  if (roleIs) facts.push({ predicate: "role_is", value: cleanValue(roleIs[1]!) });
  if (hqIn) facts.push({ predicate: "hq_in", value: cleanValue(hqIn[1]!) });
  if (likes) facts.push({ predicate: "interested_in", value: cleanValue(likes[1]!) });

  return { subject, facts };
}

// --- core -------------------------------------------------------------------

/** Ingest a statement, returning the new state and which constraints it created. */
export function remember(state: MemState, text: string): { state: MemState; created: Constraint[] } {
  const step = state.step + 1;
  const { subject, facts } = extract(text);
  const constraints = state.constraints.map((c) => ({ ...c }));
  const created: Constraint[] = [];

  if (subject) {
    for (const fact of facts) {
      const current = constraints.filter(
        (c) => c.subject.toLowerCase() === subject.toLowerCase() && c.predicate === fact.predicate && c.untilStep === null,
      );
      if (current.some((c) => c.value.toLowerCase() === fact.value.toLowerCase())) continue; // idempotent

      if (SINGLE_VALUED.has(fact.predicate)) {
        for (const c of current) c.untilStep = step; // retract prior value(s)
      }
      const constraint: Constraint = {
        id: nextId(),
        subject,
        predicate: fact.predicate,
        value: fact.value,
        fromStep: step,
        untilStep: null,
        sourceStep: step,
      };
      constraints.push(constraint);
      created.push(constraint);
    }
  }

  return {
    state: {
      episodes: [...state.episodes, { step, text, subject }],
      constraints,
      step,
    },
    created,
  };
}

export function subjects(state: MemState): string[] {
  const seen = new Set<string>();
  const order: string[] = [];
  for (const c of state.constraints) {
    if (!seen.has(c.subject)) {
      seen.add(c.subject);
      order.push(c.subject);
    }
  }
  return order;
}

export function currentFor(state: MemState, subject: string): Constraint[] {
  return state.constraints.filter((c) => c.subject === subject && c.untilStep === null);
}

export function historyFor(state: MemState, subject: string): Constraint[] {
  return state.constraints.filter((c) => c.subject === subject);
}

export function mentions(state: MemState, subject: string): number {
  return state.episodes.filter((e) => e.subject?.toLowerCase() === subject.toLowerCase()).length;
}

// --- query ------------------------------------------------------------------

export interface QueryResult {
  answer: string;
  viaConstraint: boolean;
  constraint?: Constraint;
}

function parseIntent(question: string): { subject: string; predicate: Predicate } | null {
  const rules: Array<[RegExp, Predicate]> = [
    [/where does (.+?) work/i, "works_at"],
    [/where does (.+?) live/i, "lives_in"],
    [/where is (.+?) headquartered/i, "hq_in"],
    [/what is (.+?)'s role/i, "role_is"],
    [/what does (.+?) do\b/i, "role_is"],
    [/what is (.+?) interested in/i, "interested_in"],
  ];
  for (const [re, predicate] of rules) {
    const m = question.match(re);
    if (m) return { subject: m[1]!.replace(/'s$/, "").trim(), predicate };
  }
  return null;
}

export function query(state: MemState, question: string): QueryResult {
  const intent = parseIntent(question);
  if (intent) {
    const current = state.constraints.filter(
      (c) =>
        c.subject.toLowerCase() === intent.subject.toLowerCase() &&
        c.predicate === intent.predicate &&
        c.untilStep === null,
    );
    if (current.length > 0) {
      const value = current.map((c) => c.value).join(", ");
      return { answer: value, viaConstraint: true, constraint: current[current.length - 1] };
    }
  }
  // Fallback: most keyword-overlapping statement.
  const qWords = new Set(question.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter(Boolean));
  let best = "";
  let bestScore = 0;
  for (const e of state.episodes) {
    const words = new Set(e.text.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/));
    let score = 0;
    for (const w of qWords) if (words.has(w)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = e.text;
    }
  }
  return { answer: best || "I don't have anything on that yet.", viaConstraint: false };
}
