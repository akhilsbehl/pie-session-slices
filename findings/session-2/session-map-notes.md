# Session log ↔ LLM context — notes for `session-map-019ffaac.html`

Session: `019ffaac-373a-7661-b332-c539269d210a` (196 lines, 441,808 B)
In-file model: `google/gemini-flash-latest` · Emulated wire: **`openai/gpt-4.1`** (`openai-responses` → `POST https://api.openai.com/v1/responses`) · pi v1.0.2

## 1. The one-paragraph answer

The file is a **durability log**, not the prompt. On every one of the 95 LLM calls pi replays the
leaf path through `buildSessionProjection()` → `convertToLlm()` → `normalizeContext()` →
`transformMessages()` → `convertResponsesMessages()`, stripping all bookkeeping and re-encoding
only language + tool-calls + tool-outputs as OpenAI Responses items. Result for this session
(transcript only, **excluding** the runtime system prompt + tool schemas, which are never on disk):

| measure | bytes | meaning |
|---|---|---|
| on disk (file) | 441,808 | everything, incl. 95 responses' metadata |
| final transcript as wire items | 297,864 (67.4% of disk) | what the last call's body carries |
| sum of all 95 request bodies | 15,638,416 (≈ 35.4× disk) | what actually drove cost/latency — the transcript is **resent every turn** |

Real requests are larger than both wire counts: the runtime-built **system prompt + tool
definitions** (skills, context files, tool snippets) are prepended to *every* request and exist
nowhere in the file.

## 2. What maps to what (and what is dropped)

- **Kept:** user text → `input_text`; assistant thinking → plain `output_text` (cross-model rule —
  a Gemini `thoughtSignature` is not OpenAI JSON reasoning, so it cannot be replayed as reasoning);
  assistant text → `output_text`; toolCall `{id,name,arguments}` → `function_call{call_id,…}`;
  toolResult text → `function_call_output{call_id,output}`.
- **Dropped on the wire:** `timestamp`, `responseId`, `usage{input,output,cacheRead,cacheWrite,
  reasoning,totalTokens,cost}`, `provider/api/model`, `stopReason/rawStopReason`,
  `thoughtSignature`, `isError` (not encoded), `toolName` on outputs, empty `text:""` nuances.
- **Zero-message entries:** `model_change` ×3, `thinking_level_change` ×1,
  `custom:background-tasks-state` ×1 — settings/state only. Verified: projection of `d9ae6bcd`
  yields 0 messages; leaf `custom` entry contributes 0 messages (195 entries → 190 messages
  = 3 user + 95 assistant + 92 toolResult).
- **Absent from disk, present on wire:** the leading system/developer message. It is rebuilt each
  run by `AgentSession._rebuildSystemPrompt/_preparePromptAndToolLoadout` and travels only in
  `agent.state.messages` (see §3). This session stores **zero** system lines.
- **Provider quirk worth knowing:** `transformMessages` synthesises `"No result provided"`
  tool-results for orphaned calls and skips `stopReason:error/aborted` assistants — replay is
  self-healing, not verbatim.

## 3. The exact call stack (all composed from shipped `dist`, nothing reimplemented)

1. `pi-coding-agent/dist/core/session-manager.js` — `loadEntriesFromFile()` →
   `buildSessionProjection(entries, leafId)` → `sessionEntryToContextMessages()`
2. `pi-coding-agent/dist/core/messages.js` — `convertToLlm()` (== `Agent.convertToLlm`)
3. `pi-agent-core/dist/agent-loop.js` — `streamAssistantResponse()`:
   `convertToLlm()` → `normalizeContext()` → provider `stream(model, llmContext)`
4. `pi-ai/dist/utils/transcript.js` — `normalizeContext()` →
   `resolveTranscript(ctx, supportsMidConvoSystemMessages=false)` (collapses mid-convo system for OpenAI)
5. `pi-ai/dist/api/transform-messages.js` — `transformMessages(msgs, gpt-4.1, normalizeId)`
6. `pi-ai/dist/api/openai-responses-shared.js` — `convertResponsesMessages(…)` → `buildParams()` →
   `POST /v1/responses`

The generator (`generate.mjs`, next to the HTML) imports exactly these modules. No conversion
logic was copied or rewritten.

## 4. How to read the HTML

- §0 headline cards + the amber note (wire < disk per snapshot, wire ≫ disk cumulatively).
- §1 disk breakdown by entry type.
- §2 the stack above, §3 the keep/drop table.
- §4 ninety-five turn cards grouped in 3 phases (`process inbox` / `project hygiene` /
  `Check comments`): left = raw JSONL line(s) appended that turn with byte counts; right = the
  request body that produced the assistant (wire items, bytes, `+N` delta with preview).
- §5 full final wire payload (309 Responses items, also `/tmp/session-maps/wire-final.json`).
- §6 spot checks (first/mid/last replay) + machine evidence (`/tmp/session-maps/evidence.json`).

## 5. Caveats (flagged, not hidden)

- Emulation target is **one** OpenAI model (`gpt-4.1`, non-reasoning). Reasoning models would take
  the `developer` role and reasoning-effort paths — deliberately out of scope.
- Wire byte counts **exclude** system prompt + tool schemas (not recoverable from the file; they
  depend on workspace state at call time). Direction of error: real requests were bigger.
- Word counts are whitespace splits; token counts shown are the file's own Gemini `usage`
  records (ground truth for that run, not an OpenAI tokenisation).
- Branching/compaction/context-edits do not occur in this session, so those projection branches
  are documented but unexercised, per instructions.

## 6. Re-run on any session

```
node generate.mjs /path/to/other-session.jsonl
```

Output lands beside the script as `session-map-<id8>.html`; evidence JSON + full final wire go
to `/tmp/session-maps/`.
