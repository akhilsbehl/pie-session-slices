# Pi extension feasibility: intelligent session slices

## Finding
Feasible as a source-only extension. Pi exposes both the raw active branch and the exact context projection used for model calls. The clean MVP is a registered tool and/or command that selects a bounded, policy-filtered slice, optionally writes it to a user-selected file, and optionally invokes the existing isolated-subagent pattern with that slice in the task. No core fork is needed.

## Relevant APIs and hooks

- `ExtensionContext.sessionManager` is read-only. `getEntries()` returns all entries; `getBranch()` returns the active branch; `buildContextEntries()` returns active-branch entries with compaction applied; `getLeafId()` identifies the current leaf. `getSessionFile()`, `getSessionId()`, `getCwd()`, and `isPersisted()` support provenance and output handling.
- Installed implementation symbols add precision: `sessionEntryToContextMessages()`, `buildContextEntries()`, `buildSessionProjection()`, and `buildSessionContext()` are exported from `dist/core/session-manager`. `SessionProjection` contains provenance-preserving `{sourceEntry, messages}` pairs plus `thinkingLevel` and selected `{provider, modelId}`; `SessionContext` contains finalized messages plus those settings. `buildSessionProjection()` walks the selected leaf path, applies compaction, then applies the latest branch-relative context edit per target; state-only entries project to no messages. `buildSessionContext()` is a flattened projection. The manager's `buildContextEntries()` and `buildSessionProjection()` use its current leaf and indexes. `ReadonlySessionManager` is the extension-facing Pick and includes projection but not mutation methods. The raw JSONL format is documented and can be parsed directly, but the manager is preferable because it handles tree navigation, compaction, and context edits.
- `context` runs before every provider call and can return a filtered/windowed `messages` list. It excludes system messages; Pi restores prompt sections and tool declarations. `context_with_system` sees the full transcript including system prompt/tool state and can replace exactly what is sent. These hooks are appropriate for automatic context shaping, not necessarily for an on-demand export tool.
- `before_agent_start` can inject a persistent custom message and/or modify system prompt options. `pi.sendMessage()` creates a custom message that participates in model context; `pi.sendUserMessage()` creates a real user message and always triggers a turn. `pi.appendEntry()` persists extension state but explicitly does not enter model context.
- Custom tools use `pi.registerTool()` with TypeBox parameters and `execute(..., ctx)`. Commands use `pi.registerCommand()`. Tool output must be truncated; otherwise context overflow and compaction failures are explicit documented risks.
- There is no documented native “subagent context handoff” API in the core extension API. The shipped `examples/extensions/subagent/` extension registers a `subagent` tool and launches separate `pi` processes with isolated contexts. It accepts task text, parallel tasks, and chains where `{previous}` carries prior output. A slice can therefore be serialized into the delegated task, or written to a file and referenced by path. This is an example extension, not a core primitive.
- Session replacement (`ctx.newSession`, `ctx.fork`, `ctx.navigateTree`) is session control, not isolated subagent dispatch. `withSession` supplies a fresh replacement context and bound `sendMessage` helpers; old session-bound objects become stale after switching. Avoid using it for MVP handoff unless a replacement session is intentionally desired.

## MVP shape

1. Register `session_slice` tool plus `/session-slice` command.
2. Inputs: selector (`recent`, entry IDs, labels, user-turn range, or token/character budget), include/exclude roles and tool results, output mode (`return`, `file`, `subagent`), optional destination, and explicit redaction policy.
3. Read `ctx.sessionManager.getBranch()` or `buildContextEntries()`; preserve entry IDs, timestamps, role, and source session ID. Default to `buildContextEntries()` so prior compaction/context edits are respected.
4. Convert supported message blocks to bounded Markdown/JSONL. Enforce hard byte/character limits and omit images/thinking/tool arguments by default. Return a compact preview plus metadata; write full output only when requested.
5. For `subagent`, call or mirror the shipped subagent tool’s subprocess approach. Prefer a file reference for large slices; embed only bounded text. Keep project-agent scope user-only by default and require confirmation for project-local agents.
6. Add labels/bookmarks as a later high-value selector. Persist only slice metadata/cache with `appendEntry`; do not persist sensitive transcript content unless the user explicitly requests it.

## Constraints, security, and privacy

- Extensions execute with full system permissions. A slice extension can read private session content and write or transmit it. Treat output paths, subprocess arguments, model calls, logs, and tool details as sensitive.
- Session content includes user prompts, assistant reasoning/thinking, tool arguments/results, images (base64), environment paths, credentials accidentally printed by tools, and system prompt/tool declarations. Default deny images, thinking, hidden/system messages, and raw tool arguments; provide explicit opt-in.
- The subagent example warns that project-local agent prompts are repository-controlled and can instruct arbitrary reads/commands. Default to user agents; confirmation is required before project agents in untrusted projects. Preserve that boundary.
- `ctx.getSystemPromptOptions()` may contain full context-file contents and is explicitly marked sensitive. Do not expose it in command metadata, logs, or autocomplete.
- Branches and compactions are non-linear. `getEntries()` is not the active narrative; use `getBranch()` for current path. `buildContextEntries()` applies compaction. Context edits affect future model context while raw history remains unchanged. Make the chosen projection explicit in output metadata.
- Tool calls may run while the session is busy. Tool/event synchronization details matter: `tool_call` is synchronized through the current assistant message but may not include sibling tool results under parallel execution. Commands should check idle state before operations that assume a stable leaf; tools should tolerate a moving transcript.
- `sendUserMessage()` always triggers a turn. `sendMessage()` enters model context and may create durable transcript content. Do not silently inject slices into the active conversation; require an explicit mode.
- Files may outlive the session and inherit filesystem permissions. Use restrictive creation mode where possible, avoid predictable names, and disclose the path. Never claim deletion or confidentiality without verifying it.

## Evidence and consulted sources

Exact paths consulted:

- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/README.md` — sessions, commands, extensions, compaction, export/import overview.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/extensions.md` — lifecycle hooks (`context`, `context_with_system`, `before_agent_start`), `ExtensionContext`, `sessionManager`, tools/commands, `sendMessage`, `sendUserMessage`, `appendEntry`, session replacement, output truncation, trust/security notes.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/docs/session-format.md` — JSONL schema, message/entry types, compaction/context edits, complete `SessionManager` API.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.d.ts` — installed public types: `SessionProjection`, `SessionContext`, `ReadonlySessionManager`, exported builders, and manager lifecycle/mutation methods.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/session-manager.js` — installed implementation of path traversal, compaction filtering, projection, context edits, and manager methods.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/summarize.ts` — reads `ctx.sessionManager.getBranch()`, extracts text/tool calls, invokes a model, and renders a summary.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/send-user-message.ts` — command registration and message delivery semantics.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/README.md` — isolated subprocess model, agent trust boundary, modes, limits, and handoff semantics.
- `/home/akhil/.nvm/versions/node/v24.18.1/lib/node_modules/@earendil-works/pi-coding-agent/examples/extensions/subagent/index.ts` — registered `subagent` tool, task/chain/parallel schemas, subprocess dispatch, project-agent confirmation.
- `/home/akhil/configs/pi/extensions/pie-session-slices/README.md` — repository currently contains only the project title.
- `/home/akhil/configs/pi/extensions/pie-session-slices/AGENTS.md` — self-contained source-only extension and submodule branch/commit guidance; no implementation was made.

## Review status

No files in the repository were edited. No tests were added. Working tree inspection showed `main...origin/main` with pre-existing untracked `AGENTS.md`; no staged files were created by this assessment. Residual risk: API details can change with Pi versions; pin and test against the installed package version before implementation.
