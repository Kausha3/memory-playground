# Memory Playground

[![CI](https://github.com/Kausha3/memory-playground/actions/workflows/ci.yml/badge.svg)](https://github.com/Kausha3/memory-playground/actions/workflows/ci.yml)

**An interactive demo of agent memory that stays correct over time.** Type facts about
people and watch a typed-constraint memory extract them and **retract stale ones** when
they change — instead of letting an out-of-date fact silently win.

▶︎ **Live:** **https://memory-playground-kausha-trivedis-projects.vercel.app**

```
Type:  "Priya works at Stripe."
Type:  "Priya now works at Acme."

Memory →  Priya — works at: Acme
          retracted:  works at: Stripe   [#1 → #2]

Ask:   "Where does Priya work?"  →  "Acme"   (the stale value is never surfaced)
```

## Why this exists

Most "agent memory" is a store of statements with similarity search bolted on. That
breaks the moment a fact changes: the old value still matches the query, so the agent
confidently cites a job, address, or preference the user updated months ago.

This playground demonstrates the alternative used in my research: model each fact as a
**typed constraint with a validity window**. When a new value arrives, the old one's
window is *closed*, not overwritten — so the history survives, the current answer is
correct, and a downstream agent can reason about the *change* ("congrats on the new
role") instead of asserting something stale.

## How it works

- **`lib/memory.ts`** — the whole engine: rule-based extraction into typed
  `(subject, predicate, value)` constraints, retraction on update, and query answering.
  It runs **entirely in the browser** — no backend, no API key.
- **`app/page.tsx`** — the UI: a timeline of what you said, the live memory grouped by
  person (current facts plus retracted ones, kept and labeled), and an ask box.

Extraction here is rule-based so the demo is free and instant. The research
([agent-memory-bench](https://github.com/Kausha3/agent-memory-bench),
[kith](https://github.com/Kausha3/kith),
[ccc-typed-constraint-memory](https://github.com/Kausha3/ccc-typed-constraint-memory))
uses model-backed extraction; the memory semantics are identical.

## Run locally

```bash
npm install
npm run dev      # http://localhost:3000
npm test         # engine tests (retraction, collision, fallback) — offline
npm run build    # static production build
```

## Deploy

Static output — deploys anywhere. One click on Vercel: import the repo, no environment
variables required.

## License

MIT
