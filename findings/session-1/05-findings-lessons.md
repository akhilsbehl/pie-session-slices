# 05 — Findings and lessons

## Technical findings (durable)

1. **Raw JSONL order ≠ model context.** Pi walks the active leaf→root path, applies
   latest-compaction retention + last-context-edit-wins, then converts
   extension-only roles. E5 measured 141/149 active-path entries — 8 off-path
   records a linear filter would wrongly keep.
2. **Use `buildSessionProjection()`, not jq, for entry selection.** jq is fine for
   final block filtering of already-projected data, never for tree/compaction/edit
   semantics (E4). jq regex suppression also false-positives on legit prose (E3).
3. **Model-visible ⊋ slice-visible.** `custom_message`, `bashExecution`, branch /
   compaction summaries all reach the model via `convertToLlm` but are deliberately
   excluded from semantic slices. Slice projection is narrower than Pi context —
   document the divergence, don't pretend equivalence.
4. **Subagent semantics need two extra roles.** Parent prompts live in `subagent`
   tool-call `arguments.task` (invisible to text-only filters); child results live
   in `subagent-notify` envelopes. `subagent_task` / `subagent_result` is the
   minimum coherent vocabulary (E5, 7+6 payloads byte-exact).
5. **Slice shape is settled in principle**: user-anchored turns; raw active branch;
   single stripped JSONL (`user` / `assistant-text` / substantive-`toolResult` /
   `subagent_task` / `subagent_result`); file-path-only handoff and return.
   ~69–85% byte reduction demonstrated twice.
6. **Thinking/tool-call/metadata exclusion is principled**, not just compression:
   replayability is a non-goal; only semantic narrative transfers.
7. **Feasibility is closed** (E1): source-only extension, `sessionManager` read APIs,
   `session_slice` tool + `/session-slice` command, subprocess handoff mirroring
   the shipped subagent example, user-agents-by-default trust boundary.

## Process lessons (from session 1's own friction)

- **Read the skill file before acting** (wayfinder episode, lines 26–33).
- **Don't delegate Richie-iteration mechanics** once told otherwise; keep grilling
  rounds direct (line 74).
- **Don't gate on stops the user didn't ask for** — lines 84–88 ("Why do you keep
  stopping…? You're still not starting") came from protocol-gating each round
  instead of flowing to the next applicable round.
- **Subagent status is unreliable**: setup run reported failure after succeeding;
  `failed` notify envelopes can carry substantive results (E5). Verify, don't trust
  status strings.
- **Name the envelope/contract risk early**: notify-envelope parsing and
  control-prose removal are session-specific observations, not versioned contracts
  — both need fixtures before becoming product code.

## Blind spots / hypotheses (flagged, not known)

- Whether topic retrieval can work at all at acceptable quality/cost — explicitly
  held for in-session iteration + evals; failure here kills the extension.
- Whether `ask_jev` is the right `filtered`-mode evaluator (state/questions
  undesigned).
- Whether "substantive toolResult" can be a deterministic rule or needs judgment
  per tool.
- Pi-version drift: all symbols pinned to the installed release at experiment
  time; re-verify against the current install before coding.
