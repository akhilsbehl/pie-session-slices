# pie-session-slices — developer discovery, round 3

## Structural facts from the session log

Pi’s JSONL contains a header followed by tree-linked entries. The substantive material for a user-anchored turn is normally:

```text
user message
  → assistant message(s), including visible text and possibly tool calls
  → tool-result message(s)
  → final assistant message
```

The raw log also contains session machinery that we will exclude: session header, system prompt checkpoints, model/thinking changes, extension state, compaction, branch summaries, labels, usage, and context edits.

Important complication: raw records use `id` and `parentId` to point into the *full* session tree. A slice deliberately omits much of that tree.

---

❓ **Q9 — What makes the exported JSONL self-contained?**

If we copy raw substantive entries unchanged, their `parentId` values can point to records absent from the slice. That is harmless if a subagent treats the file as a readable packet, but misleading if it treats it as a valid Pi replay log.

- **A. Keep raw records unchanged.** The file is an extract, not replayable Pi session data. Add a short non-Pi metadata header declaring this.
- **B. Re-root records inside the slice.** Rewrite `parentId` values so the file forms a self-contained chain/tree. This is easier to traverse, but modifies original records.
- **C. Normalize to slice records.** Each line is `{ sourceEntryId, turnId, kind, payload }`; no pretence that this is a Pi session log.

Why this matters: the name “JSONL” does not require Pi’s raw session schema. We need to avoid a format that looks replayable but is not.

➡️ **Recommended answer: C.** A slice is its own portable data object, not a partial session file. Preserve the original raw message under `payload` and source IDs for provenance. <<ASB: [rvw_001] Comment on block "➡️ **Recommended answer: C.** A slice is its own portable data object, not a partial session file. Preserve the original raw message under `payload` and source IDs for provenance.": Yes C but a highly stripped down version. 'Replayability' is an absolute non-goal - transferring semantic context is the only goal.>>

---

❓ **Q10 — In `all` mode, which tool information is substantive?**

A selected turn can include tool-call arguments, results, errors, images, verbose logs, and extension details. “All” could mean literally every field, or every operationally meaningful record.

- **A. Literal raw contents of each selected user/assistant/toolResult entry.** Maximum fidelity; can carry huge outputs and secrets printed by a tool.
- **B. Full selected entries, but strip provider/accounting/session metadata (`usage`, model IDs, response IDs) while retaining tool calls and results verbatim.** Matches “substantive, not session replay metadata.”
- **C. Preserve tool calls and concise text results only; drop binary data and implementation details.** Smallest and easiest to consume, but no longer “all.”

Scenario:

> A tool returns 30,000 lines of build output. The decision hinges on a three-line error near the end.

Literal `all` sends all 30,000 lines. A pruned result may lose diagnostic evidence.

➡️ **Recommended answer: B.** Define `all` as all substantive message content for selected turns, not all transport/accounting metadata. Hard limits can be an explicit later decision. <<ASB: [rvw_002] Comment on block "➡️ **Recommended answer: B.** Define `all` as all substantive message content for selected turns, not all transport/accounting metadata. Hard limits can be an explicit later decision.": This is what I need to figure out. Can you look at your session's jsonl (file path given later in this comment) - and give me an early slice of what to 'not keep' - I'm looking at a jsonl preview and I think we should only keep type = message, role = user, assistant, toolResult (skip tool call), within each, throw away all the metadata like timestamps, model names, tokens, ids, reasons etc. etc.
We should also throw away anything that's related to subagent management as that has no semantic information. The idea is to capture the main 'content' in the 'payload' and throw away as much else as we can.

Ask an oni to take a shot at trimming a copy of /home/akhil/.pi/agent/sessions/--home-akhil-configs-pi-extensions-pie-session-slices--/2026-09-21T20-31-53-559Z_01a0c5ab-00d6-74e0-aeef-a66de6a36b16.jsonl
by applying a bunch of jq filters? We may not even need a lot of extension code - just a bunch of known jq filters only. Also ask another oni to take the same problem but approach it from the source code side - how is the session history constructed by pi and what can it teach us about how to get to the meat and throw away all the bones.

In this case, the meat is just - a sequential narrative of what I said, what substantive/semantic inputs the agent got from it's tool calls, what did it tell me. Thinking tokens should also be thrown away.

The answer is B but a much heavily stripped down version of B.>>

---

❓ **Q11 — In `filtered` mode, who decides which tool material stays?**

This is the only payload mode where relevance judgment applies *inside* an already selected topic slice.

- **A. The same topic-selection evaluator returns both selected turns and selected tool records.** One consistent decision, fewer calls; prompt/schema becomes richer.
- **B. First select turns, then run a second evaluator over only their tool activity.** More precise and inspectable; adds latency/cost.
- **C. Use deterministic rules only:** retain failed tools, final results, and tool calls explicitly named by the request. Predictable but cannot understand why a successful intermediate result matters.

➡️ **Recommended answer: A.** One bounded evaluator should output both turn IDs and, for `filtered`, the included tool-call/result IDs plus a strict explanation field for evaluation—not necessarily emitted in the slice. <<ASB: [rvw_003] Comment on block "➡️ **Recommended answer: A.** One bounded evaluator should output both turn IDs and, for `filtered`, the included tool-call/result IDs plus a strict explanation field for evaluation—not necessarily emitted in the slice.": We need to use the ask_jev tool to do this but I need to think about this more carefully.>>

---

❓ **Q12 — What should the extension return to Pi after creating a slice?**

The result becomes part of the live conversation. It must let Pi use the slice immediately without flooding the context.

- **A. File path only.** Lowest token cost; Pi gets no confirmation of scope.
- **B. Path plus compact manifest:** selector, payload mode, selected turn count, entry IDs, byte count, and exclusions. Gives Pi enough information to delegate safely with minimal cost.
- **C. Path plus a rendered preview of slice contents.** Better inspection, but defeats the token-saving goal.

➡️ **Recommended answer: B.** Return a small machine-readable/compact text receipt, never the slice content itself. <<ASB: [rvw_004] Comment on block "➡️ **Recommended answer: B.** Return a small machine-readable/compact text receipt, never the slice content itself.": A.>>
