# pie-session-slices — developer discovery, round 2

## Decisions captured

- Downstream subagents always receive **only the slice file path** and read it themselves; no inline content fallback.
- A **turn** is user-anchored: from a user message through all subsequent assistant/tool activity until the next user message.
- Slices use the **raw active branch** and exclude compaction rounds and branch summaries.
- The artifact is a single **JSONL file** under `/tmp`.
- Topic retrieval is the core unsolved design problem and will be tested interactively before being fixed.

---

❓ **Q5 — What exact records go into the JSONL file?**

“Raw active branch” gives us source fidelity, but Pi’s session stream includes entries that are not part of a user-anchored turn: session headers, model changes, branch metadata, custom extension state, compaction entries, and summaries. <<ASB: [rvw_001] Comment on "session headers, model changes, branch metadata, custom extension state, compaction entries, and summaries.": Eliminate all of this from the slice.>> We need a deterministic inclusion contract.

- **A. Preserve selected raw entries verbatim.** Each chosen entry is emitted unchanged, except excluded compaction/summary entries. Highest fidelity, but the consumer must understand Pi’s internal format.
- **B. Emit a normalized slice schema.** Each row carries source entry ID, timestamp, turn ID, kind, and original payload under `raw`. Easier to consume; adds a wrapper around original data.
- **C. Emit both:** a first metadata line, then verbatim raw entries. Minimal transformation and explicit provenance.

Why this matters: a subagent reading only a path must reliably know what it is looking at, while the artifact must remain an exact slice rather than a new interpretation.

➡️ **Recommended answer: C — one metadata header plus verbatim selected raw entries.** <<ASB: [rvw_002] Comment on block "➡️ **Recommended answer: C — one metadata header plus verbatim selected raw entries.**": Hmm... this also needs a little more thinking, I need to understand what kind of metadata pi stores. Let's hold on to this. The earlier comment about elimination of some of the cruft still holds. We only want to pass on substantive information, not session replay metadata - this is the principle. The exact design needs more testing.>>

---

❓ **Q6 — How should `conversation` choose assistant content?**

Pi assistant entries can contain visible prose, hidden thinking, tool calls, and sometimes mixed blocks. `conversation` means direct human↔assistant communication, but its exact treatment determines whether the output remains faithful and usable.

- **A. Include only user messages and assistant visible text blocks; discard all non-visible assistant blocks.**
- **B. Include user messages plus the complete assistant raw entry whenever it has visible text.** Exact raw fidelity, but may carry thinking/tool details that `conversation` says to ignore.
- **C. Emit a derived conversational view (user text and assistant visible text) with pointers back to raw entry IDs.** Cleanest consumer experience, but not a verbatim raw slice.

➡️ **Recommended answer: A.** Preserve the original selected entry IDs and visible blocks only; it directly implements “human ↔ agent replies.” <<ASB: [rvw_003] Comment on block "➡️ **Recommended answer: A.** Preserve the original selected entry IDs and visible blocks only; it directly implements “human ↔ agent replies.”": A>>

---

❓ **Q7 — For topic retrieval, may the extension maintain an index on disk?**

To avoid rereading the entire history on every topic request, the extension can incrementally index entries as the session grows. The index would live alongside the session or under a cache directory and store entry IDs plus compact searchable representations.

- **A. No disk index:** scan programmatically on every request. Simplest and maximally fresh; gets slower as sessions grow.
- **B. Session-local incremental index:** update after each turn; rebuild if stale or missing. Fast subsequent retrieval; requires invalidation and lifecycle handling.
- **C. Cross-session index:** one searchable store for all sessions. Powerful but materially broader privacy, retention, and maintenance scope.

Why this matters: C changes the product from session slicing to personal conversation search. B tightly serves this product’s goal.

➡️ **Recommended answer: B — session-local incremental index with a safe rebuild path.** <<ASB: [rvw_004] Comment on block "➡️ **Recommended answer: B — session-local incremental index with a safe rebuild path.**": A.>>

---

❓ **Q8 — What should happen when topic retrieval cannot be confident?**

The extension must always produce a path or communicate that it cannot form a trustworthy slice. Since your workflow is automatic, there is no review screen.

- **A. Produce the best candidate slice and record a confidence score/reason in the JSONL header.** Fastest; risk of silent wrong context.
- **B. Fail explicitly and ask Pi/the user to refine the topic.** Safest; interrupts delegation.
- **C. Produce a conservative superset:** include the best candidates plus bounded neighbouring turns, record why. Aligns with your inclusion preference, but can become noisy.

➡️ **Recommended answer: C for topic requests, with a hard size cap; fail only when no meaningful candidate exists.** <<ASB: [rvw_005] Comment on block "➡️ **Recommended answer: C for topic requests, with a hard size cap; fail only when no meaningful candidate exists.**": None of this - this is a catastrophic failure mode that needs to be proven under evals. If this doesn't work well, the extension is useless. We don't work around this. 
The agent gives it's best judgement of what it can do and I decide if it is useful enough of not.>>
