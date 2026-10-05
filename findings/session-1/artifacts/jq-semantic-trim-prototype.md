# jq semantic-trim prototype

## Result

A `jq` projection can make a compact, sequential semantic JSONL without extension-side parsing for the observed log shape.

- Input copy: `/tmp/jq-semantic-trim-prototype-5156e6d4/source-copy.jsonl`
- Input: 140 records; 303,784 bytes.
- Strict projection: 46 records; 18,195 bytes.
- Reduction: 84.6% by bytes; 67.1% by records.
- Output schema: exactly `{"role":"user|assistant|toolResult","text":"..."}`.
- The source session and repository were not modified.

The projection preserves encounter order. It accepts only `type == "message"`, emits only text content blocks, drops assistant `toolCall` blocks, and does not carry source metadata.

## Observed raw structure

| Raw record | Count | Treatment |
|---|---:|---|
| `session` | 1 | Drop. Session-level ID, cwd, version, timestamp. |
| `model_change` | 1 | Drop. Provider/model control record. |
| `thinking_level_change` | 1 | Drop. Control record. |
| `custom` | 1 | Drop. Extension/custom state. |
| `custom_message` | 16 | Drop. Custom/control/display state. |
| `message` / `system` | 1 | Drop. System prompt/control material. |
| `message` / `user` | 16 | Retain text unless it is subagent-management control text. |
| `message` / `assistant` | 66 | Retain only `content[]` blocks with `type == "text"`; drop all tool calls and metadata. |
| `message` / `toolResult` | 37 | Retain only substantive text; discard known subagent-management and transport results. |

Raw message metadata deliberately excluded: timestamps, message/provider/model fields, API metadata, response IDs, stop reasons, usage, errors, details, tool call IDs, tool names, parent IDs, and entry IDs.

## Exact filter

Save the following as `semantic-recommended.jq` outside the repository. It is the filter run for this prototype.

```jq
def text_blocks:
  [.[]? | select(.type == "text" and (.text | type) == "string") | .text]
  | join("\n") | select(length > 0);
def control_text:
  test("(?i)(subagent|supervisor|intercom|fan-out|run fanout|async run|executable agents|delegated agent|agent dispatch|agent status|steering queued|replied to supervisor|mission:|contact_supervisor|interview_request|progress_update)");
def tool_transport:
  test("(?i)^(command running in background|run fan-out:|executable agents \\(capabilities\\):|successfully wrote to .*/subagent-artifacts/)");

select(.type == "message") | .message
| (.content | text_blocks) as $text
| if .role == "user" then
    select($text | control_text | not) | {role:"user", text:$text}
  elif .role == "assistant" then
    select($text | control_text | not) | {role:"assistant", text:$text}
  elif .role == "toolResult" then
    select((.toolName // "") | test("(?i)^(subagent|subagent_supervisor)$") | not)
    | select($text | control_text | not)
    | select($text | tool_transport | not)
    | {role:"toolResult", text:$text}
  else empty end
```

Run it only on a copy:

```bash
set -euo pipefail
src='/home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/2026-09-21T20-31-53-559Z_01a0c5ab-00d6-74e0-aeef-a66de6a36b16.jsonl'
work='/tmp/jq-semantic-trim-prototype-5156e6d4'
mkdir -p "$work"
cp -- "$src" "$work/source-copy.jsonl"
jq -c -f "$work/semantic-recommended.jq" "$work/source-copy.jsonl" \
  > "$work/semantic-recommended.jsonl"
```

The produced file has SHA-256:

```text
b289914c756f41c23a2c9f8b6b1ad3cc9826b3f1b6df42e00e020256a7db005f
```

## Sanitized preview

Text is shortened only for this report. The actual output retains complete accepted text.

```jsonl
{"role":"assistant","text":"Acknowledged."}
{"role":"user","text":"Okay, we are in a fresh directory. I want you to start with creating a new public repo using gh called pie-session-slices. Register this repo as a submodule of ~/configs after crea…"}
{"role":"assistant","text":"Delegated: creating and publishing the child repo, then registering it as an uncommitted submodule in `~/configs`."}
{"role":"user","text":"If it fails again, do it yourself."}
{"role":"assistant","text":"Understood. If delegation fails again, I’ll complete the setup directly."}
{"role":"assistant","text":"Completed successfully despite the task-status failure: - Public repo: `git@github.com:akhilsbehl/pie-session-slices.git` - Child `main` pushed at `ba3af56` - Registered as staged …"}
{"role":"user","text":"Did you read the skill?"}
{"role":"assistant","text":"No. I should have read the full `wayfinder` skill file first."}
{"role":"user","text":"Okay."}
{"role":"assistant","text":"Read. You want to chart a Wayfinder map for an extension that exposes intelligent, programmatic session-history slices—starting by defining the consumer, then moving into developer…"}
{"role":"toolResult","text":"--- name: grilling description: Grill the user relentlessly about a plan, decision, or idea. Use when the user wants to stress-test their thinking, or uses any 'grill' trigger phra…"}
{"role":"toolResult","text":"--- name: domain-modeling description: Build and sharpen a project's domain model. Use when discussing codebase terminology, writing or editing a CONTEXT.md, or recording or editin…"}
{"role":"toolResult","text":"--- name: richie description: Always consult before using the richie command. --- # Use Richie Richie is the human review gate for canonical Markdown and local HTML artifacts. Appl…"}
{"role":"toolResult","text":"Successfully wrote to /home/akhil/.richie/ephemeral/pie-session-slices-consumer-round-1.md"}
{"role":"assistant","text":"Consumer-mode grilling is open in Richie."}
```

## Hard cases

1. **Subagent-management text can occur in a user or assistant message.**
   The prototype removes text matching an explicit control vocabulary. This avoids dispatch policy, agent inventory, dispatch receipts, supervisor replies, and status messages. It can also remove a legitimate substantive discussion that uses those words. The pattern must become tested policy, not an unreviewed broad regex.

2. **Tool-result `toolName` is semantic context but must be dropped from output.**
   The filter uses `toolName` internally to suppress `subagent` and `subagent_supervisor`, but emits no tool identity. This meets the minimal payload target. It makes later debugging of retained results harder.

3. **`read` tool results are ambiguous.**
   They can be substantive source/document content, as in the retained skill text, or merely prompt/control text. The current filter retains them unless their text matches subagent-control rules. A future policy can add tool-specific rules only after evaluation.

4. **Background command messages are not semantic.**
   Current tool-result strings such as “Command running in background …” are suppressed. Successful write receipts from ordinary tools remain in this observed data because they may document an artifact. If those are considered non-semantic, add `^(Successfully (wrote|replaced)\b` to `tool_transport`; that is a product choice.

5. **Mixed assistant blocks.**
   Observed assistant messages were either text-only (30) or toolCall-only (36; one with two tool calls). The filter safely handles future mixed arrays: it retains text blocks and ignores tool calls.

6. **Non-text content.**
   The filter intentionally ignores images, attachments, structured tool content, and unknown content block types. This is correct for text-only semantic narrative, but is lossy.

7. **No turn structure.**
   The output is chronological entries, not user-anchored turn bundles. Consecutive assistant entries remain separate. That is the requested minimal narrative and avoids inventing grouping metadata.

8. **Potential sensitive content.**
   The filter retains complete accepted text. It does not redact secrets, paths, or personal data. Redaction is a separate policy and must occur before a slice crosses a trust boundary.

## Baseline comparison

A deliberately simple filter that only selected message roles and text blocks produced 80 records / 89,907 bytes. The strict filter removed 34 additional control/subagent records and reduced the output to 18,195 bytes.

Baseline filter:

```jq
def text_blocks:
  [.[]? | select(.type == "text" and (.text | type) == "string") | .text]
  | join("\n") | select(length > 0);

select(.type == "message")
| .message
| if .role == "user" then {role:"user", text:(.content | text_blocks)}
  elif .role == "assistant" then {role:"assistant", text:(.content | text_blocks)}
  elif .role == "toolResult" then {role:"toolResult", text:(.content | text_blocks)}
  else empty end
```

## Validation

Commands run:

```bash
jq -r '.type // "(none)"' source-copy.jsonl | sort | uniq -c
jq -r 'select(.type=="message") | .message.role // "(none)"' source-copy.jsonl | sort | uniq -c
jq -c -f semantic-recommended.jq source-copy.jsonl > semantic-recommended.jsonl
jq -r .role semantic-recommended.jsonl | sort | uniq -c
jq -s '[.[]|select((.text|length)==0)]|length' semantic-recommended.jsonl
git diff --cached --name-only
```

Results:

- Input roles: 16 `user`, 66 `assistant`, 37 `toolResult`, 1 `system`.
- Projected roles: 13 `user`, 23 `assistant`, 10 `toolResult`.
- Empty projected text values: 0.
- No staged repository files.

## Recommendation

Use this as a prototype-only deterministic stage. Do not embed the regex as a final product contract until it has fixture tests with known false-positive and false-negative cases. Preserve the narrow output schema. Add tool-result filtering and redaction only through explicit evaluated policy.

## Revision Log

- Initial prototype. Copied the source log to `/tmp`; ran baseline and strict `jq` projections; did not change the repository or source session.

```acceptance-report
{
  "criteriaSatisfied": [
    {
      "id": "criterion-1",
      "status": "satisfied",
      "evidence": "Read-only prototype ran against a copy outside the repository. It emits only ordered user, assistant, and retained tool-result text in a two-field JSONL schema."
    },
    {
      "id": "criterion-2",
      "status": "satisfied",
      "evidence": "Report includes exact jq filters, exact copy/run commands, source/output counts, hashes, a sanitized preview, hard cases, and validation results."
    }
  ],
  "changedFiles": [
    "/home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/subagent-artifacts/outputs/5156e6d4-a981-401f-b62a-964cd1443458/jq-semantic-trim-prototype.md"
  ],
  "testsAddedOrUpdated": [],
  "commandsRun": [
    {
      "command": "cp source session to /tmp/jq-semantic-trim-prototype-5156e6d4/source-copy.jsonl",
      "result": "passed",
      "summary": "Copied 140-line, 303,784-byte source outside repository."
    },
    {
      "command": "jq -c -f semantic-recommended.jq source-copy.jsonl > semantic-recommended.jsonl",
      "result": "passed",
      "summary": "Produced 46-line, 18,195-byte semantic JSONL."
    },
    {
      "command": "jq role and empty-text validation",
      "result": "passed",
      "summary": "13 user, 23 assistant, 10 toolResult records; zero empty text fields."
    },
    {
      "command": "git diff --cached --name-only",
      "result": "passed",
      "summary": "No staged files."
    }
  ],
  "validationOutput": [
    "Source SHA-256: dd5dd312cddc39394d73ded1ee3483501f0c6ed84378a3ab91f38a39a2e84469",
    "Semantic output SHA-256: b289914c756f41c23a2c9f8b6b1ad3cc9826b3f1b6df42e00e020256a7db005f",
    "Strict filter removed 34 records from the naive message-text projection."
  ],
  "residualRisks": [
    "Regex-based subagent suppression can false-positive on substantive prose containing control vocabulary.",
    "The prototype retains complete accepted text and performs no secret or privacy redaction.",
    "Non-text content and tool identity are intentionally discarded."
  ],
  "noStagedFiles": true,
  "diffSummary": "No repository or source-session changes. Durable report only; prototype files are under /tmp.",
  "reviewFindings": [
    "no blockers: required jq transformation, preview, commands, and hard-case analysis are present."
  ],
  "manualNotes": "Repository had a pre-existing untracked AGENTS.md; it was not modified."
}
```
