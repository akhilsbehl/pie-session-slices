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
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { TurnData } from "./slice.js";

export const DB_DIR = join(homedir(), ".pi", "agent", "runtime", "session-slices");
export const DB_PATH = join(DB_DIR, "slices.duckdb");

type DuckDb = {
  Database: new (path: string) => {
    all(sql: string, ...args: Array<unknown>): void;
    run(sql: string, ...args: Array<unknown>): void;
    close(cb?: (err: Error | null) => void): void;
  };
};

let duckdbMod: DuckDb | null = null;
let db: {
  all(sql: string, ...args: Array<unknown>): void;
  run(sql: string, ...args: Array<unknown>): void;
} | null = null;
let unavailable = false;

function rows<T>(database: NonNullable<typeof db>, sql: string, ...params: Array<unknown>): Promise<T[]> {
  return new Promise((resolve, reject) => {
    (database.all as (...a: Array<unknown>) => void)(sql, ...params, (err: Error | null, result: T[]) => {
      if (err) reject(err);
      else resolve(result ?? []);
    });
  });
}

function exec(database: NonNullable<typeof db>, sql: string, ...params: Array<unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    (database.run as (...a: Array<unknown>) => void)(sql, ...params, (err: Error | null) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

/** Ensure the DB exists and is migrated. Returns false (never throws) when unavailable. */
export async function ensureDb(): Promise<boolean> {
  if (db) return true;
  if (unavailable) return false;
  try {
    mkdirSync(DB_DIR, { recursive: true });
    duckdbMod ??= (await import("duckdb")) as unknown as DuckDb;
    const instance = new duckdbMod.Database(DB_PATH);
    db = instance;
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

export function isDbAvailable(): boolean {
  return db !== null;
}

/** Stored pipeline for a session, or null when unknown. Never throws. */
export async function sessionPipeline(sessionId: string): Promise<"wire" | "projection-only" | null> {
  try {
    if (!(await ensureDb()) || !db) return null;
    const found = await rows<{ pipeline: string }>(
      db, `SELECT pipeline FROM sessions WHERE session_id = ?`, sessionId);
    const value = found[0]?.pipeline;
    return value === "wire" || value === "projection-only" ? value : null;
  } catch {
    return null;
  }
}

/** Idempotent full-session write (debounced live capture rewrites; cheap at session scale). */
export async function saveTurns(
  sessionId: string,
  turns: TurnData[],
  pipeline: string,
): Promise<boolean> {
  try {
    if (!(await ensureDb()) || !db) return false;
    await exec(db, `DELETE FROM turns WHERE session_id = ?`, sessionId);
    await exec(db, `DELETE FROM tool_results WHERE session_id = ?`, sessionId);
    let seq = 0;
    for (const t of turns) {
      for (const r of t.records) {
        seq += 1;
        await exec(
          db,
          `INSERT INTO turns(session_id, turn_id, turn_idx, seq, kind, source_entry_id, payload)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sessionId, t.turnId, t.turnIdx, seq, r.kind, r.sourceEntryId, r.payload,
        );
      }
      for (const tr of t.toolResults) {
        await exec(
          db,
          `INSERT INTO tool_results(session_id, turn_id, seq, tool_name, call_id, text, is_error)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          sessionId, tr.turnId, tr.seq, tr.toolName, tr.callId, tr.text, tr.isError,
        );
      }
    }
    await exec(
      db,
      `INSERT INTO sessions(session_id, turn_count, pipeline, updated_at)
       VALUES (?, ?, ?, ?) ON CONFLICT (session_id)
       DO UPDATE SET turn_count = excluded.turn_count, pipeline = excluded.pipeline,
                     updated_at = excluded.updated_at`,
      sessionId, turns.length, pipeline, new Date().toISOString(),
    );
    return true;
  } catch {
    return false;
  }
}

/** Load cached turns, or null on miss/unavailable (caller falls back to on-the-fly). */
export async function loadTurns(sessionId: string): Promise<TurnData[] | null> {
  try {
    if (!(await ensureDb()) || !db) return null;
    const recs = await rows<{
      turn_id: string; turn_idx: number; seq: number; kind: string;
      source_entry_id: string; payload: string;
    }>(db, `SELECT turn_id, turn_idx, seq, kind, source_entry_id, payload FROM turns
            WHERE session_id = ? ORDER BY turn_idx, seq`, sessionId);
    if (recs.length === 0) return null;
    const tools = await rows<{
      turn_id: string; seq: number; tool_name: string; call_id: string;
      text: string; is_error: boolean;
    }>(db, `SELECT turn_id, seq, tool_name, call_id, text, is_error FROM tool_results
            WHERE session_id = ? ORDER BY turn_id, seq`, sessionId);
    const byTurn = new Map<string, TurnData>();
    for (const r of recs) {
      let t = byTurn.get(r.turn_id);
      if (!t) {
        t = { turnId: r.turn_id, turnIdx: r.turn_idx, records: [], toolResults: [] };
        byTurn.set(r.turn_id, t);
      }
      t.records.push({
        sourceEntryId: r.source_entry_id, turnId: r.turn_id,
        kind: r.kind as TurnData["records"][number]["kind"], payload: r.payload,
      });
    }
    for (const tr of tools) {
      const t = byTurn.get(tr.turn_id);
      if (!t) continue;
      t.toolResults.push({
        turnId: tr.turn_id, seq: tr.seq, toolName: tr.tool_name,
        callId: tr.call_id, text: tr.text, isError: !!tr.is_error,
      });
    }
    return [...byTurn.values()].sort((a, b) => a.turnIdx - b.turnIdx);
  } catch {
    return null;
  }
}
