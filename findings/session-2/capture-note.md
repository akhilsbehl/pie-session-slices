# Capture note — session-log ↔ LLM-context mapping (2026-10-04/05)

Intended reader: another agent picking up follow-on work. Prior context: `session-map-notes.md`
(first session's takeaways); the two HTML maps; `generate.mjs`; `/tmp/session-maps/` evidence.

## 1. Goal

Understand exactly how pi's on-disk session logs map to the true context an LLM decodes on —
what is file-only bookkeeping vs. what crosses the wire and why — plus size proportions
(disk bytes vs. wire bytes). Deliverable was a visual turn-by-turn A/B in HTML, built **only**
by composing pi's shipped `dist` code (no reimplemented logic), re-runnable on any session file.

## 2. What we did (in order)

1. **Traced the full call stack** in pi v1.0.2 (`~/.pi/agent/install/releases/1.0.2/...`):
   `session-manager.js: loadEntriesFromFile → buildSessionProjection → sessionEntryToContextMessages`
   → `messages.js: convertToLlm` (= `Agent.convertToLlm`, wired in `agent-session.js`)
   → `pi-agent-core/agent-loop.js: streamAssistantResponse` → `transcript.js: normalizeContext →
   resolveTranscript` → `transform-messages.js: transformMessages` →
   `openai-responses-shared.js: convertResponsesMessages` → `POST /v1/responses`.
2. **Built `generate.mjs`** (in this dir): imports those modules, and for each assistant message
   computes the exact wire request that produced it (prefix projection → LLM msgs → Responses
   items), plus per-turn disk bytes, deltas, and global ratios. One emulation target only:
   `openai/gpt-4.1` (`openai-responses` API). Usage: `node generate.mjs <session.jsonl>`.
   Later generalized to data-driven labels (in-file models, role counts) so any session works.
3. **Session 1** (`019ffaac`, 196 lines / 441,808 B, `google/gemini-flash-latest`, 95 assistants):
   produced `session-map-019ffaac.html`; verified via 5 code-level spot checks + agent-browser
   screenshots; opened in `$BROWSER`; notes reviewed in richie (poll still background-pending).
4. **Session 2 hunt**: scanned all 1,513 session files. Finding: **no session uses provider
   `openai` directly** — OpenAI models run via `openai-codex` (833 files). Within 50–80 messages,
   picked `01a0bbf8` (60 lines / 92,693 B, `openai-codex/gpt-5.6-terra` only, 28 assistants,
   1 persisted system line): produced `session-map-01a0bbf8.html`, opened in `$BROWSER`.
5. **Answered follow-ups** from the data (thinking tokens, thoughtSignatures, empty text) —
   see §4. All claims verified against `dist` sources, not inferred.

## 3. Key numbers (transcript-only wire; system prompt/tools excluded)

| | S1 (Gemini, 95 calls) | S2 (Codex terra, 28 calls) |
|---|---|---|
| Disk | 441,808 B | 92,693 B |
| Final request wire | 297,864 B (67%) | 29,554 B (32%) |
| Sum of all requests (resent each turn) | 15,638,416 B (~35×) | 675,491 B (~7.3×) |
| Reasoning tokens | 13,997 (~40% of output, $2.13 total) | 0 (`thinkingLevel: off`) |
| On-disk system lines | 0 | 1 (53.9 KB snapshot → wire item #0) |

## 4. What we learned (load-bearing for next work)

- **File ≠ prompt.** Disk is a durability log; every request replays the leaf path through the
  projection pipeline and re-sends the whole transcript (O(n²) wire amplification is expected).
- **Dropped on the wire**: `timestamp`, `responseId`, `usage/cost`, `provider/api/model`,
  `stopReason`, `thoughtSignature`/`thinkingSignature` (unless same provider+api+model),
  `isError`, `toolName` on outputs; `model_change`/`thinking_level_change`/`custom(state)`
  project to **zero** messages.
- **System prompt is runtime-built** (`_rebuildSystemPrompt`/`_preparePromptAndToolLoadout`
  from skills/context-files/tools) and usually absent from disk — except S2-style persisted
  system snapshots (content + `sections` + `toolsAdded`), which do ride the wire.
- **Thinking has two incompatible shapes**: Gemini = unsigned plain-text `thinking` blocks
  (replayable anywhere; become `output_text` cross-model) + *signed* tool calls; OpenAI
  Responses = encrypted `reasoning_details` via `thinkingSignature` (same-model only).
  `thoughtSignature` = Google's tamper-seal binding a tool call to its reasoning; required
  back on replay, deleted cross-model.
- **Empty `text:""`** (92/95 S1 assistants): structural placeholder meaning "model said nothing
  to the user this turn, only tool calls" — renders nothing, costs ~nothing (Completions path
  filters it; Responses sends an empty item).
- **Orphan healing**: `transformMessages` synthesizes `"No result provided"` tool-results and
  skips `error/aborted` assistants — replay is self-healing, not verbatim.
- **Tool IDs**: native Codex `call_id|item_id` pairs are normalized per target (`fc_<hash>`
  rebuilds for foreign APIs).

## 5. Reuse pointers

- Generator + maps: this dir (`generate.mjs`, `session-map-*.html`).
- Ephemeral evidence (regenerates per run; currently S2's): `/tmp/session-maps/evidence.json`,
  `wire-final.json`, preview PNGs.
- To emulate a different model (e.g. same-model Codex replay preserving reasoning), change
  `openaiModel` in `generate.mjs` — everything downstream already flows through pi's functions.
- Watch for hardcoded strings if extending the HTML (two were caught: counts line, "95
  responses" note) — keep new labels data-driven.
