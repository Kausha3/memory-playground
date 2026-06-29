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

// Verbs / triggers that, as the FIRST word, mean there is no subject (e.g. "works at…",
// "send me…"). These can never be a name.
const PURE_TRIGGER = new Set([
  "works", "work", "lives", "live", "moved", "joined", "is", "are", "was", "were",
  "send", "switched", "relocated", "headquartered", "based", "interested", "likes",
  "into", "has", "have", "does", "do", "did",
]);

// Words that END the subject: the predicate/verb/aux begins here. Subject is everything
// before the first of these. Lets us find the subject without relying on capitalization.
const SUBJECT_END = new Set([
  ...PURE_TRIGGER,
  "worked", "lived", "moving", "joins", "be", "been", "being", "had", "will", "would",
  "can", "could", "now", "recently", "currently", "still", "also", "just", "then",
  "again", "no", "not", "never", "prefers", "prefer", "left", "runs", "leads",
  "founded", "heads", "and", "who",
]);

const bare = (tok: string) => tok.toLowerCase().replace(/[^a-z0-9']/g, "");
const cap = (tok: string) => {
  const t = tok.replace(/[.,;:!?]+$/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
};

/**
 * Extract the subject as the leading run of words up to the first verb/trigger. Works
 * for "Priya works at Stripe", "priya works at stripe", "Acme Labs is headquartered…",
 * and "Actually, Omar does not work at…". Canonicalizes case so display stays clean.
 */
function leadingSubject(text: string): string | null {
  const cleaned = text.replace(/^(actually|correction|note|update|fyi|reminder)[,:]?\s+/i, "").trim();
  if (!cleaned) return null;

  const tokens = cleaned.split(/\s+/);
  if (PURE_TRIGGER.has(bare(tokens[0]!))) return null; // starts with a verb → no subject

  const subjectTokens: string[] = [cap(tokens[0]!)];
  for (let i = 1; i < tokens.length && subjectTokens.length < 4; i++) {
    if (SUBJECT_END.has(bare(tokens[i]!))) break;
    subjectTokens.push(cap(tokens[i]!));
  }
  return subjectTokens.join(" ");
}

// Trailing adverbs that regularly leak into a captured value ("works at Stripe again").
const TRAILING_FILLER = new Set([
  "again", "now", "currently", "too", "also", "anymore", "instead", "today", "then", "still",
]);

function cleanValue(raw: string): string {
  const v = raw
    .split(/\s+and\s+/)[0]! // "Acme and ..." -> "Acme"
    .replace(/[.,;:!?]+$/, "")
    .trim();
  const words = v.split(/\s+/);
  while (words.length > 1 && TRAILING_FILLER.has(words[words.length - 1]!.toLowerCase())) {
    words.pop();
  }
  return words.join(" ");
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
