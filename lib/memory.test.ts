// Tests for the in-browser memory engine. Runs offline: node --import tsx --test.

import { test } from "node:test";
import assert from "node:assert/strict";
import { EMPTY, remember, query, currentFor, historyFor, subjects } from "./memory.ts";

test("a new value retracts the old one instead of overwriting it", () => {
  let s = EMPTY;
  s = remember(s, "Priya works at Stripe.").state;
  s = remember(s, "Priya now works at Acme.").state;

  const current = currentFor(s, "Priya");
  assert.equal(current.length, 1);
  assert.equal(current[0]!.value, "acme");

  const retracted = historyFor(s, "Priya").filter((c) => c.untilStep !== null);
  assert.equal(retracted.length, 1);
  assert.equal(retracted[0]!.value, "stripe");
  assert.equal(retracted[0]!.untilStep, 2, "old value closes at the step the new one began");
});

test("a query answers from the current constraint and excludes the stale value", () => {
  let s = EMPTY;
  s = remember(s, "Priya works at Stripe.").state;
  s = remember(s, "Priya now works at Acme.").state;

  const r = query(s, "Where does Priya work?");
  assert.equal(r.viaConstraint, true);
  assert.equal(r.answer, "acme");
  assert.ok(!r.answer.includes("stripe"));
});

test("two people with the same first name stay distinct", () => {
  let s = EMPTY;
  s = remember(s, "Priya Patel works at Google.").state;
  s = remember(s, "Priya Sharma works at Stripe.").state;

  assert.deepEqual(subjects(s).sort(), ["Priya Patel", "Priya Sharma"]);
  assert.equal(query(s, "Where does Priya Patel work?").answer, "google");
});

test("an unknown question falls back to keyword search, flagged as such", () => {
  let s = EMPTY;
  s = remember(s, "The afterparty was on the rooftop.").state;
  const r = query(s, "Where was the afterparty?");
  assert.equal(r.viaConstraint, false);
  assert.match(r.answer, /rooftop/);
});

test("multi-valued interests accumulate rather than retract", () => {
  let s = EMPTY;
  s = remember(s, "Dana is interested in memory systems.").state;
  s = remember(s, "Dana is interested in distributed tracing.").state;
  assert.equal(currentFor(s, "Dana").filter((c) => c.predicate === "interested_in").length, 2);
});
