# Pi-aware semantic slice prototype

## Result

The thin approach is viable for the active-session baseline.

- **Projection:** `/tmp/pi-aware-semantic-slice-1353-188645/project-semantic-slice.mjs` imports Pi’s installed `loadEntriesFromFile()` and `buildSessionProjection()` from `dist/core/session-manager.js`.
- **Artifact:** `/tmp/pi-aware-semantic-slice-1353-188645/semantic-active-path.jsonl`
- **Output contract:** one JSONL object per line. Only `role` and `text` are emitted.
- **No repository or source-session writes occurred.**

The prototype uses Pi’s active-path projection before filtering. The raw log has 149 non-header entries. The projection has 141. It excludes eight non-active-path entries: three user messages, four assistant messages, and one tool result. This is decisive evidence that raw physical JSONL order is not a safe input contract.

## Artifact validation

| Check | Result |
|---|---:|
| Source bytes | 343,647 |
| Slice bytes | 107,393 |
| Reduction | 236,254 bytes / **68.75%** |
| Emitted records | 46 |
| `user` | 15 |
| `assistant` | 10 |
| `toolResult` | 8 |
| `subagent_task` | 7 |
| `subagent_result` | 6 |
| Empty text / schema violations | 0 / 0 |
| Parent task payloads retained byte-for-byte | 7 / 7 |
| Child final-result payloads retained byte-for-byte after envelope removal | 6 / 6 |
| Dispatch/control envelope leaks | 0 |

Sanitized representative rows:

```json
{"role":"subagent_task","text":"Create and publish the new public GitHub repository `…`, then register it as a Git submodule…"}
{"role":"subagent_result","text":"# Repository setup result\n- Created public GitHub repository: `…`\n- Child branch: `…`…"}
{"role":"toolResult","text":"# Subagent Dispatch Policy\n## Guardrails\n- Dispatch a self-contained task…"}
```

## Evidence-based delegation classifier

### Parent task

Observed representation:

- A `message` entry with `message.role: "assistant"` contains a `content[]` block with `type: "toolCall"` and `name: "subagent"`.
- Meaningful task prose is in `block.arguments.task`.
- Observed launch/tool arguments also carry agent name, cwd, async mode, acceptance/output information, and/or run-control values. They are excluded.
- A `subagent` tool call without a non-empty string `arguments.task` is control: agent-list, steer, wait, status, or launch receipt. It is excluded.

Classifier: emit `{role:"subagent_task", text: arguments.task.trim()}` only for `toolCall.name === "subagent" && typeof arguments.task === "string" && arguments.task.trim()`.

This retained all seven observed task prompts exactly. Ordinary assistant text filtering alone would lose every one because they are tool-call blocks, not `text` blocks.

### Child final result

Observed representation:

- A `custom_message` entry with `customType: "subagent-notify"` has a string `content`.
- All six observed final notifications use this envelope:

```text
Background task completed|failed: **<agent>** <agent>: <final result>
```

- The result begins after the repeated agent name. The prototype removes only that envelope and emits the remaining string as `{role:"subagent_result", text:"..."}`.
- Both `completed` and `failed` are accepted: a failed runtime status can still carry a substantive final report. This occurred in the sample.

The prototype does **not** infer a child result from generic tool results or visible status prose.

### Explicitly excluded plumbing

Observed records and signatures excluded without retaining their metadata:

| Representation | Observed purpose | Rule |
|---|---|---|
| `toolResult.toolName: "subagent"` | agent inventory, async launch receipt, steering receipt, run IDs/status | drop |
| `toolResult.toolName: "subagent_supervisor"` | supervisor reply | drop |
| `custom_message.customType: "subagent_supervisor_request"` | request body, run IDs, reply protocol | drop |
| `custom_message.customType: "subagent_control_notice"` | needs-attention/run-status control | drop |
| `custom_message.customType: "bg-task-notification"` | bash task IDs, command, exit status | drop |
| tool text beginning `Command running in background with ID:` or `(no output yet)` | background transport | drop |
| tool text beginning `Successfully wrote` or `Successfully replaced` | mutation receipt | drop |

The artifact contains no `Run fan-out:`, `Background task completed:`, `Background task failed:`, `<task-notification>`, or `Subagent needs attention:` wrapper/control text.

## Implementation notes

Pi sources inspected:

- Installed docs: `docs/sessions.md`, `docs/session-format.md`.
- Installed API: `dist/core/session-manager.d.ts` and `dist/core/session-manager.js`.

`buildSessionProjection()` is the correct selector. Its projection preserves the active tree path, latest compaction retention, and active context edits while retaining the owning `sourceEntry`. The prototype intentionally then diverges from Pi model context:

1. Accept projected ordinary `message` entries only for roles `user`, `assistant`, and `toolResult`.
2. Join only `type:"text"` content blocks.
3. Ignore images, thinking, calls, system messages, summaries, and state entries.
4. Add the two narrow delegation exceptions above.

The current slice uses `subagent_task` and `subagent_result` only because `user`/`assistant` would falsely describe direction and origin. They are the minimum extra roles needed for a coherent sequential narrative.

## Limits and next tweak

1. **Final-result wrapper is extension-specific.** `subagent-notify` plus the exact observed envelope is reliable for this sample, not a Pi-core schema guarantee. If an envelope changes, the prototype deliberately drops it rather than guessing. The extension needs a fixture for every supported subagent runtime/version, or a structured extension event.
2. **Visible control prose has no stable schema.** The prototype removes an exact, session-specific set of known status notices. It avoids the unsafe broad regex approach, but it is not production policy. A general extension needs an explicit classifier contract and fixtures for false-positive/false-negative cases.
3. **Tool-result substance remains policy-sensitive.** This prototype retains read output and substantive tool text. Tool names and text alone cannot universally decide semantic value. Add a tested per-tool allow/deny policy or an evaluated selector later.
4. **The source is live.** Validation applies to the 343,647-byte state read by the prototype. A live session can append after the read. For a durable command, record input content hash and projection time outside the semantic payload, if audit metadata is later desired.
5. **No topic selection.** This is the requested all-active-session narrative baseline. Topic and first/last-turn selection should operate on this projection/filter boundary, not raw JSONL.

Recommended next action: define a versioned internal classifier interface with fixtures for `subagent` task calls and `subagent-notify` final envelopes, then test it against branch, compaction, context-edit, malformed-envelope, and mixed-content cases.

## Commands run

```bash
node /tmp/pi-aware-semantic-slice-1353-188645/project-semantic-slice.mjs \
  /home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/2026-09-21T20-31-53-559Z_01a0c5ab-00d6-74e0-aeef-a66de6a36b16.jsonl \
  /tmp/pi-aware-semantic-slice-1353-188645/semantic-active-path.jsonl

# Validation: roles, schema, empty text, exact task/result matching, control-envelope scan.
node --input-type=module - <source> <artifact>

# Active-path comparison.
node --input-type=module - <source>

git diff --cached --name-only
git status --short
```

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Created only /tmp prototype artifacts and this required report; the prototype uses installed Pi buildSessionProjection() and emits a minimal semantic JSONL without repository changes."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Validation proves 46 schema-valid non-empty rows, 68.75% byte reduction, exact retention of 7 task and 6 final-result payloads, and zero detected transport envelopes."
    }
  ],
  "changedFiles": [
    "/tmp/pi-aware-semantic-slice-1353-188645/project-semantic-slice.mjs",
    "/tmp/pi-aware-semantic-slice-1353-188645/semantic-active-path.jsonl",
    "/home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/subagent-artifacts/outputs/42736d41-2319-4e1e-8db7-ca9bad952270/pi-aware-semantic-slice-prototype.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "node project-semantic-slice.mjs SOURCE semantic-active-path.jsonl",
      "result": "passed",
      "summary": "Imported Pi session-manager API and emitted the active-path slice."
    },
    {
      "command": "node validation script SOURCE semantic-active-path.jsonl",
      "result": "passed",
      "summary": "Validated roles, schema, non-empty texts, exact delegation payload retention, and control-envelope absence."
    },
    {
      "command": "node active-path comparison script SOURCE",
      "result": "passed",
      "summary": "149 raw non-header entries versus 141 active projection entries; eight inactive entries excluded."
    },
    {
      "command": "git diff --cached --name-only && git status --short",
      "result": "passed",
      "summary": "No staged files. Pre-existing untracked AGENTS.md remains the only worktree item."
    }
  ],
  "validationOutput": [
    "roles: user=15, assistant=10, toolResult=8, subagent_task=7, subagent_result=6",
    "noEmpty=true; schemaViolations=0; exactTasks=true; exactResults=true; genericEnvelopeOrControlLeakCount=0",
    "source=343647 bytes; artifact=107393 bytes; reduction=68.75%"
  ],
  "residualRisks": [
    "subagent-notify final-result envelope is observed runtime behavior, not a documented Pi-core contract",
    "visible control prose requires a tested general policy; this prototype uses an exact observed-notice list",
    "tool-result semantic classification needs explicit product policy"
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository diff. Prototype script and slice exist only under /tmp; required findings report was written outside the repository.",
  "reviewFindings": [
    "no blockers: artifact is Pi-projection-derived and validation evidence is reproducible from the stated paths"
  ],
  "manualNotes": "The repository began and ended with pre-existing untracked AGENTS.md; it was not modified."
}
```