import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import {
  MemoryFile,
  Category,
  parse,
  serialize,
  emptyFile,
  formatEntry,
  appendEntry,
  getHeader,
  getSection,
  searchEntries,
  compact,
  INSTRUCTION_FOOTER,
} from "./format.js";
import { TOKEN_BUDGET, truncateToBudget, countTokens } from "./budget.js";
import { styleBlock as styleBlockSync } from "./style.js";
import { globalDir, globalFile } from "./paths.js";
import { recordSnapshot } from "./history.js";

export const PROJECT_FILE = ".ai-memory.md";
export const ARCHIVE_FILE = ".ai-memory.archive.md";
export const GLOBAL_DIR = globalDir();
export const GLOBAL_FILE = globalFile();

const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json", ".hg", ".svn"];
const AUTO_COMPACT_LINES = 200;

export function ensureGlobalDir(): void {
  if (!fs.existsSync(GLOBAL_DIR)) {
    fs.mkdirSync(GLOBAL_DIR, { recursive: true });
  }
}

export function findProjectFile(startDir: string = process.cwd()): string | null {
  let dir = path.resolve(startDir);
  const root = path.parse(dir).root;
  while (true) {
    const candidate = path.join(dir, PROJECT_FILE);
    if (fs.existsSync(candidate)) return candidate;
    if (dir === root) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function findProjectRoot(startDir: string = process.cwd()): string {
  const start = path.resolve(startDir);
  const root = path.parse(start).root;

  const existing = findProjectFile(start);
  if (existing) return path.dirname(existing);

  let dir = start;
  while (true) {
    for (const marker of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(dir, marker))) return dir;
    }
    if (dir === root) break;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return start;
}

export function projectFilePath(cwd: string = process.cwd()): string {
  const existing = findProjectFile(cwd);
  if (existing) return existing;
  const root = findProjectRoot(cwd);
  return path.join(root, PROJECT_FILE);
}

function readFileSafe(p: string): string {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return "";
  }
}

export function loadFile(filePath: string): MemoryFile {
  const text = readFileSafe(filePath);
  if (!text) {
    const isGlobal = path.resolve(filePath) === path.resolve(GLOBAL_FILE);
    let projectName = "global";
    if (!isGlobal) {
      const dirBase = path.basename(path.dirname(filePath));
      projectName = dirBase.startsWith(".") ? "project" : dirBase;
    }
    return emptyFile(projectName);
  }
  return parse(text);
}

export function saveFile(filePath: string, file: MemoryFile): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

  let text = serialize(file);

  const lineCount = text.split("\n").length;
  if (lineCount > AUTO_COMPACT_LINES) {
    const archived = autoCompactInline(file);
    text = serialize(file);
    if (archived.length > 0) {
      const archivePath = path.join(dir, ARCHIVE_FILE);
      appendToArchive(archivePath, archived);
      process.stderr.write(`[memorybridge] auto-compact: archived ${archived.length} stale entries (> 90 days old) to ${ARCHIVE_FILE}\n`);
    } else {
      process.stderr.write(`[memorybridge] file is ${lineCount} lines but no entries are old enough to archive. Consider: memorybridge compact\n`);
    }
  }

  const tmp = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, text, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch (err) {
    try { fs.unlinkSync(tmp); } catch {}
    throw err;
  }

  recordSnapshot(filePath, text);
}

function autoCompactInline(file: MemoryFile): string[] {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const archived: string[] = [];

  for (const [section, lines] of file.sections.entries()) {
    if (section === "@header" || section === "@env") continue;
    const kept: string[] = [];
    for (const l of lines) {
      const m = l.match(/\[(\d{4}-\d{2}-\d{2})\]/);
      if (m && new Date(m[1]) < cutoff) {
        archived.push(`${section}: ${l}`);
        continue;
      }
      kept.push(l);
    }
    file.sections.set(section, kept);
  }
  return archived;
}

function appendToArchive(archivePath: string, archived: string[]): void {
  const existing = fs.existsSync(archivePath) ? fs.readFileSync(archivePath, "utf8") : "";
  const header = existing ? "" : "# .ai-memory.archive.md | MemoryBridge | v1\n# Stale entries auto-archived from .ai-memory.md\n\n";
  const stamp = new Date().toISOString().slice(0, 10);
  const block = archived.map((a) => `[${stamp}] ${a}`).join("\n") + "\n";
  fs.writeFileSync(archivePath, header + existing + block, "utf8");
}

export function lineCount(filePath: string): number {
  if (!fs.existsSync(filePath)) return 0;
  try {
    return fs.readFileSync(filePath, "utf8").split("\n").length;
  } catch {
    return 0;
  }
}

export interface SaveResult {
  saved: boolean;
  reason: string;
  entry: string;
  file: string;
}

const BLOCKED_PATTERNS = [
  /\bpassword\s*[:=]/i,
  /\bapi[_-]?key\s*[:=]/i,
  /\bsecret\s*[:=]/i,
  /\btoken\s*[:=]/i,
  /\bbearer\s+[A-Za-z0-9._-]{16,}/i,
  /\b[A-Za-z0-9_-]{32,}\b\s*[:=]?\s*$/m,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
];

export function isBlocked(content: string): boolean {
  return BLOCKED_PATTERNS.some((re) => re.test(content));
}

const RECENT_LOAD_TTL_MS = 10 * 60 * 1000;
const RECENT_LOAD_OVERLAP_THRESHOLD = 0.8;
const recentLoads: { ts: number; tokens: Set<string> }[] = [];

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9 ]+/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2)
  );
}

function containment(candidate: Set<string>, reference: Set<string>): number {
  if (candidate.size === 0) return 0;
  let inter = 0;
  for (const t of candidate) if (reference.has(t)) inter++;
  return inter / candidate.size;
}

export function noteRecentLoad(text: string): void {
  const now = Date.now();
  while (recentLoads.length > 0 && now - recentLoads[0].ts > RECENT_LOAD_TTL_MS) {
    recentLoads.shift();
  }
  recentLoads.push({ ts: now, tokens: tokenize(text) });
  if (recentLoads.length > 20) recentLoads.shift();
}

export function overlapsRecentLoad(content: string): boolean {
  const now = Date.now();
  const candidate = tokenize(content);
  if (candidate.size < 4) return false;
  for (const r of recentLoads) {
    if (now - r.ts > RECENT_LOAD_TTL_MS) continue;
    if (containment(candidate, r.tokens) >= RECENT_LOAD_OVERLAP_THRESHOLD) return true;
  }
  return false;
}

export function saveMemory(
  content: string,
  category: Category,
  opts: { scope?: "project" | "global"; cwd?: string; projectPath?: string } = {}
): SaveResult {
  const cwd = opts.projectPath ?? opts.cwd ?? process.cwd();
  const scope = opts.scope ?? "project";

  if (isBlocked(content)) {
    return { saved: false, reason: "blocked-sensitive-content", entry: "", file: "" };
  }

  if (overlapsRecentLoad(content)) {
    return { saved: false, reason: "duplicates-recently-loaded-memory", entry: "", file: "" };
  }

  const filePath = scope === "global" ? (ensureGlobalDir(), GLOBAL_FILE) : projectFilePath(cwd);
  const file = loadFile(filePath);
  const entry = formatEntry(content, category);
  const res = appendEntry(file, entry, category);
  saveFile(filePath, file);

  return {
    saved: res.added,
    reason: res.reason,
    entry,
    file: filePath,
  };
}

export interface LoadResult {
  text: string;
  tokens: number;
  truncated: boolean;
  files: { project?: string; global?: string };
}

export function loadMemory(opts: { section?: string; cwd?: string; projectPath?: string; budget?: number } = {}): LoadResult {
  const cwd = opts.projectPath ?? opts.cwd ?? process.cwd();
  const budget = opts.budget ?? TOKEN_BUDGET.DEFAULT_LOAD;

  const projectPath = findProjectFile(cwd);
  const globalExists = fs.existsSync(GLOBAL_FILE);

  if (!projectPath && !globalExists) {
    return { text: "", tokens: 0, truncated: false, files: {} };
  }

  const parts: string[] = [];
  if (globalExists) {
    const globalFile = loadFile(GLOBAL_FILE);
    const block = opts.section ? getSection(globalFile, opts.section) : getHeader(globalFile);
    if (block.trim()) {
      parts.push("# Global memory");
      parts.push(block);
    }
  }
  if (projectPath) {
    const projectFile = loadFile(projectPath);
    const block = opts.section ? getSection(projectFile, opts.section) : getHeader(projectFile);
    if (block.trim()) {
      parts.push(`# Project memory (${path.basename(path.dirname(projectPath))})`);
      parts.push(block);
    }
  }

  const combined = parts.join("\n\n");
  if (!combined.trim()) {
    return { text: "", tokens: 0, truncated: false, files: { project: projectPath ?? undefined, global: globalExists ? GLOBAL_FILE : undefined } };
  }

  const style = styleBlockSync();
  const styleSuffix = style ? "\n\n" + style : "";
  const withFooter = combined + styleSuffix + INSTRUCTION_FOOTER;
  const { text, tokens, truncated } = truncateToBudget(withFooter, budget);
  noteRecentLoad(text);

  return {
    text,
    tokens,
    truncated,
    files: { project: projectPath ?? undefined, global: globalExists ? GLOBAL_FILE : undefined },
  };
}

export function listEntries(opts: { cwd?: string } = {}): { project: string[]; global: string[]; projectFile?: string } {
  const cwd = opts.cwd ?? process.cwd();
  const projectPath = findProjectFile(cwd);
  const project: string[] = [];
  const global: string[] = [];

  if (projectPath) {
    const f = loadFile(projectPath);
    for (const [section, lines] of f.sections.entries()) {
      for (const l of lines) project.push(`${section}: ${l}`);
    }
  }
  if (fs.existsSync(GLOBAL_FILE)) {
    const f = loadFile(GLOBAL_FILE);
    for (const [section, lines] of f.sections.entries()) {
      for (const l of lines) global.push(`${section}: ${l}`);
    }
  }
  return { project, global, projectFile: projectPath ?? undefined };
}

export function searchMemory(query: string, opts: { cwd?: string; projectPath?: string; max?: number } = {}): {
  results: { source: string; line: string }[];
  tokens: number;
} {
  const cwd = opts.projectPath ?? opts.cwd ?? process.cwd();
  const max = opts.max ?? 10;
  const results: { source: string; line: string }[] = [];

  const projectPath = findProjectFile(cwd);
  if (projectPath) {
    const f = loadFile(projectPath);
    for (const m of searchEntries(f, query, max)) {
      results.push({ source: "project", line: m });
      if (results.length >= max) break;
    }
  }
  if (results.length < max && fs.existsSync(GLOBAL_FILE)) {
    const f = loadFile(GLOBAL_FILE);
    for (const m of searchEntries(f, query, max - results.length)) {
      results.push({ source: "global", line: m });
      if (results.length >= max) break;
    }
  }

  const tokens = countTokens(results.map((r) => r.line).join("\n"));
  return { results, tokens };
}

export function compactMemory(opts: { cwd?: string; staleDays?: number } = {}): {
  archived: string[];
  projectFile?: string;
  archiveFile?: string;
} {
  const cwd = opts.cwd ?? process.cwd();
  const staleDays = opts.staleDays ?? 90;
  const projectPath = findProjectFile(cwd);
  if (!projectPath) return { archived: [] };

  const file = loadFile(projectPath);
  const { archived } = compact(file, staleDays);
  saveFile(projectPath, file);

  if (archived.length > 0) {
    const archivePath = path.join(path.dirname(projectPath), ARCHIVE_FILE);
    const archiveText = readFileSafe(archivePath);
    const header = archiveText ? "" : "# .ai-memory.archive.md | MemoryBridge | v1\n# Stale entries moved here. Restore with: memorybridge restore\n\n";
    const appended = header + archiveText + archived.map((a) => `[${new Date().toISOString().slice(0, 10)}] ${a}`).join("\n") + "\n";
    fs.writeFileSync(archivePath, appended, "utf8");
    return { archived, projectFile: projectPath, archiveFile: archivePath };
  }

  return { archived, projectFile: projectPath };
}
