# 03 — Decisions (Richie grilling rounds + ASB's answers)

All question wordings live in `~/.richie/ephemeral/pie-session-slices-*.md`
(still on disk; `-commented` variants carry ASB's inline replies).
Verbatim ASB answers below come from the session log + commented files.

## Consumer R1 → decided

- **Q1 (first job): A and B.** Brief a helper + preserve a record (not C/re-orient, not D/all-three).
- **Q2 (who chooses): C.** Automatic selection, no approval screen. Rationale: omission
  errors riskier than inclusion errors — but frequent inclusion errors = poor package;
  subagent-frequency use means no review step.
- **Q3 (fidelity): A.** Exact excerpts only — a slice, not a summary. Token-cheap:
  agent names message IDs, rest is programmatic copy. No token burning.
- **Q4 (sensitivity): C.** No opt-in, no ceremony — own session history for reuse.
  "None of this security theatre."

## Consumer R2 (agent-drafted, user constrained)

Established: support briefing + saving; automatic; exact messages; no permission
ceremony. Principle: "you state intent; Pi identifies message IDs without rereading
the session." Open questions Q5–Q8 (ID vs landmark naming, reference-vs-copy,
inclusion bias, bookmark-vs-frozen) were **superseded by later developer decisions**:
landmarks unresolved; **reference-vs-copy resolved to path-only** (dev-R1 feedback);
inclusion bias kept as request-sensitive with small inclusion bias; durability
resolved to **frozen JSONL copy under `/tmp`**.

## Developer R1 → decided (ASB comments on `...-developer-round-1-commented.md`)

- Subagents receive **only the slice file path** and read it (no inline fallback).
- **Turn = user-anchored** ("Run tests"→"Tests passed" is one turn).
- Projection = **A: raw active branch; ignore compaction/branch summaries**.
- Artifact = **A: single JSONL file** (not Markdown, not directory bundle).
- Topic retrieval (Q1/mechanism: deterministic vs bounded-model-call vs progressive)
  **explicitly held**: "the crucial problem… I'll come back to this — I need
  in-session iteration to test if this works."

## Developer R2 → decided (ASB comments on `...-developer-round-2-commented.md`)

- Q5 (record schema): **eliminate all cruft** (headers, model changes, branch
  metadata, custom state, compaction, summaries). Principle: pass substantive
  information, not replay metadata. Exact wrapper design held for more testing.
- Q6 (conversation content): **A** — user messages + assistant visible text only.
- Q7 (disk index): **A — no disk index**, scan programmatically each request.
- Q8 (low confidence): **none of the options** — silent-superset/failover is a
  catastrophic failure mode that must be proven under evals. Agent gives best
  judgment; ASB decides if useful. "If this doesn't work well, the extension
  is useless. We don't work around this."

## Developer R3 → decided (ASB comments on `...-developer-round-3-commented.md`)

- Q9 (self-containment): **C, heavily stripped** — normalized slice records
  (`sourceEntryId/turnId/kind/payload`-shaped); replayability is an absolute non-goal,
  semantic context transfer only.
- Q10 (what `all` keeps): **B, heavily stripped** — only `type=message` with
  `role=user|assistant|toolResult` (skip tool calls); drop all metadata
  (timestamps, models, tokens, IDs, reasons); drop subagent-management material;
  keep main content in `payload`; drop thinking tokens. Commissioned the dual
  `oni` prototypes to ground this.
- Q11 (`filtered` evaluator): **`ask_jev` deferred** — "need to think more carefully"
  about state/questions design.
- Q12 (return contract): **A — file path only** (overrode recommended manifest B).

## Still-open decision threads (carried to 07)

1. Topic-retrieval mechanism (dev-R1/Q1) — the core unsolved problem.
2. Exact slice-record schema (dev-R2/Q5 wrapper vs verbatim+C) — needs testing.
3. "Substantive" tool-result inclusion contract (dev-R3/Q10) — needs testing.
4. `filtered`-mode evaluator design via `ask_jev` (dev-R3/Q11) — needs thought.
