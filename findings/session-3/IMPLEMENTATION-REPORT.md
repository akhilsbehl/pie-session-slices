# pie-session-slices — implementation report (2026-10-05)

Branch: `asb/session-slices-impl`. Commit `03a438b` (+ this file pending).
Symlink: `~/.pi/agent/extensions/pie-session-slices` → source dir. Loads clean.

## Built

- `src/slice.ts` — pipeline `buildSessionProjection()` → per-entry `convertToLlm()`
  → user-anchored turns. Projector resolves in 3 tiers (root export → install-dir
  dist → `buildContextEntries` emulation); outcome records `pipeline` + `projector`
  honestly. Strip contract applies in all paths (rev-2 rvw_001). No byte caps, no
  truncation flags (rvw_006/007). Kinds include `subagent_steer` (rvw_002). Tool
  results verbatim in a separate table, joined only on `includeToolResults` (rvw_003).
- `src/store.ts` — DuckDB at `~/.pi/agent/runtime/session-slices/slices.duckdb`,
  tables `turns` / `tool_results` / `sessions`. Lazy native load, never throws.
- `src/index.ts` — tool `session_slice`, commands `/session-slice-full` and
  `/session-slice-bounded` (path-only return, rvw_008/009). Hooks: `session_start`
  ensures DB; `message_end` debounced 2s silent write-through with leaf guard;
  `session_shutdown` flush. DB-first read, on-fly fallback + write-through cache.

## Evidence

- `findings/session-3/artifacts/`: 16 slices (4 sessions × full / full-tools /
  last-3 / first-2-tools) + `manifest.json`. All `pipeline=wire`.
- Work session (`20-31-53`) reproduces E5 ground truth: 7/7 `subagent_task`
  byte-exact, 7 genuine `subagent_result` reports (E5 counted 6; the 7th is the
  consumer-feedback report, verified by inspection), 3 `subagent_steer`.
- Live `pi -p` tests: extension loads; model-invoked `session_slice` returned
  `{pipeline: wire, projector: buildSessionProjection, source: computed}` with a
  real `/tmp` file. Command handlers verified via mock ctx (clean error with no
  session, no crash).

## Blocked (needs your approval)

1. **DuckDB native binding missing.** `npm install` fetched the package but
   install-scripts are held (`node-pre-gyp` never ran), so
   `lib/binding/duckdb.node` is absent. `store.ts` degrades gracefully
   (`source: computed` everywhere; zero crashes), but no DB row exists yet.
   Run: `npm install-scripts approve duckdb && npm rebuild duckdb`
   inside the package dir, then I re-run the harness with a DB round-trip check.
   I did not approve scripts myself — arbitrary build code, your call.
2. **Child branch not pushed.** `git push -u origin asb/session-slices-impl`
   needs network/auth. Say go and I push. Parent pin untouched (separate commit,
   per submodule guidance). `AGENTS.md` left untracked as found.

## Blind spots

- `subagent-notify` envelope regex is observed behavior, not core contract (known
  from E5; fixtures still wanted).
- `message_end` ctx carrying `sessionManager` is assumed defensively (`?.`);
  if a Pi version omits it, background capture silently no-ops and write-through
  on read still populates the DB.
- `convertToLlm` output shapes handled tolerantly (user/assistant roles, string
  or text-part content); a future role rename would drop text rather than crash —
  `pipeline`/`projector` metadata will show it.
