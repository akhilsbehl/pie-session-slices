# Pi session JSONL structural reference

Scope: read-only inspection of the specified 116-line JSONL plus the installed Pi session-format documentation and declarations. Examples below are sanitized schematics, not transcript content.

## 1. Record envelope and tree

Each line is one JSON object. The first line is the header and is not a tree node:

```json
{"type":"session","version":3,"id":"<session-uuid>","timestamp":"<ISO-8601>","cwd":"<working-directory>"}
```

A header may also have `parentSession` when forked/cloned. Every subsequent record has the common envelope:

```json
{"type":"<entry-type>","id":"<entry-id>","parentId":"<parent-entry-id-or-null>","timestamp":"<ISO-8601>", ...payload}
```

`id` is normally a short hex identifier (full UUID fallback is allowed); `parentId` links records into a tree. Branches are represented in one file, so physical line order is not necessarily the active conversation path. A root has `parentId: null`; multiple roots are possible after reset/root branching. Current context is obtained by walking the active leaf to root, then applying compaction and context edits.

Observed header: `version: 3`, with no `parentSession`. Observed node IDs/parent IDs were strings; the first model-change node had a null parent.

## 2. Types observed in this file

Counts are from the target file: `message` 100, `custom_message` 12, `model_change` 1, `thinking_level_change` 1, `custom` 1, `session` 1.

### `message` (100; turn/context material)

Envelope payload is `message: AgentMessage`. Observed roles:

* **system (1):** `role`, string `content`, `sections` object, integer Unix-ms `timestamp`, and `toolsAdded` array. `sections` is named prompt state (observed names included preamble/tools/rules/docs/project context/skills/cwd); tool declarations contain `name`, `description`, and JSON-schema-like `parameters`. System messages are prompt/tool checkpoints or patches, not user turns.
* **user (15):** `role`, `content` (observed array of text blocks), integer `timestamp`.
* **assistant (54):** `role`, `content` (observed text and tool-call blocks), `api`, `provider`, `model`, `usage`, `stopReason`, integer `timestamp`, plus observed `responseId` and `rawStopReason`.
* **toolResult (30):** `role`, `toolCallId`, `toolName`, `content` (observed text blocks), `isError`, integer `timestamp`; observed `details` was present in the outer role inventory (may be null/extension-specific).

Schematic:

```json
{"type":"message","id":"a1","parentId":"u1","timestamp":"...",
 "message":{"role":"assistant","content":[
   {"type":"text","text":"sanitized response"},
   {"type":"toolCall","id":"call-1","name":"read","arguments":{"path":"<path>"}}
 ],"api":"<api>","provider":"<provider>","model":"<model>",
 "usage":{"input":1,"output":2,"cacheRead":0,"cacheWrite":0,"totalTokens":3,
   "cost":{"input":0,"output":0,"cacheRead":0,"cacheWrite":0,"total":0}},
 "stopReason":"toolUse","timestamp":0}}
```

### `custom_message` (12; extension-injected context material)

Envelope payload: `customType` string, `content` string (all observed values were strings; format permits text/image block arrays), `display` boolean, optional `details`, and normal tree metadata. Observed custom types included supervisor requests/notices and background-task notifications. Details were extension-owned and varied (request/run identifiers, routing, reason, reply hints; notices/jobs had their own keys). This participates in LLM context (typically converted to a custom/user-like message), but is not a normal user-anchored turn.

Schematic: `{"type":"custom_message","customType":"<extension>","content":"<sanitized injected context>","display":true,"details":{"requestId":"<id>"},...envelope}`.

### `custom` (1; extension/session control state)

Envelope payload: `customType` string and `data` object. The observed type was a supervisor reply with request/run/agent identifiers, message, reason, child metadata, and creation time. Custom entries persist extension state but do **not** participate in model context.

### `model_change` (1; session control)

Payload: `provider`, `modelId`; common envelope. Records a model switch and affects subsequent context construction.

### `thinking_level_change` (1; session control)

Payload: `thinkingLevel` string; common envelope. Records the reasoning/thinking setting for subsequent context.

## 3. Content-block and nested structures

Documented base blocks:

* `text`: `{type:"text", text:string, textSignature?:string}`.
* `image`: `{type:"image", data:<base64>, mimeType:string}` (user/tool/custom-message content; not observed in this file).
* `thinking`: `{type:"thinking", thinking:string, thinkingSignature?:string, redacted?:boolean}` (assistant content; not observed).
* `toolCall`: `{type:"toolCall", id:string, name:string, arguments:object, thoughtSignature?:string, namespace?:string}`. Tool calls were observed; arguments are arbitrary JSON, not necessarily `{path:...}`.

Message-specific shape rules:

* User content is a string or text/image block array.
* Assistant content is a text/thinking/toolCall array; metadata includes provider/API/model, usage, stop reason, optional response identifiers/diagnostics, and optional error/deferred fields. Persisted messages should have a terminal `stopReason`; `pending` is for streaming only and should not be persisted. Documented terminal reasons include `stop`, `length`, `toolUse`, `error`, `aborted`, and `deferred`.
* Tool results contain text/image blocks, `toolCallId`, `toolName`, `isError`, optional tool `details`, and optional nested `usage`.
* Usage has token counters (`input`, `output`, `cacheRead`, `cacheWrite`, optional `cacheWrite1h`, optional `reasoning`, `totalTokens`) and `cost` with corresponding numeric fields plus `total`.
* System content may be string or text blocks; current installed format additionally uses named `sections` and `toolsAdded`/`toolsRemoved` patches. Replay system records in order to reconstruct prompt/tool state.

## 4. Classification for session slices

**User-anchored turn material:** `message` records whose roles are `user`, `assistant`, and `toolResult`, including their linked tree ancestry. A slice intended to preserve a turn normally needs the user message, subsequent assistant response/tool calls, and corresponding tool results; do not infer turn boundaries solely from physical lines. `message`/system is required context state but is not user-authored turn material.

**Context but not ordinary user turn:** `custom_message` participates in model context and can be important to preserve around a turn, but its origin is an extension. Its `display` flag controls UI rendering, not context participation.

**Session/control/state:** header `session`; `model_change`; `thinking_level_change`; `custom`; and (when present) `usage`, `label`, `session_info`, and `context_edit` (the latter changes future model context but is not itself a model message).

**Compaction/branch summaries:** `compaction` and `branch_summary` are control/context-reconstruction records, not ordinary user turns. Neither appeared in this file. They must not be dropped blindly when designing a slice: they can define the active context boundary or explain an abandoned branch.

## 5. Defined edge cases absent from this file

The installed format defines these additional entry types/fields:

* **`usage`:** common envelope plus arbitrary `kind`, `provider`, `model`, `usage`, optional human-readable `note`; accounting-only and hidden from LLM context. Unknown `kind` values are valid.
* **`compaction`:** `summary`, required `firstKeptEntryId`, `tokensBefore`, optional `systemMessage` (complete prompt/tool checkpoint), `usage`, extension `details`, and `fromHook`. A retain-none compaction sets `firstKeptEntryId` to its own ID. Context reconstruction keeps entries from that boundary and replaces earlier history with the summary.
* **`branch_summary`:** `fromId`, `summary`, optional `usage`, `details`, `fromHook`; the `fromId` identifies the abandoned leaf while `parentId` is where the new branch continues. Installed declaration types `fromId` as string; docs describe the conceptual previous leaf (older representations may show null).
* **`context_edit`:** `targetId` and `replacement` (`null` omits the target; otherwise `{content: ...}` replaces only content). Latest edit on the active branch wins; raw history remains unchanged. String replacements may be normalized to one text block for array-content roles.
* **`label`:** `targetId`, `label` (undefined/omitted semantics clear a label); bookmark state rather than context.
* **`session_info`:** optional `name`, used for session display name.
* **Additional message role `bashExecution`:** command/output, `exitCode` (possibly undefined), `cancelled`, `truncated`, optional `fullOutputPath`, optional `excludeFromContext`, timestamp. `!!` commands may be explicitly excluded from context.
* **Custom agent messages:** `role:"custom"` with `customType`, content, display, details, timestamp; distinct from a `custom_message` entry and extension-defined.
* **Compaction/branch synthetic message roles:** `compactionSummary` (`summary`, `tokensBefore`) and `branchSummary` (`summary`, `fromId`) are generated when building model context from their entries.
* **Forked headers:** optional `parentSession` path. Version 1 was linear legacy; version 2 introduced tree links; version 3 renamed legacy `hookMessage` to `custom`; loading migrates older versions.

## 6. Practical slice invariants

1. Emit one valid JSON object per line; retain the header separately from tree entries.
2. Preserve IDs and parent links for included records, or explicitly re-root/rewrite them; otherwise branch reconstruction is ambiguous.
3. Keep system prompt/tool checkpoints when the slice is expected to be replayable by the model.
4. Include context-affecting extension messages and any applicable compaction/context-edit records; omit only knowingly state/accounting-only records.
5. Treat payload details as extension/provider-owned: preserve unknown fields and unknown `customType`, usage `kind`, content-block metadata, and tool arguments rather than validating against only the observed sample.
