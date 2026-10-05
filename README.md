# pie-session-slices

Exact, token-cheap slices of Pi session history with DuckDB-backed turn persistence.

## What it does

- Agent tool `session_slice`: full or bounded (last-N / first-N / range) turn
  windows, with or without verbatim tool results. Returns a file path only.
- User commands `/session-slice-full` and `/session-slice-bounded`.
- Silent background capture: every turn is persisted per user-anchored turn to
  `~/.pi/agent/runtime/session-slices/slices.duckdb`. Reads hit the DB first;
  misses fall back to the on-the-fly wire pipeline (`buildSessionProjection` →
  per-entry `convertToLlm`) with write-through caching.

## Slice contract

- User-anchored turns. Kinds: `user`, `assistant-text`, `subagent_task`,
  `subagent_result`, `subagent_steer`. Tool results live in a separate table
  and join only when `includeToolResults` is set — no `substantive` classifier.
- Replayability is a non-goal. No thinking, tool calls, images, or metadata.
- Smart (topic-filtered) slices are deferred.

## Layout

- `src/slice.ts` — wire pipeline + fallback projector + turn assembly.
- `src/store.ts` — DuckDB persistence (lazy load, never throws).
- `src/index.ts` — tool, commands, background hooks.
- `scripts/test-slices.mjs` — file-based tests over past sessions.
- `findings/session-3/artifacts/` — test slices + manifest.
