# 01 — Goal and scope (as established in-session)

## Goal

Give Pi a set of tools to **programmatically create intelligent slices of the live
session's history without loading large histories into context**, so Pi can
intelligently pass session slices to subagents or write them to files.
(User prompt, session 1 line 34.)

## Settled product model (end of session 1)

- A **Session Slice** is a durable, **exact extraction** of selected material from the
  **active** Pi session — a *slice*, not a summary or interpretation.
- Selection: Pi states intent → extension resolves to **exact message/entry IDs**
  **programmatically** (agent says "the following message_ids — copy them over";
  no token burning on the copy step).
- Selection intents: **topic-based** ("discussion about X", needs relevance judgment)
  and **positional** ("first/last N turns", exact, no judgment).
- Payload modes: `conversation` (human↔assistant text only) / `filtered`
  (conversation + selectively retained tool/subagent material) / `all`
  (all substantive material in selected turns; heavily stripped — see 03/Q10).
- **Turn = user-anchored exchange**: one user message + all subsequent
  assistant/tool activity until the next user message.
- Projection: **raw active branch**; **ignore compaction rounds and branch summaries**.
- Artifact: **single JSONL file under `/tmp`**; downstream subagent receives
  **only the file path** and reads it itself (no inline fallback, no reference/copy split).
- Return to Pi: **file path only** (lowest token cost).
- Privacy default: **no opt-in, no confirmation ceremony** — slices are the user's
  own session history for reuse. ("Keep it simple — none of this security theatre.")

## Non-goals (explicit)

- **Replayability is an absolute non-goal.** Transferring semantic context is the only
  goal. The slice must not look like a replayable Pi session log (hence normalized
  slice records over verbatim raw entries — decision C, heavily stripped).
- No recap/summary generation in the slice path.
- No thinking-token retention, no tool-call blocks, no metadata
  (timestamps, model names, tokens, IDs, reasons), no subagent-management plumbing.
- No workaround for bad topic retrieval — if retrieval doesn't work under evals,
  the extension is useless; failure mode must be proven, not papered over.

## What this is not (later `exp/` mapping work is separate)

The `exp/` session-map work (Gemini/Codex wire-vs-disk HTML maps, `generate.mjs`,
`capture-note.md`) came **after** these sessions (Oct 4–5) and is documented
separately. It is not reconstructed here beyond pointers in 06.
