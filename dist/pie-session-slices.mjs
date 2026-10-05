import { buildContextEntries, convertToLlm, getAgentDir, parseSessionEntries, sessionEntryToContextMessages } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
//#region src/slice.ts
/**
* pie-session-slices — slice core.
*
* Persistence-first design: turns are captured live in order and stored in
* DuckDB (see store.ts). This module builds slice data either from live
* session-manager entries or from a session JSONL file (fallback for old
* sessions + write-through cache seeding).
*
* Pipeline per projected entry (preserves sourceEntryId attribution):
*   buildSessionProjection() → per-pair convertToLlm() → text extraction.
* If convertToLlm throws, falls back to projection-only with the same explicit
* strip list, and marks pipeline: "projection-only".
*
* Strip contract (applies in BOTH paths):
*   keep: user text, assistant visible text.
*   extract: subagent task/steer prompts (toolCall blocks), subagent results
*     (subagent-notify envelopes), tool result text (verbatim, separate table).
*   drop: thinking, images, toolCall blocks (except subagent task/steer),
*     system messages, compaction/branch summaries, model/thinking-level
*     changes, usage, labels, custom state, subagent/bg-task control notices,
*     timestamps/ids/models/tokens metadata.
*/
let projectorCache = null;
/**
* Resolve the active-branch projector for the running Pi install.
* 1. Root export (Pi >= 1.0: buildSessionProjection).
* 2. Install-dir dist file (same symbol, file-based).
* 3. buildContextEntries + sessionEntryToContextMessages emulation (older Pi).
*/
async function resolveProjector() {
	if (projectorCache) return projectorCache;
	try {
		const root = await import("@earendil-works/pi-coding-agent");
		if (typeof root["buildSessionProjection"] === "function") {
			projectorCache = {
				fn: root["buildSessionProjection"],
				name: "buildSessionProjection"
			};
			return projectorCache;
		}
	} catch {}
	try {
		const candidates = [join(getAgentDir(), "npm", "node_modules", "@earendil-works/pi-coding-agent", "dist", "core", "session-manager.js")];
		try {
			const { readdirSync } = await import("node:fs");
			const releases = join(getAgentDir(), "install", "releases");
			for (const release of readdirSync(releases).sort().reverse()) candidates.push(join(releases, release, "node_modules", "@earendil-works/pi-coding-agent", "dist", "core", "session-manager.js"));
		} catch {}
		for (const distFile of candidates) try {
			const mod = await import(pathToFileURL(distFile).href);
			if (typeof mod["buildSessionProjection"] === "function") {
				projectorCache = {
					fn: mod["buildSessionProjection"],
					name: "buildSessionProjection"
				};
				return projectorCache;
			}
		} catch {}
	} catch {}
	const emulate = (entries) => ({ entries: buildContextEntries(entries).map((sourceEntry) => ({
		sourceEntry,
		messages: sessionEntryToContextMessages(sourceEntry)
	})) });
	projectorCache = {
		fn: emulate,
		name: "contextEntries-fallback"
	};
	return projectorCache;
}
/** Join text blocks from a message content field (string or content array). */
function textOf(content) {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts = [];
	for (const block of content) if (block && typeof block === "object") {
		const b = block;
		if (b["type"] === "text" && typeof b["text"] === "string") parts.push(b["text"]);
	}
	return parts.join("\n");
}
/** Raw toolCall blocks from a message content array. */
function toolCallsOf(content) {
	if (!Array.isArray(content)) return [];
	return content.filter((b) => !!b && typeof b === "object" && b["type"] === "toolCall");
}
/**
* Observed-behavior subagent extraction (see findings E5). Deliberately narrow:
* unknown envelopes are dropped, never guessed.
*/
function extractSubagent(sourceEntry, turnId) {
	const out = [];
	const entryType = sourceEntry["type"];
	if (entryType === "message") {
		const msg = sourceEntry["message"];
		if (msg?.["role"] === "assistant") for (const call of toolCallsOf(msg["content"])) {
			if (call["name"] !== "subagent") continue;
			const args = call["arguments"] ?? {};
			const action = typeof args["action"] === "string" ? args["action"] : void 0;
			if (action === "steer" || action === "follow_up") {
				const text = [
					args["message"],
					args["task"],
					args["prompt"]
				].filter((v) => typeof v === "string" && v.trim().length > 0).join("\n");
				if (text.trim()) out.push({
					kind: "subagent_steer",
					payload: text.trim()
				});
				continue;
			}
			if (!action) {
				const task = args["task"];
				if (typeof task === "string" && task.trim()) out.push({
					kind: "subagent_task",
					payload: task.trim()
				});
			}
		}
	}
	if (entryType === "custom_message") {
		const customType = sourceEntry["customType"];
		const content = sourceEntry["content"];
		const text = textOf(content);
		if (customType === "subagent-notify" && text.trim()) {
			const stripped = text.replace(/^(Background task|Detached foreground task) (completed|failed|paused|stopped):\s*\*\*([^*]+)\*\*\s*\3:\s*/, "").trim();
			if (stripped) out.push({
				kind: "subagent_result",
				payload: stripped
			});
		} else if ((customType === "subagent_supervisor_request" || customType === "subagent-supervisor-request" || customType === "subagent_steering_notice" || customType === "subagent-steering-notice") && text.trim()) out.push({
			kind: "subagent_steer",
			payload: text.trim()
		});
	}
	return out.map((r) => ({
		...r,
		turnId
	}));
}
/** Verbatim tool result text rows from a toolResult message entry. */
function extractToolResults(sourceEntry, turnId, seqStart) {
	if (sourceEntry["type"] !== "message") return [];
	const msg = sourceEntry["message"];
	if (msg?.["role"] !== "toolResult") return [];
	const text = textOf(msg["content"]);
	if (!text.trim()) return [];
	const details = msg["details"] ?? {};
	return [{
		turnId,
		seq: seqStart,
		toolName: typeof msg["toolName"] === "string" ? msg["toolName"] : "unknown",
		callId: typeof details["callId"] === "string" ? details["callId"] : "",
		text,
		isError: details["isError"] === true
	}];
}
/** Extract user/assistant visible text from wire (convertToLlm) messages. */
function wireText(msgs) {
	const out = [];
	for (const m of msgs) {
		const role = m["role"];
		if (role !== "user" && role !== "assistant") continue;
		const text = textOf(m["content"]);
		if (text.trim()) out.push({
			role,
			text
		});
	}
	return out;
}
/** Manual strip of per-entry AgentMessages (projection-only fallback). */
function manualText(pairMessages) {
	const out = [];
	for (const m of pairMessages) {
		const role = m["role"];
		if (role !== "user" && role !== "assistant") continue;
		if (role === "assistant") {
			const content = m["content"];
			const text = Array.isArray(content) ? content.filter((b) => b?.["type"] === "text" && typeof b["text"] === "string").map((b) => b["text"]).join("\n") : typeof content === "string" ? content : "";
			if (text.trim()) out.push({
				role: "assistant",
				text
			});
		} else {
			const text = textOf(m["content"]);
			if (text.trim()) out.push({
				role: "user",
				text
			});
		}
	}
	return out;
}
async function buildSliceData(entries, opts) {
	const { fn: project, name: projector } = await resolveProjector();
	const projection = project(entries, opts.leafId ?? void 0);
	let wireOk = true;
	try {
		const flat = projection.entries.flatMap((p) => p.messages);
		convertToLlm(flat);
	} catch {
		wireOk = false;
	}
	const pipeline = wireOk ? "wire" : "projection-only";
	const turns = [];
	let turnIdx = 0;
	let current = null;
	const newTurn = () => {
		turnIdx += 1;
		const turn = {
			turnId: `t${String(turnIdx).padStart(4, "0")}`,
			turnIdx,
			records: [],
			toolResults: []
		};
		turns.push(turn);
		return turn;
	};
	for (const pair of projection.entries) {
		const sourceEntry = pair.sourceEntry;
		const sourceEntryId = typeof sourceEntry["id"] === "string" ? sourceEntry["id"] : "unknown";
		let texts;
		if (wireOk) try {
			texts = wireText(convertToLlm(pair.messages));
		} catch {
			texts = manualText(pair.messages);
		}
		else texts = manualText(pair.messages);
		for (const t of texts) if (t.role === "user") {
			current = newTurn();
			current.records.push({
				sourceEntryId,
				turnId: current.turnId,
				kind: "user",
				payload: t.text
			});
		} else {
			current ??= newTurn();
			current.records.push({
				sourceEntryId,
				turnId: current.turnId,
				kind: "assistant-text",
				payload: t.text
			});
		}
		current ??= newTurn();
		for (const s of extractSubagent(sourceEntry, current.turnId)) current.records.push({
			sourceEntryId,
			turnId: current.turnId,
			...s
		});
		for (const row of extractToolResults(sourceEntry, current.turnId, current.toolResults.length)) current.toolResults.push(row);
	}
	const kept = turns.filter((t) => t.records.length > 0 || t.toolResults.length > 0);
	kept.forEach((t, i) => {
		const newId = `t${String(i + 1).padStart(4, "0")}`;
		if (newId !== t.turnId) {
			t.turnId = newId;
			t.turnIdx = i + 1;
			for (const r of t.records) r.turnId = newId;
			for (const r of t.toolResults) r.turnId = newId;
		}
	});
	return {
		sessionId: opts.sessionId,
		pipeline,
		projector,
		turns: kept
	};
}
function selectTurns(turns, selector) {
	switch (selector.type) {
		case "full": return turns;
		case "last": return turns.slice(Math.max(0, turns.length - selector.n));
		case "first": return turns.slice(0, selector.n);
		case "range": {
			const start = Math.max(1, selector.start);
			const end = Math.min(turns.length, selector.end);
			if (end < start) return [];
			return turns.slice(start - 1, end);
		}
	}
}
/** Serialize selected turns to JSONL lines (tool results joined iff requested). */
function toJsonLines(turns, includeToolResults) {
	const lines = [];
	for (const t of turns) {
		for (const r of t.records) lines.push(JSON.stringify(r));
		if (includeToolResults) for (const tr of t.toolResults) lines.push(JSON.stringify({
			sourceEntryId: `${tr.callId || tr.toolName}:${tr.seq}`,
			turnId: tr.turnId,
			kind: "toolResult",
			payload: tr.text,
			toolName: tr.toolName,
			isError: tr.isError
		}));
	}
	return lines;
}
//#endregion
//#region src/store.ts
/**
* pie-session-slices — DuckDB persistence layer.
*
* DB: ~/.pi/agent/runtime/session-slices/slices.duckdb
* Tables: turns (conversation records), tool_results (verbatim tool output),
* sessions (per-session cursors + metadata).
*
* All functions are silent and never throw: they return null/false on any
* failure so the read path can fall back to on-the-fly computation. The
* duckdb module is lazily imported so extension startup never blocks on
* native bindings.
*/
const DB_DIR = join(homedir(), ".pi", "agent", "runtime", "session-slices");
const DB_PATH = join(DB_DIR, "slices.duckdb");
let duckdbMod = null;
let db = null;
let unavailable = false;
function rows(database, sql, ...params) {
	return new Promise((resolve, reject) => {
		database.all(sql, ...params, (err, result) => {
			if (err) reject(err);
			else resolve(result ?? []);
		});
	});
}
function exec(database, sql, ...params) {
	return new Promise((resolve, reject) => {
		database.run(sql, ...params, (err) => {
			if (err) reject(err);
			else resolve();
		});
	});
}
/** Ensure the DB exists and is migrated. Returns false (never throws) when unavailable. */
async function ensureDb() {
	if (db) return true;
	if (unavailable) return false;
	try {
		mkdirSync(DB_DIR, { recursive: true });
		duckdbMod ??= await import("duckdb");
		db = new duckdbMod.Database(DB_PATH);
		await exec(db, `CREATE TABLE IF NOT EXISTS turns(
      session_id VARCHAR, turn_id VARCHAR, turn_idx INTEGER, seq INTEGER,
      kind VARCHAR, source_entry_id VARCHAR, payload VARCHAR,
      PRIMARY KEY (session_id, turn_id, seq))`);
		await exec(db, `CREATE TABLE IF NOT EXISTS tool_results(
      session_id VARCHAR, turn_id VARCHAR, seq INTEGER,
      tool_name VARCHAR, call_id VARCHAR, text VARCHAR, is_error BOOLEAN,
      PRIMARY KEY (session_id, turn_id, seq))`);
		await exec(db, `CREATE TABLE IF NOT EXISTS sessions(
      session_id VARCHAR PRIMARY KEY, turn_count INTEGER,
      pipeline VARCHAR, updated_at VARCHAR)`);
		return true;
	} catch {
		unavailable = true;
		db = null;
		return false;
	}
}
/** Stored pipeline for a session, or null when unknown. Never throws. */
async function sessionPipeline(sessionId) {
	try {
		if (!await ensureDb() || !db) return null;
		const value = (await rows(db, `SELECT pipeline FROM sessions WHERE session_id = ?`, sessionId))[0]?.pipeline;
		return value === "wire" || value === "projection-only" ? value : null;
	} catch {
		return null;
	}
}
/** Idempotent full-session write (debounced live capture rewrites; cheap at session scale). */
async function saveTurns(sessionId, turns, pipeline) {
	try {
		if (!await ensureDb() || !db) return false;
		await exec(db, `DELETE FROM turns WHERE session_id = ?`, sessionId);
		await exec(db, `DELETE FROM tool_results WHERE session_id = ?`, sessionId);
		let seq = 0;
		for (const t of turns) {
			for (const r of t.records) {
				seq += 1;
				await exec(db, `INSERT INTO turns(session_id, turn_id, turn_idx, seq, kind, source_entry_id, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, sessionId, t.turnId, t.turnIdx, seq, r.kind, r.sourceEntryId, r.payload);
			}
			for (const tr of t.toolResults) await exec(db, `INSERT INTO tool_results(session_id, turn_id, seq, tool_name, call_id, text, is_error)
           VALUES (?, ?, ?, ?, ?, ?, ?)`, sessionId, tr.turnId, tr.seq, tr.toolName, tr.callId, tr.text, tr.isError);
		}
		await exec(db, `INSERT INTO sessions(session_id, turn_count, pipeline, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (session_id)
       DO UPDATE SET turn_count = excluded.turn_count, pipeline = excluded.pipeline,
                     updated_at = excluded.updated_at`, sessionId, turns.length, pipeline, (/* @__PURE__ */ new Date()).toISOString());
		return true;
	} catch {
		return false;
	}
}
/** Load cached turns, or null on miss/unavailable (caller falls back to on-the-fly). */
async function loadTurns(sessionId) {
	try {
		if (!await ensureDb() || !db) return null;
		const recs = await rows(db, `SELECT turn_id, turn_idx, seq, kind, source_entry_id, payload FROM turns
            WHERE session_id = ? ORDER BY turn_idx, seq`, sessionId);
		if (recs.length === 0) return null;
		const tools = await rows(db, `SELECT turn_id, seq, tool_name, call_id, text, is_error FROM tool_results
            WHERE session_id = ? ORDER BY turn_id, seq`, sessionId);
		const byTurn = /* @__PURE__ */ new Map();
		for (const r of recs) {
			let t = byTurn.get(r.turn_id);
			if (!t) {
				t = {
					turnId: r.turn_id,
					turnIdx: r.turn_idx,
					records: [],
					toolResults: []
				};
				byTurn.set(r.turn_id, t);
			}
			t.records.push({
				sourceEntryId: r.source_entry_id,
				turnId: r.turn_id,
				kind: r.kind,
				payload: r.payload
			});
		}
		for (const tr of tools) {
			const t = byTurn.get(tr.turn_id);
			if (!t) continue;
			t.toolResults.push({
				turnId: tr.turn_id,
				seq: tr.seq,
				toolName: tr.tool_name,
				callId: tr.call_id,
				text: tr.text,
				isError: !!tr.is_error
			});
		}
		return [...byTurn.values()].sort((a, b) => a.turnIdx - b.turnIdx);
	} catch {
		return null;
	}
}
//#endregion
//#region src/index.ts
const SessionSliceInputSchema = Type.Object({
	mode: Type.Union([Type.Literal("full"), Type.Literal("bounded")], { description: "full = all turns; bounded = a turn window (requires lastN, firstN, or start/end)." }),
	lastN: Type.Optional(Type.Number({
		minimum: 1,
		description: "Bounded: keep the last N turns."
	})),
	firstN: Type.Optional(Type.Number({
		minimum: 1,
		description: "Bounded: keep the first N turns."
	})),
	start: Type.Optional(Type.Number({
		minimum: 1,
		description: "Range window: first turn (1-indexed)."
	})),
	end: Type.Optional(Type.Number({
		minimum: 1,
		description: "Range window: last turn (1-indexed, inclusive)."
	})),
	includeToolResults: Type.Optional(Type.Boolean({ description: "Join verbatim tool results into the slice. Default false." })),
	sessionFile: Type.Optional(Type.String({ description: "Absolute path to a session JSONL file. Default: the live session." }))
});
function toSelector(input) {
	if (input.mode === "full") return { type: "full" };
	if (input.start !== void 0 || input.end !== void 0) return {
		type: "range",
		start: input.start ?? 1,
		end: input.end ?? Number.MAX_SAFE_INTEGER
	};
	if (input.firstN !== void 0) return {
		type: "first",
		n: Math.floor(input.firstN)
	};
	if (input.lastN !== void 0) return {
		type: "last",
		n: Math.floor(input.lastN)
	};
	return {
		type: "last",
		n: 5
	};
}
function readSessionFile(sessionFile) {
	const content = readFileSync(sessionFile, "utf8");
	const parsed = parseSessionEntries(content);
	const header = parsed.find((e) => e["type"] === "session");
	return {
		sessionId: typeof header?.["id"] === "string" ? header["id"] : basename(sessionFile, ".jsonl"),
		entries: parsed.filter((e) => e["type"] !== "session")
	};
}
async function runSlice(opts) {
	const includeToolResults = opts.includeToolResults;
	let sessionId;
	let turns;
	let pipeline;
	let projector;
	let source;
	if (opts.sessionFile) {
		const file = readSessionFile(opts.sessionFile);
		sessionId = file.sessionId;
		const fromDb = await loadTurns(sessionId);
		if (fromDb) {
			turns = fromDb;
			pipeline = await sessionPipeline(sessionId) ?? "wire";
			projector = "db";
			source = "db";
		} else {
			const data = await buildSliceData(file.entries, { sessionId });
			turns = data.turns;
			pipeline = data.pipeline;
			projector = data.projector;
			saveTurns(sessionId, turns, pipeline);
			source = "computed";
		}
	} else if (opts.manager) {
		const sm = opts.manager;
		sessionId = sm.getSessionId();
		const fromDb = await loadTurns(sessionId);
		if (fromDb) {
			turns = fromDb;
			pipeline = await sessionPipeline(sessionId) ?? "wire";
			projector = "db";
			source = "db";
		} else {
			const data = await buildSliceData(sm.getEntries(), {
				sessionId,
				leafId: sm.getLeafId() ?? null
			});
			turns = data.turns;
			pipeline = data.pipeline;
			projector = data.projector;
			saveTurns(sessionId, turns, pipeline);
			source = "computed";
		}
	} else throw new Error("No session source: pass sessionFile or run inside a live session.");
	const selected = selectTurns(turns, opts.selector);
	const lines = toJsonLines(selected, includeToolResults);
	const dir = mkdtempSync(join(tmpdir(), "pie-session-slice-"));
	const path = join(dir, `slice-${sessionId.slice(0, 8)}.jsonl`);
	writeFileSync(path, lines.join("\n") + (lines.length > 0 ? "\n" : ""), { mode: 384 });
	return {
		path,
		sessionId,
		turns: selected.length,
		records: lines.length,
		includeToolResults,
		pipeline,
		projector,
		source
	};
}
function outcomeText(o) {
	return JSON.stringify(o);
}
function parseBoundedArgs(args) {
	const includeToolResults = /--tools\b/.test(args);
	const range = args.match(/--range\s+(\d+)\s*:\s*(\d+)/);
	if (range) return {
		selector: {
			type: "range",
			start: Number(range[1]),
			end: Number(range[2])
		},
		includeToolResults
	};
	if (/--first\b/.test(args)) {
		const n = args.match(/(\d+)/)?.[1];
		return {
			selector: {
				type: "first",
				n: Number(n ?? 5)
			},
			includeToolResults
		};
	}
	const n = args.match(/(\d+)/)?.[1];
	return {
		selector: {
			type: "last",
			n: Number(n ?? 5)
		},
		includeToolResults
	};
}
function pieSessionSlices(pi) {
	ensureDb();
	const lastLeaf = /* @__PURE__ */ new Map();
	let timer;
	pi.on("session_start", () => {
		ensureDb();
	});
	pi.on("message_end", (_event, ctx) => {
		try {
			const sm = ctx.sessionManager;
			if (!sm) return;
			const sessionId = sm.getSessionId();
			const leafId = sm.getLeafId() ?? "";
			if (lastLeaf.get(sessionId) === leafId) return;
			lastLeaf.set(sessionId, leafId);
			if (timer) clearTimeout(timer);
			timer = setTimeout(() => {
				(async () => {
					try {
						const data = await buildSliceData(sm.getEntries(), {
							sessionId,
							leafId: sm.getLeafId() ?? null
						});
						await saveTurns(sessionId, data.turns, data.pipeline);
					} catch {}
				})();
			}, 2e3);
			if (typeof timer.unref === "function") timer.unref();
		} catch {}
	});
	pi.on("session_shutdown", (_event, ctx) => {
		try {
			if (timer) clearTimeout(timer);
			const sm = ctx.sessionManager;
			if (!sm) return;
			const sessionId = sm.getSessionId();
			(async () => {
				try {
					const data = await buildSliceData(sm.getEntries(), {
						sessionId,
						leafId: sm.getLeafId() ?? null
					});
					await saveTurns(sessionId, data.turns, data.pipeline);
				} catch {}
			})();
		} catch {}
	});
	pi.registerTool({
		name: "session_slice",
		label: "Session slice",
		description: "Export an exact slice of session history (user-anchored turns) to a JSONL file. Full or bounded turn windows, with or without verbatim tool results. Returns the file path only; the caller reads it. Smart filtered slices are not yet supported.",
		promptSnippet: "Export session slices with session_slice (full or bounded, path-only return)",
		promptGuidelines: ["Use session_slice for full-context or bounded-context session handoffs; never paste whole histories inline."],
		parameters: SessionSliceInputSchema,
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			const includeToolResults = params.includeToolResults ?? false;
			const manager = ctx?.sessionManager;
			const outcome = await runSlice({
				selector: toSelector(params),
				includeToolResults,
				sessionFile: params.sessionFile,
				manager
			});
			return {
				content: [{
					type: "text",
					text: outcomeText(outcome)
				}],
				details: outcome
			};
		},
		renderCall(args, theme, context) {
			const summary = `${theme.fg("success", theme.bold("session_slice"))}${theme.fg("muted", ` · ${args.mode}`)}`;
			if (!context.expanded) return new Text(summary, 0, 0);
			return new Text(`${summary}\n${theme.fg("muted", JSON.stringify(args))}`, 0, 0);
		},
		renderResult(result, options, theme) {
			if (!options.expanded) return new Text("", 0, 0);
			const text = result.content.find((c) => c.type === "text");
			return new Text(`\n${theme.fg("border", String(text?.text ?? ""))}`, 0, 0);
		}
	});
	pi.registerCommand("session-slice-full", {
		description: "Export the full session slice to a JSONL file (path only)",
		handler: async (args, ctx) => {
			const includeToolResults = /--tools\b/.test(args);
			const sm = ctx.sessionManager;
			try {
				const outcome = await runSlice({
					selector: { type: "full" },
					includeToolResults,
					manager: sm
				});
				ctx.ui.notify(`Slice: ${outcome.path} (${outcome.turns} turns, ${outcome.records} records)`, "info");
			} catch (error) {
				ctx.ui.notify(`Slice failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
	});
	pi.registerCommand("session-slice-bounded", {
		description: "Export a bounded session slice: /session-slice-bounded [N] [--first] [--range a:b] [--tools]",
		handler: async (args, ctx) => {
			const parsed = parseBoundedArgs(args);
			const sm = ctx.sessionManager;
			try {
				const outcome = await runSlice({
					selector: parsed.selector,
					includeToolResults: parsed.includeToolResults,
					manager: sm
				});
				ctx.ui.notify(`Slice: ${outcome.path} (${outcome.turns} turns, ${outcome.records} records)`, "info");
			} catch (error) {
				ctx.ui.notify(`Slice failed: ${error instanceof Error ? error.message : String(error)}`, "error");
			}
		}
	});
}
//#endregion
export { pieSessionSlices as default, runSlice };
