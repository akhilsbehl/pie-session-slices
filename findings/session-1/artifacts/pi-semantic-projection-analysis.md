# Pi session semantic projection for slices

## Finding

Do **not** treat raw JSONL order as Pi model context. Pi selects one active tree path, replaces earlier history after compaction, applies branch-local context edits, then converts extension-only message roles before a model call.

For the requested slice, use this deliberately narrower projection:

1. Follow the selected active path in chronological parent order.
2. Apply Pi's latest-compaction and `context_edit` rules if the slice must reflect current model-visible history.
3. Emit only:
   - `message.message.role == "user"`: its text content, in order.
   - `message.message.role == "assistant"`: only content blocks where `type == "text"`, in order; concatenate their `.text` values. Exclude `thinking` and `toolCall` blocks.
   - `message.message.role == "toolResult"`: only `type == "text"` blocks, in order, and only when the resulting text is substantive (recommended: non-empty after trimming). Keep error text too; `isError` changes status, not context visibility.
4. Exclude every other entry/role, including `system`, `bashExecution`, `custom`, `custom_message`, `branchSummary`, `compactionSummary`, tool calls, thinking, and all entry/control metadata.

This is a **semantic slice projection**, not an exact recreation of Pi context. It intentionally omits model-visible system instructions, compaction/branch summaries, extension messages, image blocks, and interactive `!` shell output.

## Actual installed symbols and files

Installed package root:

`/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent`

| Purpose | File | Symbol / behavior |
|---|---|---|
| Session entry union and projection API | `dist/core/session-manager.d.ts` | `SessionEntry`, `SessionMessageEntry`, `CustomMessageEntry`, `ContextEditEntry`, `buildContextEntries`, `buildSessionProjection`, `buildSessionContext`, `sessionEntryToContextMessages` |
| Concrete selected-entry projection | `dist/core/session-manager.js` | `sessionEntryToContextMessages()` at line 166; `buildContextEntries()` at 201; `buildSessionProjection()` at 256; `buildSessionContext()` at 282 |
| Agent-role conversion before LLM calls | `dist/core/messages.js` | `convertToLlm(messages)`; `bashExecutionToText()` |
| Normal application request path | `dist/core/agent-session.js` | `_buildBoundaryContext()` calls `buildSessionProjection()` then `convertToLlm()` (around line 464) |
| Image-block defence | `dist/core/sdk.js` | `convertToLlmWithBlockImages()` removes user/tool-result images when `blockImages` is enabled (around line 146) |
| Base content/message definitions | `node_modules/@earendil-works/pi-ai/dist/types.d.ts` | `TextContent`, `ThinkingContent`, `ImageContent`, `ToolCall`, `UserMessage`, `AssistantMessage`, `ToolResultMessage` |
| Installed format reference | `docs/session-format.md` | “Context Building”; exact persisted entry and message schemas |

## Pi context construction rules

### 1. Path selection

`buildSessionPath()` (inside `session-manager.js`) starts at the provided/current leaf, follows `parentId` to root, then reverses the result. It does not replay every JSONL line. Other branches and orphaned roots are not selected.

### 2. Compaction

`buildContextEntries()` finds the **latest** `compaction` on that path.

- Context starts with that compaction entry.
- It retains non-system entries from `firstKeptEntryId` through the entry immediately before compaction.
- It then retains all entries after compaction.
- Earlier entries are represented only by the compaction summary.
- A retained older compaction produces no messages; only the first/newest selected compaction contributes.

`sessionEntryToContextMessages(compaction)` creates a `compactionSummary`; if `systemMessage` exists, it precedes the summary as a system checkpoint.

For slices, exclude both system checkpoint and summary. This means semantic slices will not carry compressed facts from old history.

### 3. Context edits

`buildSessionProjection()` gathers `context_edit` entries from selected context entries. For each target, the last selected edit wins.

- `replacement: null`: removes the target's model contribution.
- A replacement changes content only. It retains the original message role and metadata.
- For assistant and tool-result messages, string replacement becomes `[ { type: "text", text: replacement } ]`.
- Edits can target only user, assistant, tool-result, or custom-message entries. They are branch-relative.

A slice that reads raw target content without applying these edits can disagree with current Pi context.

### 4. Entry-to-AgentMessage projection

`sessionEntryToContextMessages()` maps:

- `message` → stored `AgentMessage`; it normalizes null content to `""` for system or `[]` for user/assistant/toolResult.
- `custom_message` → `CustomMessage`.
- non-empty `branch_summary` → `BranchSummaryMessage`.
- `compaction` → optional stored system message plus `CompactionSummaryMessage`.
- all other entry types → no messages.

Thus `thinking_level_change`, `model_change`, `usage`, `custom`, `context_edit`, `label`, and `session_info` do not independently become messages. Model and thinking changes still update returned session settings through `getSessionContextSettings()`.

### 5. AgentMessage-to-model-message conversion

`convertToLlm()` maps:

- `bashExecution` → a synthetic user text message unless `excludeFromContext` is true.
- `custom` → a user message, preserving string/text/image content.
- `branchSummary` → a synthetic user message containing Pi's branch-summary wrapper.
- `compactionSummary` → a synthetic user message containing Pi's compaction-summary wrapper.
- `system`, `user`, `assistant`, `toolResult` → unchanged.

This explains why custom-message, branch-summary, compaction-summary, and ordinary `!` bash output are model-visible in Pi even though the requested projection must exclude them.

## Requested content rules and edge cases

| Source | Requested output | Pi behavior / caveat |
|---|---|---|
| User string content | Include exactly the string, including whitespace unless UI policy trims presentation | Pi permits `string` or text/image array. |
| User text array | Join `type == "text"` blocks in stored order | Do not serialize image base64. A text-only slice necessarily loses images. |
| User image array | Omit image; optionally emit a fixed local marker such as `[image omitted]` only if product requires loss visibility | Pi passes images to models normally; SDK can replace images with “Image reading is disabled.” when `blockImages` is set. No universal text equivalent exists. |
| Assistant text blocks | Include text blocks only, in order | Assistant content may interleave text, thinking, tool calls. Selecting `.text` blocks excludes thought and call arguments. |
| Assistant thinking blocks | Exclude | Pi model context retains them because it passes assistant unchanged. They can be redacted and retain opaque signatures. |
| Assistant tool calls | Exclude | Pi model context retains calls, needed to pair subsequent tool results. |
| Tool-result text blocks | Include text blocks only when substantive | `isError: true` still has model-visible content. Preserve the text; optionally label it as error in slice display without serializing details. |
| Tool-result images | Omit (or fixed marker) | Pi can send result images; no textual semantic equivalent. |
| Tool-result `details`, `usage`, IDs, names | Exclude | They are metadata, though Pi needs `toolCallId` to keep provider tool-call pairing valid. |
| Assistant error (`stopReason: "error"`, `errorMessage`) | Include visible text blocks, if any; exclude metadata unless product explicitly needs a fixed error marker | Pi preserves error fields on assistant message. They are not content blocks. |
| Empty/whitespace tool result | Exclude under “substantive” policy | Pi still transmits an empty result array. Substantive filtering is a slice decision, not Pi equivalence. |
| `custom_message` / role `custom` | Exclude | Pi converts it to a user message; `display: false` only hides it in TUI, not in model context. This is a critical divergence. |
| role `bashExecution` | Exclude | Pi converts it into synthetic user text except when `excludeFromContext` (`!!`) is true. |
| system message | Exclude | Pi uses system content, sections, and tool declarations. |
| branch/compaction summaries | Exclude | Pi converts each to synthetic user text. |

## Minimal reliable algorithm

Implement against Pi's exported projection API, not raw `jq`, when the goal is the active semantic history:

```ts
const projection = buildSessionProjection(entries, leafId);
for (const { sourceEntry, messages } of projection.entries) {
  // Accept only sourceEntry.type === "message".
  // Then accept message roles user, assistant, toolResult only.
  // User: string directly or text blocks.
  // Assistant/toolResult: text blocks only.
  // Tool result: discard if joined text has no non-whitespace content.
}
```

Important: use `sourceEntry.type === "message"` as well as role. That prevents Pi-created `CustomMessage`, compaction, branch summary, and interactive bash roles from entering a slice even though Pi turns some into LLM-compatible user messages later.

For entry selection, call `buildSessionProjection(entries, leafId)` from the installed coding-agent package. It handles active branch, compaction, content normalization, and context edits. Then do the narrower block filtering above.

## Can jq-only safely match Pi semantics?

**No, not as a general claim.** A simple `jq` stream over JSONL cannot safely replicate Pi semantics because it must implement all of the following stateful rules:

- derive the active root-to-leaf parent chain rather than use file order;
- choose the latest compaction on that chain and retain the exact pre-compaction range from `firstKeptEntryId`, excluding retained system messages;
- suppress an older retained compaction;
- select the latest active-branch `context_edit` per target and replace/omit target content;
- distinguish stored message entries from synthetic AgentMessage roles;
- normalize legacy/malformed null content as Pi does.

A sufficiently large `jq` program could encode a constrained approximation for well-formed v3 sessions and a supplied leaf ID. It would still duplicate an unstable internal contract, not “safely match Pi semantics.” It also cannot reproduce future version migrations without reimplementation. Use Pi's exported JavaScript/TypeScript API for reliable selection, then optionally use jq only for final content-block filtering of already-projected data.

A raw linear jq filter is acceptable only if explicitly scoped to “best-effort, raw JSONL transcript” and documented as not compaction-, branch-, edit-, custom-, or image-semantic.

## Evidence checked

- `session-manager.js`: direct source inspection of exported projection code and edit validation.
- `messages.js`: direct source inspection of pre-LLM conversion.
- `agent-session.js`: direct source inspection of normal boundary context construction and persistence of `bashExecution`.
- `sdk.js`: direct source inspection of image blocking.
- `pi-ai/dist/types.d.ts`: direct schema inspection of all content variants and error fields.
- `docs/session-format.md`: installed documentation cross-check. It matches the installed projection implementation on the major rules above.

## Revision log

- 2026-10-15: Initial read-only analysis from the installed Pi package.
