// Adversarial tests: inputs designed to break the engine, plus documented limits.
// Run offline: node --import tsx --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, remember, query, extract, currentFor, historyFor, subjects } from "./memory.ts";

test("empty and whitespace input does not crash and extracts nothing", () => {
  let s = EMPTY;
  s = remember(s, "").state;
  s = remember(s, "   ").state;
  assert.equal(subjects(s).length, 0);
  assert.equal(s.episodes.length, 2); // still recorded on the timeline
});

test("symbol/script input is inert: no facts, no memory card, stored verbatim", () => {
  const ex = extract("<script>alert(1)</script>");
  assert.equal(ex.facts.length, 0, "no predicate matched → no facts");
  let s = EMPTY;
  s = remember(s, "<script>alert(1)</script>").state;
  assert.equal(subjects(s).length, 0, "no constraints → nothing rendered as a memory card");
  assert.equal(s.episodes[0]!.text, "<script>alert(1)</script>"); // React escapes this on render
});

test("lowercase-initial names ARE extracted (subject found by verb boundary, canonicalized)", () => {
  const ex = extract("priya works at stripe");
  assert.equal(ex.subject, "Priya", "subject is found despite lowercase, and title-cased for display");
  assert.equal(ex.facts.find((f) => f.predicate === "works_at")?.value, "stripe");
});

test("lowercase works across predicates and multi-word entities", () => {
  assert.equal(extract("marcus moved to seattle").subject, "Marcus");
  assert.equal(extract("marcus moved to seattle").facts[0]!.value, "seattle");
  assert.equal(extract("acme labs is headquartered in denver").subject, "Acme Labs");
});

test("a lowercase update retracts the prior value and dedups to one canonical subject", () => {
  let s = EMPTY;
  s = remember(s, "priya works at stripe").state; // lowercase
  s = remember(s, "Priya now works at Acme.").state; // mixed case, same person
  assert.equal(subjects(s).length, 1, "case variants collapse to one subject");
  assert.equal(currentFor(s, "Priya")[0]!.value, "acme");
  assert.equal(historyFor(s, "Priya").filter((c) => c.untilStep !== null)[0]!.value, "stripe");
});

test("verb-first input has no subject (no junk 'Works' card)", () => {
  assert.equal(extract("works at google").subject, null);
  assert.equal(extract("send me reminders by email").subject, null);
});

test("a name that collides with an auxiliary verb still resolves (e.g. 'Will')", () => {
  const ex = extract("Will works at Google.");
  assert.equal(ex.subject, "Will");
  assert.equal(ex.facts[0]!.value, "google");
});

test("two facts in one sentence are both extracted", () => {
  const ex = extract("Priya works at Stripe and lives in Boston.");
  const preds = ex.facts.map((f) => f.predicate).sort();
  assert.deepEqual(preds, ["lives_in", "works_at"]);
  const works = ex.facts.find((f) => f.predicate === "works_at")!;
  assert.equal(works.value, "stripe", "value is truncated at ' and ', not 'stripe and lives...'");
});

test("re-asserting the same value is idempotent (no duplicate, no false retraction)", () => {
  let s = EMPTY;
  s = remember(s, "Priya works at Stripe.").state;
  s = remember(s, "Priya works at Stripe.").state;
  assert.equal(currentFor(s, "Priya").length, 1);
  assert.equal(historyFor(s, "Priya").length, 1);
});

test("a value can be reinstated after retraction with a fresh window", () => {
  let s = EMPTY;
  s = remember(s, "Priya works at Stripe.").state;
  s = remember(s, "Priya now works at Acme.").state;
  s = remember(s, "Priya is back at Stripe; she works at Stripe again.").state;
  const current = currentFor(s, "Priya");
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "stripe");
  assert.equal(historyFor(s, "Priya").length, 3);
});

test("a leading discourse marker resolves to the real subject (conflict case)", () => {
  let s = EMPTY;
  s = remember(s, "Omar works at Datadog.").state;
  s = remember(s, "Actually, Omar does not work at Datadog — he works at Snowflake.").state;
  const r = query(s, "Where does Omar work?");
  assert.equal(r.viaConstraint, true);
  assert.equal(r.answer, "snowflake");
  assert.ok(!r.answer.includes("datadog"));
});

test("same first name, different people stay distinct and case-insensitive in matching", () => {
  let s = EMPTY;
  s = remember(s, "Priya Patel works at Google.").state;
  s = remember(s, "Priya Sharma works at Stripe.").state;
  assert.equal(subjects(s).length, 2);
  assert.equal(query(s, "where does priya patel WORK?").answer, "google"); // mixed case query
});

test("query against empty memory returns the graceful default, flagged non-constraint", () => {
  const r = query(EMPTY, "Where does anyone work?");
  assert.equal(r.viaConstraint, false);
  assert.match(r.answer, /don't have anything/i);
});

test("query for an unknown person falls back, never inventing a constraint answer", () => {
  let s = EMPTY;
  s = remember(s, "Priya works at Stripe.").state;
  const r = query(s, "Where does Zoe work?");
  assert.equal(r.viaConstraint, false, "must not claim a typed answer for an unknown subject");
});

test("very long input does not throw", () => {
  const long = "Priya works at " + "x".repeat(5000) + ".";
  let s = EMPTY;
  assert.doesNotThrow(() => {
    s = remember(s, long).state;
  });
  assert.equal(currentFor(s, "Priya").length, 1);
});

test("retraction sets a correct, non-inverted window", () => {
  let s = EMPTY;
  s = remember(s, "Marcus lives in Boston.").state;
  s = remember(s, "Marcus moved to Seattle.").state;
  const boston = historyFor(s, "Marcus").find((c) => c.value === "boston")!;
  assert.equal(boston.fromStep, 1);
  assert.equal(boston.untilStep, 2);
  assert.ok(boston.untilStep! >= boston.fromStep, "window is never inverted");
});
