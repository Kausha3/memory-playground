"use client";

import { useState } from "react";
import {
  EMPTY,
  PREDICATE_LABEL,
  remember,
  query,
  subjects,
  currentFor,
  historyFor,
  mentions,
  type MemState,
  type Constraint,
  type QueryResult,
} from "@/lib/memory";

const FACT_EXAMPLES = [
  "Priya works at Stripe.",
  "Priya now works at Acme.",
  "Marcus lives in Boston.",
  "Marcus moved to Seattle.",
  "Dana is a designer.",
  "Dana is now a product manager.",
];

const QUERY_EXAMPLES = ["Where does Priya work?", "Where does Marcus live?", "What is Dana's role?"];

function windowLabel(c: Constraint): string {
  return c.untilStep === null ? `#${c.fromStep} → now` : `#${c.fromStep} → #${c.untilStep}`;
}

export default function Home() {
  const [mem, setMem] = useState<MemState>(EMPTY);
  const [input, setInput] = useState("");
  const [question, setQuestion] = useState("");
  const [result, setResult] = useState<QueryResult | null>(null);

  function doRemember(text: string) {
    const t = text.trim();
    if (!t) return;
    setMem((m) => remember(m, t).state);
    setInput("");
    setResult(null);
  }

  function doQuery(text: string) {
    const t = text.trim();
    if (!t) return;
    setQuestion(t);
    setResult(query(mem, t));
  }

  const people = subjects(mem);

  return (
    <main className="mx-auto max-w-5xl px-5 py-10 sm:py-14">
      <header className="mb-10">
        <h1 className="text-3xl font-semibold tracking-tight text-neutral-900">Memory Playground</h1>
        <p className="mt-2 max-w-2xl text-neutral-600">
          Type facts about people. Watch a <span className="font-medium text-neutral-900">typed-constraint memory</span>{" "}
          extract them, and <span className="font-medium text-emerald-700">retract stale ones</span> when they change —
          instead of letting an out-of-date fact silently win. Runs entirely in your browser.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* Left: input + timeline + query */}
        <section className="space-y-6">
          <div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doRemember(input);
              }}
              className="flex gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="e.g. Priya now works at Acme."
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <button
                type="submit"
                className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-700"
              >
                Remember
              </button>
            </form>

            <div className="mt-3 flex flex-wrap gap-2">
              {FACT_EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => doRemember(ex)}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">Timeline</h2>
              {mem.episodes.length > 0 && (
                <button
                  onClick={() => {
                    setMem(EMPTY);
                    setResult(null);
                  }}
                  className="text-xs text-neutral-400 hover:text-neutral-700"
                >
                  reset
                </button>
              )}
            </div>
            {mem.episodes.length === 0 ? (
              <p className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-400">
                Nothing remembered yet. Click an example above.
              </p>
            ) : (
              <ol className="space-y-1.5">
                {mem.episodes.map((e) => (
                  <li key={e.step} className="flex gap-2 text-sm text-neutral-700">
                    <span className="select-none font-mono text-xs text-neutral-400">#{e.step}</span>
                    <span>{e.text}</span>
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Ask</h2>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                doQuery(question);
              }}
              className="flex gap-2"
            >
              <input
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="Where does Priya work?"
                className="flex-1 rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm outline-none focus:border-neutral-900"
              />
              <button
                type="submit"
                className="rounded-md border border-neutral-900 px-4 py-2 text-sm font-medium text-neutral-900 hover:bg-neutral-900 hover:text-white"
              >
                Ask
              </button>
            </form>
            <div className="mt-3 flex flex-wrap gap-2">
              {QUERY_EXAMPLES.map((q) => (
                <button
                  key={q}
                  onClick={() => doQuery(q)}
                  className="rounded-full border border-neutral-200 bg-neutral-50 px-3 py-1 text-xs text-neutral-600 hover:border-neutral-400 hover:text-neutral-900"
                >
                  {q}
                </button>
              ))}
            </div>

            {result && (
              <div className="mt-4 rounded-md border border-neutral-200 bg-white p-4">
                <p className="text-sm text-neutral-900">
                  <span className="font-mono text-emerald-700">{result.answer}</span>
                </p>
                <p className="mt-1 text-xs text-neutral-500">
                  {result.viaConstraint
                    ? "answered from the current typed constraint (stale value excluded)"
                    : "no matching constraint — fell back to keyword search over raw text"}
                </p>
              </div>
            )}
          </div>
        </section>

        {/* Right: memory state */}
        <section>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-neutral-500">Memory</h2>
          {people.length === 0 ? (
            <p className="rounded-md border border-dashed border-neutral-200 px-3 py-6 text-center text-sm text-neutral-400">
              Extracted facts will appear here, grouped by person.
            </p>
          ) : (
            <div className="space-y-4">
              {people.map((person) => {
                const current = currentFor(mem, person);
                const history = historyFor(mem, person);
                const retracted = history.filter((c) => c.untilStep !== null);
                return (
                  <div key={person} className="rounded-lg border border-neutral-200 bg-white p-4">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-semibold text-neutral-900">{person}</h3>
                      <span className="text-xs text-neutral-400">
                        {mentions(mem, person)} mention{mentions(mem, person) === 1 ? "" : "s"}
                      </span>
                    </div>

                    <ul className="mt-3 space-y-1.5">
                      {current.map((c) => (
                        <li key={c.id} className="flex items-center gap-2 text-sm">
                          <span className="text-neutral-500">{PREDICATE_LABEL[c.predicate]}:</span>
                          <span className="font-mono text-neutral-900">{c.value}</span>
                          <span className="font-mono text-[10px] text-neutral-300">{windowLabel(c)}</span>
                        </li>
                      ))}
                    </ul>

                    {retracted.length > 0 && (
                      <div className="mt-3 border-t border-neutral-100 pt-3">
                        <p className="mb-1 text-[10px] font-medium uppercase tracking-wide text-neutral-400">
                          retracted (kept, not overwritten)
                        </p>
                        <ul className="space-y-1">
                          {retracted.map((c) => (
                            <li key={c.id} className="flex items-center gap-2 text-sm">
                              <span className="text-neutral-400">{PREDICATE_LABEL[c.predicate]}:</span>
                              <span className="font-mono text-neutral-400 line-through">{c.value}</span>
                              <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700">
                                {windowLabel(c)}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <footer className="mt-14 border-t border-neutral-100 pt-6 text-sm text-neutral-500">
        <p>
          Rule-based extraction for the demo; the same retraction semantics power the research. Part of a line of work on
          agent memory by{" "}
          <a href="https://github.com/Kausha3" className="text-neutral-900 underline hover:text-emerald-700">
            Kausha Trivedi
          </a>
          .
        </p>
        <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
          <a href="https://github.com/Kausha3/agent-memory-bench" className="underline hover:text-emerald-700">
            agent-memory-bench
          </a>
          <a href="https://github.com/Kausha3/kith" className="underline hover:text-emerald-700">
            kith
          </a>
          <a href="https://github.com/Kausha3/ccc-typed-constraint-memory" className="underline hover:text-emerald-700">
            ccc-typed-constraint-memory
          </a>
        </p>
      </footer>
    </main>
  );
}
