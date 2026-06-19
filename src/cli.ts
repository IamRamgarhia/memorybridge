#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import os from "node:os";
import {
  saveMemory,
  loadMemory,
  searchMemory,
  listEntries,
  compactMemory,
  findProjectFile,
  findProjectRoot,
  projectFilePath,
  lineCount,
  GLOBAL_FILE,
  GLOBAL_DIR,
} from "./memory.js";
import { Category } from "./format.js";
import { scan, formatScanReport, detectTools } from "./scan.js";
import { installAll, formatInstallReport } from "./install.js";
import { uninstall, formatUninstallReport } from "./uninstall.js";
import { compare, formatCompare } from "./compare.js";
import { formatSettings } from "./settings.js";
import { runDiagnostics, formatDiagnostics } from "./diagnostics.js";
import { TOKEN_BUDGET, countTokens } from "./budget.js";
import { computeStats, formatStats, logUsage } from "./stats.js";
import { applyAction, addCustomDirective, clearCustomDirectives, formatStyleStatus, getCurrentStyle, StyleAction } from "./style.js";
import { emit, emitAll, formatEmitReport, FORMATS, EmitFormat } from "./emit.js";
import { undoLast, diffSnapshot, formatLog, formatDiff } from "./history.js";
import { loadFile, saveFile as memorySaveFile } from "./memory.js";
import { pinSection, unpinSection, getPinnedSections, appendEntry } from "./format.js";
import { listProjects, rebuildIndex, globalSearch, formatProjectsList, formatGlobalSearch } from "./projects.js";
import { scoreFile, formatQualityReport } from "./quality.js";
import { scanProjectSymbols, formatSymbolsForMemory, formatSymbolsReport } from "./symbols.js";

const VERSION = "0.1.0";

function help(): string {
  return `
MemoryBridge v${VERSION} — cross-tool AI memory, 400 tokens not 4,000

Usage:
  memorybridge <command> [args]

Most-used (intuitive aliases):
  settings                        One-page settings dashboard — show + change everything
  shorter                         Shorter AI responses (one step — saves more tokens)
  longer                          Longer AI responses (one step — more detail)
  savings                         Show how many tokens + $ you've saved
  show                            Preview what the AI sees on session start

Commands:
  init                            Detect AI tools and wire them up to MemoryBridge
  uninstall [--purge]             Remove MemoryBridge from AI tool configs (clean rollback)
  scan                            Show all installed AI tools + projects with memory
  add <text> [--category <c>] [--global]
                                  Save a memory entry. Default category: note
  list [--global]                 Show all saved memories
  search <query>                  Search memories
  load [--section <name>]         Print what an AI would see on session start
  open                            Open the current project's memory file
  stats                           Show usage data + estimated token/$ savings
  compare [--sessions <N>]        Side-by-side BEFORE vs AFTER token/cost comparison
  style [bigger|smaller|1-5|off|on|add <text>|clear]
                                  Control AI response length (saves output tokens)
  doctor                          Verify install, paths, token budget
  diagnostics                     Deep diagnostic: workspace detection, MCP server log, every health check
  compact [--days <n>]            Move stale entries to archive (default: 90 days)
  emit [<format>] [--all]         Generate AGENTS.md / CLAUDE.md / .cursorrules etc.
                                  formats: agents, claude, cursorrules, windsurfrules, geminimd,
                                  continuerules, copilot
  pin <section>                   Always load this section regardless of token cap
  unpin <section>                 Remove section from always-loaded list
  pins                            List pinned sections
  undo                            Roll back the most recent memory change
  log                             Show snapshot history for this project
  diff [<n>]                      Diff current memory vs n snapshots ago (default 1)
  index                           Rebuild the cross-project index
  projects                        List all indexed projects with memory files
  global-search <query>           Search memories across ALL indexed projects
  quality                         Score the current project's memory file (junk detector)
  symbols [save] [--max <n>]      Extract exported symbols (JS/TS/Py/Go) → @map
  help                            Show this message
  version                         Show version

Categories for 'add':  preference | decision | issue | resolved | env | note | map
  ('map' = file-path navigation cache, e.g. "auth handlers → /lib/supabase.ts:42")

Examples:
  memorybridge init
  memorybridge scan
  memorybridge add "TypeScript strict mode always" --category preference --global
  memorybridge add "Auth chosen: Supabase" --category decision
  memorybridge load
  memorybridge search supabase
`;
}

function parseFlags(args: string[]): { positional: string[]; flags: Record<string, string | boolean> } {
  const positional: string[] = [];
  const flags: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = args[i + 1];
      if (next && !next.startsWith("--")) {
        flags[key] = next;
        i++;
      } else {
        flags[key] = true;
      }
    } else {
      positional.push(a);
    }
  }
  return { positional, flags };
}

function openInEditor(p: string): void {
  if (!fs.existsSync(p)) {
    console.log(`(file does not exist yet: ${p})`);
    return;
  }
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", p], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [p], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [p], { detached: true, stdio: "ignore" }).unref();
  }
  console.log(`opened: ${p}`);
}

function cmdInit(): void {
  const report = installAll();
  console.log(formatInstallReport(report));
}

function cmdUninstall(args: string[]): void {
  const { flags } = parseFlags(args);
  const purge = !!flags.purge;
  const report = uninstall({ purge });
  console.log(formatUninstallReport(report));
}

function cmdScan(): void {
  const result = scan();
  console.log(formatScanReport(result));
}

function cmdAdd(args: string[]): void {
  const { positional, flags } = parseFlags(args);
  const text = positional.join(" ").trim();
  if (!text) {
    console.error("error: provide the memory text. Example: memorybridge add \"Use pnpm\"");
    process.exit(1);
  }
  const category = ((flags.category as string) ?? "note") as Category;
  const valid = ["preference", "decision", "issue", "resolved", "env", "note", "map"];
  if (!valid.includes(category)) {
    console.error(`error: invalid category. Use one of: ${valid.join(", ")}`);
    process.exit(1);
  }
  const scope = flags.global ? "global" : "project";
  const res = saveMemory(text, category, { scope: scope as "global" | "project" });
  if (!res.saved && res.reason === "blocked-sensitive-content") {
    console.error("blocked: this content looks like a secret (password/key/token). Not saved.");
    process.exit(2);
  }
  if (!res.saved && res.reason === "duplicates-recently-loaded-memory") {
    console.error("skipped: this content overlaps with something loaded into the AI's context this session. Not saved.");
    process.exit(3);
  }
  const verb = res.saved ? "saved" : "updated existing";
  const where = scope === "global" ? "global memory (your home dir)" : `project memory (${path.dirname(res.file)})`;
  console.log(`${verb} in ${where}`);
  console.log(`  file:  ${res.file}`);
  console.log(`  entry: ${res.entry}`);
  logUsage({ ts: new Date().toISOString(), tool: "cli", action: "save", tokens: 0, project: path.basename(path.dirname(res.file)) });
}

function cmdList(args: string[]): void {
  const { flags } = parseFlags(args);
  const { project, global, projectFile } = listEntries();
  if (flags.global) {
    console.log(`# Global memory (${GLOBAL_FILE})`);
    if (global.length === 0) console.log("(empty)");
    for (const g of global) console.log("  " + g);
    return;
  }
  console.log(`# Project memory (${projectFile ?? "no .ai-memory.md found in current dir or parents"})`);
  if (project.length === 0) console.log("(empty)");
  for (const p of project) console.log("  " + p);
  console.log("");
  console.log(`# Global memory (${GLOBAL_FILE})`);
  if (global.length === 0) console.log("(empty)");
  for (const g of global) console.log("  " + g);
}

function cmdSearch(args: string[]): void {
  const query = args.join(" ").trim();
  if (!query) {
    console.error("error: provide a search query");
    process.exit(1);
  }
  const res = searchMemory(query, { max: 10 });
  if (res.results.length === 0) {
    console.log(`no matches for "${query}"`);
    return;
  }
  for (const r of res.results) console.log(`[${r.source}] ${r.line}`);
  console.log(`\n(${res.results.length} matches, ${res.tokens} tokens)`);
}

function cmdLoad(args: string[]): void {
  const { flags } = parseFlags(args);
  const section = (flags.section as string | undefined) || undefined;
  const res = loadMemory({ section, budget: section ? TOKEN_BUDGET.HARD_CAP : TOKEN_BUDGET.DEFAULT_LOAD });
  if (!res.text) {
    console.log("(no memory found for current directory)");
    return;
  }
  console.log(res.text);
  console.log(`\n--- ${res.tokens} tokens${res.truncated ? " (truncated)" : ""} ---`);
  logUsage({ ts: new Date().toISOString(), tool: "cli", action: "load", tokens: res.tokens, project: path.basename(process.cwd()) });
}

function cmdOpen(): void {
  const projectPath = findProjectFile();
  if (projectPath) {
    openInEditor(projectPath);
  } else {
    console.log("no .ai-memory.md found in current directory or parents");
    console.log(`opening global memory: ${GLOBAL_FILE}`);
    openInEditor(GLOBAL_FILE);
  }
}

function cmdDoctor(): void {
  console.log("");
  console.log("=== MemoryBridge Doctor ===");
  console.log("");

  console.log(`  Version:           ${VERSION}`);
  console.log(`  Node:              ${process.version}`);
  console.log(`  Platform:          ${process.platform}`);
  console.log(`  Home directory:    ${os.homedir()}`);
  console.log(`  Current directory: ${process.cwd()}`);
  console.log("");

  const projectRoot = findProjectRoot();
  const projectPath = findProjectFile();
  const expectedPath = projectFilePath();

  console.log("  Project location (where .ai-memory.md will be saved):");
  console.log(`    Detected root:   ${projectRoot}`);
  console.log(`    Memory file:     ${expectedPath}`);
  if (projectPath) {
    const lines = lineCount(projectPath);
    console.log(`    Exists:          yes (${lines} lines)`);
    if (lines > 200) {
      console.log(`    [!] file exceeds 200 lines — auto-compaction triggers on next save (only stale entries are archived)`);
    } else if (lines > 150) {
      console.log(`    [!] file is approaching 200 lines — run: memorybridge compact`);
    }
  } else {
    console.log(`    Exists:          no (will be created on first save)`);
  }
  console.log("");
  console.log(`  Global memory dir: ${GLOBAL_DIR} ${fs.existsSync(GLOBAL_DIR) ? "(exists)" : "(MISSING — run: memorybridge init)"}`);
  console.log(`  Global memory:     ${GLOBAL_FILE} ${fs.existsSync(GLOBAL_FILE) ? "(exists)" : "(missing)"}`);

  console.log("");
  console.log("  Token budget:");
  console.log(`    default load:    ${TOKEN_BUDGET.DEFAULT_LOAD} tokens`);
  console.log(`    hard cap:        ${TOKEN_BUDGET.HARD_CAP} tokens`);

  const loaded = loadMemory();
  console.log(`    actual load:     ${loaded.tokens} tokens ${loaded.truncated ? "(truncated)" : ""}`);

  console.log("");
  console.log("  AI tools detected:");
  const tools = detectTools();
  for (const t of tools) {
    const mark = t.detected ? "[✓]" : "[ ]";
    console.log(`    ${mark} ${t.name.padEnd(20)} ${t.configPath ?? ""}`);
  }

  console.log("");
  const sample = "[2026-05-28] Preference: TypeScript strict mode, no implicit any.";
  console.log(`  Tokenizer check:   "${sample}" → ${countTokens(sample)} tokens`);
  console.log("");
}

function cmdStats(): void {
  const stats = computeStats();
  console.log(formatStats(stats));
}

function cmdCompare(args: string[]): void {
  const { flags } = parseFlags(args);
  const sessions = flags.sessions ? Number(flags.sessions) : 100;
  if (!Number.isFinite(sessions) || sessions <= 0) {
    console.error("error: --sessions must be a positive number");
    process.exit(1);
  }
  const r = compare({ sessionsPerMonth: sessions });
  console.log(formatCompare(r, sessions));
}

function cmdStyle(args: string[]): void {
  if (args.length === 0) {
    console.log(formatStyleStatus());
    return;
  }
  const action = args[0];
  if (action === "add") {
    const text = args.slice(1).join(" ").trim();
    if (!text) {
      console.error("error: provide directive text. Example: memorybridge style add \"no markdown headers\"");
      process.exit(1);
    }
    addCustomDirective(text);
    console.log(`added custom directive: ${text}`);
    return;
  }
  if (action === "clear") {
    clearCustomDirectives();
    console.log("custom directives cleared");
    return;
  }
  try {
    const { profile, on, changed } = applyAction(action as StyleAction);
    if (!changed && action !== "bigger" && action !== "smaller") {
      console.log(`already at: ${on ? `level ${profile.level} (${profile.name})` : "off"}`);
    } else {
      const status = on ? `level ${profile.level} of 5 (${profile.name})` : "OFF";
      console.log(`response style now: ${status}`);
      if (on && profile.estOutputSavingsPercent > 0) {
        console.log(`  estimated output token savings: ~${profile.estOutputSavingsPercent}%`);
      }
    }
  } catch (err: any) {
    console.error(`error: ${err.message}`);
    process.exit(1);
  }
}

function cmdEmit(args: string[]): void {
  const { positional, flags } = parseFlags(args);
  const force = !!flags.force;
  const dryRun = !!flags["dry-run"];
  if (flags.all || positional.length === 0) {
    const results = emitAll({ force, dryRun });
    console.log(formatEmitReport(results));
    return;
  }
  const fmtName = positional[0] as EmitFormat;
  if (!(fmtName in FORMATS)) {
    console.error(`error: unknown format. Use one of: ${Object.keys(FORMATS).join(", ")}`);
    process.exit(1);
  }
  const result = emit(fmtName, { force, dryRun });
  if ("error" in result) {
    console.log(formatEmitReport([{ format: fmtName, error: result.error }]));
  } else {
    console.log(formatEmitReport([result]));
  }
}

function cmdPin(args: string[]): void {
  const name = args.join(" ").trim();
  if (!name) {
    console.error("error: provide a section name. Example: memorybridge pin @decisions");
    process.exit(1);
  }
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.error("no .ai-memory.md found. Run `memorybridge add` first to create one.");
    process.exit(1);
  }
  const file = loadFile(projectPath);
  const added = pinSection(file, name);
  if (!added) {
    if (!file.sections.has(name.startsWith("@") ? name : `@${name}`)) {
      console.error(`error: section "${name}" does not exist in .ai-memory.md`);
      process.exit(1);
    }
    console.log(`section ${name} is already pinned`);
    return;
  }
  memorySaveFile(projectPath, file);
  console.log(`pinned ${name.startsWith("@") ? name : "@" + name} — will always load`);
}

function cmdUnpin(args: string[]): void {
  const name = args.join(" ").trim();
  if (!name) {
    console.error("error: provide a section name");
    process.exit(1);
  }
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.error("no .ai-memory.md found");
    process.exit(1);
  }
  const file = loadFile(projectPath);
  const removed = unpinSection(file, name);
  if (!removed) {
    console.log(`section ${name} was not pinned`);
    return;
  }
  memorySaveFile(projectPath, file);
  console.log(`unpinned ${name.startsWith("@") ? name : "@" + name}`);
}

function cmdPins(): void {
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.log("(no .ai-memory.md found)");
    return;
  }
  const file = loadFile(projectPath);
  const pinned = getPinnedSections(file);
  if (pinned.length === 0) {
    console.log("(no sections pinned)");
    console.log("");
    console.log("Pin a section with: memorybridge pin <section>");
    return;
  }
  console.log("Pinned sections (always loaded):");
  for (const p of pinned) console.log("  " + p);
}

function cmdUndo(): void {
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.error("no .ai-memory.md found in current dir or parents");
    process.exit(1);
  }
  const projectRoot = path.dirname(projectPath);
  const res = undoLast(projectRoot);
  if (!res.restored) {
    console.log("nothing to undo (need at least 2 snapshots)");
    return;
  }
  console.log(`restored snapshot from ${res.ts}`);
  console.log(`  file: ${res.filePath}`);
}

function cmdHistoryLog(): void {
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.log("(no .ai-memory.md found)");
    return;
  }
  const projectRoot = path.dirname(projectPath);
  console.log("");
  console.log(`History for ${path.basename(projectRoot)} (newest first):`);
  console.log("");
  console.log(formatLog(projectRoot));
  console.log("");
}

function cmdHistoryDiff(args: string[]): void {
  const n = args[0] ? Number(args[0]) : 1;
  if (!Number.isFinite(n) || n < 1) {
    console.error("error: <n> must be a positive integer");
    process.exit(1);
  }
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.log("(no .ai-memory.md found)");
    return;
  }
  const projectRoot = path.dirname(projectPath);
  const d = diffSnapshot(projectRoot, n);
  if (!d) {
    console.log(`(no snapshot ${n} entries back — only ${formatLog(projectRoot).split("\n").length} snapshots exist)`);
    return;
  }
  console.log(`Diff vs snapshot ${n} entries ago (${d.ts}):`);
  console.log("");
  console.log(formatDiff(d.current, d.previous));
}

function cmdIndex(args: string[] = []): void {
  const { flags } = parseFlags(args);
  const extraRoots: string[] = [];
  if (flags.root && typeof flags.root === "string") extraRoots.push(flags.root);
  extraRoots.push(process.cwd());
  console.log(`Scanning filesystem for projects with .ai-memory.md files (extra roots: ${extraRoots.join(", ")})…`);
  const index = rebuildIndex({ extraRoots });
  console.log(formatProjectsList(index.projects));
}

function cmdProjects(): void {
  const projects = listProjects();
  if (projects.length === 0) {
    console.log("(index is empty — run `memorybridge index` first)");
    return;
  }
  console.log(formatProjectsList(projects));
}

function cmdGlobalSearch(args: string[]): void {
  const query = args.join(" ").trim();
  if (!query) {
    console.error("error: provide a query. Example: memorybridge global-search \"supabase\"");
    process.exit(1);
  }
  const hits = globalSearch(query, 50);
  console.log(formatGlobalSearch(query, hits));
}

function cmdQuality(): void {
  const projectPath = findProjectFile();
  if (!projectPath) {
    console.error("no .ai-memory.md found in current dir or parents");
    process.exit(1);
  }
  const file = loadFile(projectPath);
  const report = scoreFile(file);
  console.log(formatQualityReport(report, projectPath));
}

function cmdSymbols(args: string[]): void {
  const { positional, flags } = parseFlags(args);
  const max = flags.max ? Number(flags.max) : 200;
  const projectPath = findProjectFile();
  const projectRoot = projectPath ? path.dirname(projectPath) : findProjectRoot();
  const symbols = scanProjectSymbols(projectRoot, { maxFiles: max, maxSymbolsPerFile: 8 });

  if (positional[0] === "save") {
    if (!projectPath) {
      console.error("no .ai-memory.md found. Run `memorybridge add ...` first to create one.");
      process.exit(1);
    }
    const file = loadFile(projectPath);
    const entries = formatSymbolsForMemory(symbols);
    file.sections.set("@symbols", entries);
    memorySaveFile(projectPath, file);
    console.log(`saved ${entries.length} symbol entries to ${projectPath} (@symbols section)`);
    console.log("");
    console.log(formatSymbolsReport(symbols));
    return;
  }
  console.log(formatSymbolsReport(symbols));
  console.log("  Tip: run `memorybridge symbols save` to write these to the @symbols section.");
  console.log("");
}

function cmdCompact(args: string[]): void {
  const { flags } = parseFlags(args);
  const days = flags.days ? Number(flags.days) : 90;
  if (!Number.isFinite(days) || days <= 0) {
    console.error("error: --days must be a positive number");
    process.exit(1);
  }
  const res = compactMemory({ staleDays: days });
  if (!res.projectFile) {
    console.log("no .ai-memory.md found in current directory or parents");
    return;
  }
  if (res.archived.length === 0) {
    console.log(`no entries older than ${days} days. nothing to compact.`);
    return;
  }
  console.log(`archived ${res.archived.length} stale entries → ${res.archiveFile}`);
  for (const a of res.archived) console.log("  - " + a);
}

async function main() {
  const [, , cmd, ...rest] = process.argv;
  switch (cmd) {
    case undefined:
    case "help":
    case "--help":
    case "-h":
      console.log(help());
      return;
    case "version":
    case "--version":
    case "-v":
      console.log(VERSION);
      return;
    case "init":
      return cmdInit();
    case "uninstall":
      return cmdUninstall(rest);
    case "settings":
    case "config":
      console.log(formatSettings());
      return;
    case "shorter":
      return cmdStyle(["smaller"]);
    case "longer":
      return cmdStyle(["bigger"]);
    case "savings":
      return cmdStats();
    case "show":
      return cmdLoad(rest);
    case "scan":
      return cmdScan();
    case "add":
      return cmdAdd(rest);
    case "list":
      return cmdList(rest);
    case "search":
      return cmdSearch(rest);
    case "load":
      return cmdLoad(rest);
    case "open":
      return cmdOpen();
    case "doctor":
      return cmdDoctor();
    case "diagnostics":
    case "diag":
      console.log(formatDiagnostics(runDiagnostics()));
      return;
    case "compact":
      return cmdCompact(rest);
    case "stats":
      return cmdStats();
    case "compare":
      return cmdCompare(rest);
    case "style":
      return cmdStyle(rest);
    case "emit":
      return cmdEmit(rest);
    case "pin":
      return cmdPin(rest);
    case "unpin":
      return cmdUnpin(rest);
    case "pins":
      return cmdPins();
    case "undo":
      return cmdUndo();
    case "log":
      return cmdHistoryLog();
    case "diff":
      return cmdHistoryDiff(rest);
    case "index":
      return cmdIndex(rest);
    case "projects":
      return cmdProjects();
    case "global-search":
      return cmdGlobalSearch(rest);
    case "quality":
      return cmdQuality();
    case "symbols":
      return cmdSymbols(rest);
    default:
      console.error(`unknown command: ${cmd}\n`);
      console.log(help());
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(`error: ${err?.message ?? err}`);
  process.exit(1);
});
