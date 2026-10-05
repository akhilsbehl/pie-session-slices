# 07 — Open questions and next steps

## Open design questions (in priority order)

1. **Topic retrieval mechanism** (dev-R1/Q1, explicitly held). Candidates: (a)
   deterministic metadata/text search; (b) one bounded model call over a compact
   index emitting IDs only; (c) progressive lexical-prefilter + bounded call.
   ASB wants **in-session iteration** to test whether it works before locking.
2. **Exact slice-record schema** (dev-R2/Q5). Direction: normalized, heavily
   stripped records (`sourceEntryId/turnId/kind/payload`-shaped), replayability
   explicitly disclaimed. Needs testing against real sessions (branching,
   compaction, context edits, malformed envelopes, mixed content).
3. **"Substantive" inclusion contract** (dev-R3/Q10). What stays: user text,
   assistant visible text, substantive toolResult text, parent task prompts, final
   child results. What needs a rule: per-tool allow/deny, failed-vs-noisy results,
   write-receipt retention, image/thinking markers, secret handling (currently none).
4. **`filtered`-mode evaluator via `ask_jev`** (dev-R3/Q11). State/questions
   undesigned — think carefully before building.
5. **Versioned classifier interface + fixtures**: `subagent` task calls,
   `subagent-notify` envelopes (per runtime/version), control-prose cases,
   false-positive/negative sets. E5's parsing is session-specific until fixtured.

## Concrete resume actions

1. Switch the submodule checkout to a named child branch (per `AGENTS.md`
   submodule guidance) before any edit; keep parent pin updates separate.
2. Re-verify E1/E4 symbols against the **currently installed** Pi release
   (experiments pinned to the September install paths).
3. Rebuild the E5 pi-aware projection as a checked-in script (not `/tmp`) and
   re-run it on the session-1 file to confirm the 46-record / ~69% baseline.
4. Run the held topic-retrieval iteration: pick 2–3 real topics in a live session,
   test candidate mechanisms, record precision/failure honestly — no silent
   superset fallback (per dev-R2/Q8: failure must be proven under evals).
5. Draft the slice-record schema + substantive-inclusion fixtures; only then
   scaffold the source-only extension (`session_slice` tool + `/session-slice`
   command per E1's MVP).

## Suggested first prompt (after reading this folder + `artifacts/`)

> Rebuild the pi-aware semantic projection from `artifacts/pi-aware-semantic-slice-prototype.md`
> as a checked-in script, run it against the session-1 JSONL, and confirm parity
> with the reported 46 records before we touch topic retrieval.
