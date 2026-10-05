# 04 — Experiments and prototypes

All ran read-only (source session + repo unmodified; work copies under `/tmp`).
The `/tmp` prototype files have since expired (see 06) — the reports in
`artifacts/` are the durable record, with exact filters/commands/hashes inside.

## E1 — Extension feasibility (tanuki `a3e61e42`) → `artifacts/pi-extension-feasibility.md`

- Read-only survey of installed Pi docs + `dist` + shipped examples.
- Verdict: **feasible as source-only extension, no core fork**.
- APIs: `ExtensionContext.sessionManager` (read-only: `getEntries/getBranch/
  buildContextEntries/getLeafId/...`); installed symbols
  `sessionEntryToContextMessages/buildContextEntries/buildSessionProjection/
  buildSessionContext`; hooks `context` / `context_with_system` /
  `before_agent_start`; `pi.registerTool/registerCommand`; `sendMessage` (context,
  no turn) vs `sendUserMessage` (always a turn) vs `appendEntry` (no context).
- Handoff: no native subagent-context API — mirror the shipped `subagent` example
  (isolated subprocess, task text or file path). Default user agents; confirm
  project-local agents. MVP shape + security/privacy constraints enumerated.
- Steered mid-run to also map SessionManager/buildContextHistory internals.

## E2 — Session-log structure (kitsune `88addccd`) → `artifacts/session-log-structure.md`

- Parsed the live session-1 file (116 lines at read time) + installed format docs.
- Catalog: header (v3, no `parentSession`); `message` 100 (system 1 / user 15 /
  assistant 54 / toolResult 30); `custom_message` 12 (supervisor/bg-task, all
  model-visible); `custom` 1 (no context); `model_change` 1;
  `thinking_level_change` 1. Plus absent-type edge cases (usage, compaction,
  branch_summary, context_edit, label, session_info, bashExecution, custom roles,
  synthetic compaction/branch summaries, forks).
- Slice invariants: one JSON/line; preserve or re-root IDs; keep prompt/tool
  checkpoints only if replayable; include context-affecting extension messages +
  compaction/edit records knowingly; preserve unknown fields.

## E3 — jq semantic trim (oni `5156e6d4`) → `artifacts/jq-semantic-trim-prototype.md`

- Input copy 140 records / 303,784 B → strict projection 46 records / 18,195 B
  (**84.6%** byte reduction). Schema: `{role: user|assistant|toolResult, text}`.
  Naive message-text-only baseline was 80 records / 89,907 B — the strict filter
  removed 34 more control/subagent records.
- Exact `jq` filter + run commands + SHA-256 hashes in the report.
- Hard cases: control vocabulary can false-positive on legit prose; `toolName`
  used-then-dropped hurts debuggability; `read` results ambiguous; write-receipt
  retention is a product choice; images/attachments dropped; no turn structure;
  no secret redaction.
- Recommendation: prototype-only; regex must become fixture-tested policy.

## E4 — Semantic projection analysis (oni `789d3e83`) → `artifacts/pi-semantic-projection-analysis.md`

- Source-side counterpart to E3: inspected `session-manager.js`, `messages.js`,
  `agent-session.js`, `sdk.js`, type declarations, `session-format.md`.
- Rules: active root→leaf path (not file order); latest-compaction retention;
  last-context-edit-wins per target; `sessionEntryToContextMessages` mapping;
  `convertToLlm` synthetic user messages (bashExecution/custom/branch/compaction
  summaries all model-visible though excluded from slices).
- Narrow slice algorithm: `buildSessionProjection(entries, leafId)` → accept only
  `sourceEntry.type==="message"` with role user/assistant/toolResult → join text
  blocks (toolResult only if substantive) → drop everything else.
- **Can jq match Pi semantics? No, not generally** — it must reimplement path,
  compaction, edit, role-distinction, and normalization rules (unstable contract).
  jq acceptable only as best-effort transcript filter, explicitly documented.

## E5 — Pi-aware semantic slice (rasetsu `42736d41`) → `artifacts/pi-aware-semantic-slice-prototype.md`

- The decision procedure: Pi's `loadEntriesFromFile` + `buildSessionProjection`,
  then narrow filtering **plus two delegation exceptions**: `subagent` tool calls
  with non-empty `arguments.task` → `subagent_task` (7/7 byte-exact); `custom_message`
  `subagent-notify` envelopes → unwrapped `subagent_result` (6/6 byte-exact,
  incl. a `failed`-status run with substantive report).
- Result on 343,647 B source: 46 records, 107,393 B (**68.75%** reduction);
  141/149 non-header entries on the active path (8 off-path excluded — proof raw
  order ≠ context). Zero transport-envelope leaks; explicit exclusion table.
- Limits: notify-envelope is observed behavior, not core contract (needs fixtures
  per runtime/version); control-prose removal is session-specific (needs general
  classifier + fixtures); tool-result substance needs product policy; source is
  live (record hash/time if audit needed); no topic/first-last-turn selection yet
  (build those on this boundary).
- User's follow-up ("why jq…? where is the stripped file?") answered in-chat from
  E3/E4: jq filters records independently and can't reproduce tree/compaction/edit
  semantics; stripped file was the `/tmp` prototype (expired).

## E0 — Repo setup (tanuki `a3e0c209`) → `artifacts/repo-setup-result.md`

- Created `github.com:akhilsbehl/pie-session-slices`, `main` @ `ba3af56`,
  submodule staged in `~/configs`; parent uncommitted. Run reported failure
  despite success — status unreliability worth knowing when delegating setup.
