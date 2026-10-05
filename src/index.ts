/**
 * pie-session-slices — extension entry.
 *
 * Agent tool: session_slice (full | bounded turn windows, optional tool results).
 * User commands: /session-slice-full, /session-slice-bounded.
 * Background: silent turn-by-turn DuckDB capture (DB lookup at read time,
 * on-the-fly wire pipeline as fallback + write-through cache).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { parseSessionEntries } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type, type Static } from "typebox";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import {
  buildSliceData,
  selectTurns,
  toJsonLines,
  type SliceData,
  type SliceSelector,
  type TurnData,
} from "./slice.js";
import { ensureDb, loadTurns, saveTurns, sessionPipeline } from "./store.js";

const SessionSliceInputSchema = Type.Object({
  mode: Type.Union([Type.Literal("full"), Type.Literal("bounded")], {
    description: "full = all turns; bounded = a turn window (requires lastN, firstN, or start/end).",
  }),
  lastN: Type.Optional(Type.Number({ minimum: 1, description: "Bounded: keep the last N turns." })),
  firstN: Type.Optional(Type.Number({ minimum: 1, description: "Bounded: keep the first N turns." })),
  start: Type.Optional(Type.Number({ minimum: 1, description: "Range window: first turn (1-indexed)." })),
  end: Type.Optional(Type.Number({ minimum: 1, description: "Range window: last turn (1-indexed, inclusive)." })),
  includeToolResults: Type.Optional(
    Type.Boolean({ description: "Join verbatim tool results into the slice. Default false." }),
  ),
  sessionFile: Type.Optional(
    Type.String({ description: "Absolute path to a session JSONL file. Default: the live session." }),
  ),
});

type SessionSliceInput = Static<typeof SessionSliceInputSchema>;

type SessionManagerLike = {
  getSessionId(): string;
  getSessionFile(): string | undefined;
  getLeafId(): string | null | undefined;
  getEntries(): Array<Record<string, unknown>>;
};

function toSelector(input: SessionSliceInput): SliceSelector {
  if (input.mode === "full") return { type: "full" };
  if (input.start !== undefined || input.end !== undefined) {
    return {
      type: "range",
      start: input.start ?? 1,
      end: input.end ?? Number.MAX_SAFE_INTEGER,
    };
  }
  if (input.firstN !== undefined) return { type: "first", n: Math.floor(input.firstN) };
  if (input.lastN !== undefined) return { type: "last", n: Math.floor(input.lastN) };
  return { type: "last", n: 5 };
}

function readSessionFile(sessionFile: string): { sessionId: string; entries: Array<Record<string, unknown>> } {
  const content = readFileSync(sessionFile, "utf8");
  const parsed = parseSessionEntries(content) as unknown as Array<Record<string, unknown>>;
  const header = parsed.find((e) => e["type"] === "session");
  const sessionId =
    typeof header?.["id"] === "string" ? (header["id"] as string) : basename(sessionFile, ".jsonl");
  return { sessionId, entries: parsed.filter((e) => e["type"] !== "session") };
}

export interface SliceOutcome {
  path: string;
  sessionId: string;
  turns: number;
  records: number;
  includeToolResults: boolean;
  pipeline: SliceData["pipeline"];
  projector: SliceData["projector"] | "db";
  source: "db" | "computed";
}

export async function runSlice(
  opts: {
    selector: SliceSelector;
    includeToolResults: boolean;
    sessionFile?: string;
    manager?: SessionManagerLike;
  },
): Promise<SliceOutcome> {
  const includeToolResults = opts.includeToolResults;
  let sessionId: string;
  let turns: TurnData[];
  let pipeline: SliceData["pipeline"];
  let projector: SliceOutcome["projector"];
  let source: SliceOutcome["source"];

  if (opts.sessionFile) {
    const file = readSessionFile(opts.sessionFile);
    sessionId = file.sessionId;
    const fromDb = await loadTurns(sessionId);
    if (fromDb) {
      turns = fromDb;
      pipeline = (await sessionPipeline(sessionId)) ?? "wire";
      projector = "db";
      source = "db";
    } else {
      const data = await buildSliceData(file.entries, { sessionId });
      turns = data.turns;
      pipeline = data.pipeline;
      projector = data.projector;
      await saveTurns(sessionId, turns, pipeline);
      source = "computed";
    }
  } else if (opts.manager) {
    const sm = opts.manager;
    sessionId = sm.getSessionId();
    const fromDb = await loadTurns(sessionId);
    if (fromDb) {
      turns = fromDb;
      pipeline = (await sessionPipeline(sessionId)) ?? "wire";
      projector = "db";
      source = "db";
    } else {
      const data = await buildSliceData(sm.getEntries(), { sessionId, leafId: sm.getLeafId() ?? null });
      turns = data.turns;
      pipeline = data.pipeline;
      projector = data.projector;
      await saveTurns(sessionId, turns, pipeline);
      source = "computed";
    }
  } else {
    throw new Error("No session source: pass sessionFile or run inside a live session.");
  }

  const selected = selectTurns(turns, opts.selector);
  const lines = toJsonLines(selected, includeToolResults);
  const dir = mkdtempSync(join(tmpdir(), "pie-session-slice-"));
  const path = join(dir, `slice-${sessionId.slice(0, 8)}.jsonl`);
  writeFileSync(path, lines.join("\n") + (lines.length > 0 ? "\n" : ""), { mode: 0o600 });

  return {
    path,
    sessionId,
    turns: selected.length,
    records: lines.length,
    includeToolResults,
    pipeline,
    projector,
    source,
  };
}

function outcomeText(o: SliceOutcome): string {
  return JSON.stringify(o);
}

function parseBoundedArgs(args: string): { selector: SliceSelector; includeToolResults: boolean } {
  const includeToolResults = /--tools\b/.test(args);
  const range = args.match(/--range\s+(\d+)\s*:\s*(\d+)/);
  if (range) return { selector: { type: "range", start: Number(range[1]), end: Number(range[2]) }, includeToolResults };
  if (/--first\b/.test(args)) {
    const n = args.match(/(\d+)/)?.[1];
    return { selector: { type: "first", n: Number(n ?? 5) }, includeToolResults };
  }
  const n = args.match(/(\d+)/)?.[1];
  return { selector: { type: "last", n: Number(n ?? 5) }, includeToolResults };
}

export default function pieSessionSlices(pi: ExtensionAPI): void {
  // Silent background capture: ensure DB on start, persist after each message.
  void ensureDb();
  const lastLeaf = new Map<string, string>();
  let timer: ReturnType<typeof setTimeout> | undefined;

  pi.on("session_start", () => {
    void ensureDb();
  });

  pi.on("message_end", (_event, ctx) => {
    try {
      const sm = (ctx as unknown as { sessionManager?: SessionManagerLike }).sessionManager;
      if (!sm) return;
      const sessionId = sm.getSessionId();
      const leafId = sm.getLeafId() ?? "";
      if (lastLeaf.get(sessionId) === leafId) return;
      lastLeaf.set(sessionId, leafId);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        void (async () => {
          try {
            const data = await buildSliceData(sm.getEntries(), { sessionId, leafId: sm.getLeafId() ?? null });
            await saveTurns(sessionId, data.turns, data.pipeline);
          } catch {
            // Silent: capture must never interrupt the session.
          }
        })();
      }, 2000);
      if (typeof (timer as unknown as { unref?: () => void }).unref === "function") {
        (timer as unknown as { unref: () => void }).unref();
      }
    } catch {
      // Silent.
    }
  });

  pi.on("session_shutdown", (_event, ctx) => {
    try {
      if (timer) clearTimeout(timer);
      const sm = (ctx as unknown as { sessionManager?: SessionManagerLike }).sessionManager;
      if (!sm) return;
      const sessionId = sm.getSessionId();
      void (async () => {
        try {
          const data = await buildSliceData(sm.getEntries(), { sessionId, leafId: sm.getLeafId() ?? null });
          await saveTurns(sessionId, data.turns, data.pipeline);
        } catch {
          // Silent.
        }
      })();
    } catch {
      // Silent.
    }
  });

  pi.registerTool({
    name: "session_slice",
    label: "Session slice",
    description:
      "Export an exact slice of session history (user-anchored turns) to a JSONL file. Full or bounded turn windows, with or without verbatim tool results. Returns the file path only; the caller reads it. Smart filtered slices are not yet supported.",
    promptSnippet: "Export session slices with session_slice (full or bounded, path-only return)",
    promptGuidelines: [
      "Use session_slice for full-context or bounded-context session handoffs; never paste whole histories inline.",
    ],
    parameters: SessionSliceInputSchema,
    async execute(_toolCallId, params: SessionSliceInput, _signal, _onUpdate, ctx) {
      const includeToolResults = params.includeToolResults ?? false;
      const manager = (ctx as unknown as { sessionManager?: SessionManagerLike } | undefined)?.sessionManager;
      const outcome = await runSlice({
        selector: toSelector(params),
        includeToolResults,
        sessionFile: params.sessionFile,
        manager,
      });
      return {
        content: [{ type: "text" as const, text: outcomeText(outcome) }],
        details: outcome,
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
      return new Text(`\n${theme.fg("border", String((text as { text?: string } | undefined)?.text ?? ""))}`, 0, 0);
    },
  });

  pi.registerCommand("session-slice-full", {
    description: "Export the full session slice to a JSONL file (path only)",
    handler: async (args, ctx) => {
      const includeToolResults = /--tools\b/.test(args);
      const sm = (ctx as unknown as { sessionManager?: SessionManagerLike }).sessionManager;
      try {
        const outcome = await runSlice({ selector: { type: "full" }, includeToolResults, manager: sm });
        ctx.ui.notify(`Slice: ${outcome.path} (${outcome.turns} turns, ${outcome.records} records)`, "info");
      } catch (error) {
        ctx.ui.notify(`Slice failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });

  pi.registerCommand("session-slice-bounded", {
    description: "Export a bounded session slice: /session-slice-bounded [N] [--first] [--range a:b] [--tools]",
    handler: async (args, ctx) => {
      const parsed = parseBoundedArgs(args);
      const sm = (ctx as unknown as { sessionManager?: SessionManagerLike }).sessionManager;
      try {
        const outcome = await runSlice({
          selector: parsed.selector,
          includeToolResults: parsed.includeToolResults,
          manager: sm,
        });
        ctx.ui.notify(`Slice: ${outcome.path} (${outcome.turns} turns, ${outcome.records} records)`, "info");
      } catch (error) {
        ctx.ui.notify(`Slice failed: ${error instanceof Error ? error.message : String(error)}`, "error");
      }
    },
  });
}
