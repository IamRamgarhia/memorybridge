import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { globalDir, globalFile, styleFile, usageLog, historyDir } from "./paths.js";
import { resolveWorkspace, formatResolution } from "./workspace.js";
import { detectTools } from "./scan.js";
import { TOKEN_BUDGET, countTokens } from "./budget.js";
import { findProjectFile, loadMemory } from "./memory.js";

export interface DiagnosticIssue {
  severity: "error" | "warn" | "info";
  area: string;
  message: string;
  fix?: string;
}

export const SERVER_LOG = path.join(globalDir(), "server.log");

export function logServerStartup(): void {
  try {
    const dir = globalDir();
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const ws = resolveWorkspace();
    const entry = {
      ts: new Date().toISOString(),
      event: "server-startup",
      pid: process.pid,
      node: process.version,
      platform: process.platform,
      cwd: process.cwd(),
      memorybridge_path: process.env.MEMORYBRIDGE_PATH ?? null,
      workspace_resolution: ws,
      env_hints: {
        WORKSPACE_FOLDER: process.env.WORKSPACE_FOLDER ?? null,
        VSCODE_WORKSPACE_FOLDER: process.env.VSCODE_WORKSPACE_FOLDER ?? null,
        CURSOR_WORKSPACE: process.env.CURSOR_WORKSPACE ?? null,
        CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR ?? null,
        INIT_CWD: process.env.INIT_CWD ?? null,
      },
    };
    fs.appendFileSync(SERVER_LOG, JSON.stringify(entry) + "\n", "utf8");
  } catch {}
}

export function logServerEvent(event: string, data: any): void {
  try {
    fs.appendFileSync(SERVER_LOG, JSON.stringify({ ts: new Date().toISOString(), event, ...data }) + "\n", "utf8");
  } catch {}
}

export function runDiagnostics(): DiagnosticIssue[] {
  const issues: DiagnosticIssue[] = [];

  if (parseInt(process.version.slice(1).split(".")[0]) < 20) {
    issues.push({
      severity: "error",
      area: "node",
      message: `Node ${process.version} is below the supported version (>=20)`,
      fix: "Install Node.js 20 or newer from https://nodejs.org/",
    });
  }

  const gd = globalDir();
  if (!fs.existsSync(gd)) {
    issues.push({
      severity: "warn",
      area: "global-dir",
      message: `Global memory directory does not exist: ${gd}`,
      fix: "Run: memorybridge init",
    });
  } else {
    try {
      fs.accessSync(gd, fs.constants.W_OK);
    } catch {
      issues.push({
        severity: "error",
        area: "global-dir",
        message: `Global memory directory is not writable: ${gd}`,
        fix: "Check folder permissions, or set MEMORYBRIDGE_PATH to a writable location",
      });
    }
  }

  const ws = resolveWorkspace();
  if (ws.source === "cwd-fallback") {
    issues.push({
      severity: "warn",
      area: "workspace-detection",
      message: `Couldn't auto-detect a project root from CWD (${ws.cwdAtStartup}). The AI should pass project_path explicitly when calling memory_load / memory_save.`,
      fix: "Open the AI tool in a folder that has .git, package.json, or a similar marker; OR set the env var WORKSPACE_FOLDER to your project path before launching the AI tool.",
    });
  } else if (ws.source === "env" && ws.envHintFound) {
    issues.push({
      severity: "info",
      area: "workspace-detection",
      message: `Workspace detected via env var: ${ws.envHintFound}`,
    });
  }

  const tools = detectTools();
  const detectedCount = tools.filter((t) => t.detected).length;
  if (detectedCount === 0) {
    issues.push({
      severity: "error",
      area: "ai-tools",
      message: "No MCP-compatible AI tools detected on this machine",
      fix: "Install at least one of: Claude Code, Cursor, Antigravity, Windsurf, Gemini CLI, Continue.dev",
    });
  }

  try {
    const homeDir = os.homedir();
    const claudeJson = path.join(homeDir, ".claude.json");
    if (fs.existsSync(claudeJson)) {
      const cfg = JSON.parse(fs.readFileSync(claudeJson, "utf8"));
      if (!cfg.mcpServers?.memorybridge) {
        issues.push({
          severity: "warn",
          area: "mcp-config",
          message: `Claude Code config exists but memorybridge is not wired in: ${claudeJson}`,
          fix: "Run: memorybridge init",
        });
      } else {
        const serverPath = cfg.mcpServers.memorybridge.args?.[0];
        if (serverPath && !fs.existsSync(serverPath)) {
          issues.push({
            severity: "error",
            area: "mcp-config",
            message: `Claude Code is configured to spawn a server that doesn't exist: ${serverPath}`,
            fix: "Re-run: memorybridge init (will update the path)",
          });
        }
      }
    }

    const cursorJson = path.join(homeDir, ".cursor", "mcp.json");
    if (fs.existsSync(cursorJson)) {
      const cfg = JSON.parse(fs.readFileSync(cursorJson, "utf8"));
      if (!cfg.mcpServers?.memorybridge) {
        issues.push({
          severity: "warn",
          area: "mcp-config",
          message: `Cursor config exists but memorybridge is not wired in: ${cursorJson}`,
          fix: "Run: memorybridge init",
        });
      }
    }
  } catch (e: any) {
    issues.push({
      severity: "warn",
      area: "mcp-config",
      message: `Could not parse an MCP config: ${e.message}`,
    });
  }

  try {
    const loaded = loadMemory();
    if (loaded.tokens > TOKEN_BUDGET.HARD_CAP) {
      issues.push({
        severity: "warn",
        area: "token-budget",
        message: `Default memory_load is over hard cap: ${loaded.tokens} > ${TOKEN_BUDGET.HARD_CAP}`,
        fix: "Run: memorybridge compact",
      });
    }
  } catch (e: any) {
    issues.push({
      severity: "warn",
      area: "token-budget",
      message: `Could not test memory load: ${e.message}`,
    });
  }

  const projectPath = findProjectFile();
  if (projectPath) {
    try {
      fs.accessSync(projectPath, fs.constants.W_OK);
    } catch {
      issues.push({
        severity: "error",
        area: "project-file",
        message: `Project memory file is not writable: ${projectPath}`,
        fix: "Check file/folder permissions",
      });
    }
  }

  if (issues.length === 0) {
    issues.push({
      severity: "info",
      area: "health",
      message: "All checks passed. MemoryBridge looks healthy.",
    });
  }

  return issues;
}

export function formatDiagnostics(issues: DiagnosticIssue[]): string {
  const out: string[] = [];
  out.push("");
  out.push("=== MemoryBridge Diagnostics ===");
  out.push("");
  out.push(`Node:        ${process.version}`);
  out.push(`Platform:    ${process.platform}`);
  out.push(`CWD:         ${process.cwd()}`);
  out.push(`Global dir:  ${globalDir()}`);
  out.push("");

  const ws = resolveWorkspace();
  out.push("Workspace resolution:");
  for (const line of formatResolution(ws).split("\n")) out.push(`  ${line}`);
  out.push("");

  if (fs.existsSync(SERVER_LOG)) {
    try {
      const lines = fs.readFileSync(SERVER_LOG, "utf8").split("\n").filter(Boolean);
      const recent = lines.slice(-5);
      if (recent.length > 0) {
        out.push(`Recent MCP server log events (last ${recent.length}):`);
        for (const l of recent) {
          try {
            const j = JSON.parse(l);
            out.push(`  ${j.ts}  ${j.event}  pid=${j.pid}  cwd=${j.cwd || "n/a"}`);
          } catch {
            out.push(`  ${l.slice(0, 100)}`);
          }
        }
        out.push("");
      }
    } catch {}
  } else {
    out.push("No MCP server log yet. The MCP server hasn't started since this version was installed.");
    out.push("(It will appear at " + SERVER_LOG + " on next AI-tool restart.)");
    out.push("");
  }

  const errors = issues.filter((i) => i.severity === "error");
  const warns = issues.filter((i) => i.severity === "warn");
  const infos = issues.filter((i) => i.severity === "info");

  if (errors.length > 0) {
    out.push("[ERRORS — must fix]");
    for (const i of errors) {
      out.push(`  ✗ ${i.area}: ${i.message}`);
      if (i.fix) out.push(`     fix: ${i.fix}`);
    }
    out.push("");
  }

  if (warns.length > 0) {
    out.push("[WARNINGS]");
    for (const i of warns) {
      out.push(`  ! ${i.area}: ${i.message}`);
      if (i.fix) out.push(`     fix: ${i.fix}`);
    }
    out.push("");
  }

  if (infos.length > 0) {
    out.push("[INFO]");
    for (const i of infos) {
      out.push(`  • ${i.area}: ${i.message}`);
    }
    out.push("");
  }

  const sample = "[2026-05-28] Preference: TypeScript strict mode, no implicit any.";
  out.push(`Tokenizer check: ${countTokens(sample)} tokens for sample entry`);
  out.push("");

  return out.join("\n");
}
