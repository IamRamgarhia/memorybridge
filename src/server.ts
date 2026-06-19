#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { loadMemory, saveMemory, searchMemory } from "./memory.js";
import { Category } from "./format.js";
import { TOKEN_BUDGET } from "./budget.js";
import { logUsage } from "./stats.js";
import { logServerStartup, logServerEvent } from "./diagnostics.js";
import { resolveWorkspace } from "./workspace.js";
import path from "node:path";

function clientTool(): string {
  if (process.env.MCP_CLIENT_NAME) return process.env.MCP_CLIENT_NAME;
  if (process.env.CLAUDE_CODE_SESSION_ID) return "claude-code";
  if (process.env.CURSOR_WORKSPACE) return "cursor";
  return "mcp-client";
}

function projectLabel(projectPath?: string): string | undefined {
  try {
    const p = projectPath ?? process.cwd();
    return path.basename(p);
  } catch {
    return undefined;
  }
}

const server = new Server(
  { name: "memorybridge", version: "0.1.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: "memory_load",
      description: "Load this project's memory. Default returns the header (~400 tokens). Pass section for more (@decisions, @issues, etc.). Pass project_path (absolute path of the workspace root the user is working in) when CWD inheritance is unreliable.",
      inputSchema: {
        type: "object",
        properties: {
          section: { type: "string", description: "Optional: @decisions | @issues | @preferences | @resolved | @env | @map | @notes" },
          project_path: { type: "string", description: "Absolute path of the project root. Pass this when working in a workspace different from the MCP server's CWD." },
        },
      },
    },
    {
      name: "memory_save",
      description: "Save a durable preference, decision, recurring issue, or file-path map entry. Pass project_path (absolute path of the workspace root) so the entry lands in the correct project's .ai-memory.md instead of the MCP server's CWD.",
      inputSchema: {
        type: "object",
        required: ["content", "category"],
        properties: {
          content: { type: "string", description: "Short, durable fact. Avoid temporary state or secrets." },
          category: {
            type: "string",
            enum: ["preference", "decision", "issue", "resolved", "env", "note", "map"],
            description: "preference/decision/issue/resolved/env/note/map (map = file-path navigation cache, e.g. 'auth → /lib/supabase.ts:42')",
          },
          scope: { type: "string", enum: ["project", "global"], description: "Default: project. Use global for cross-project preferences." },
          project_path: { type: "string", description: "Absolute path of the project root. Required for accurate project-scoped saves when MCP CWD doesn't match the user's workspace." },
        },
      },
    },
    {
      name: "memory_search",
      description: "Search project + global memory for a keyword. Returns up to 10 matches.",
      inputSchema: {
        type: "object",
        required: ["query"],
        properties: {
          query: { type: "string" },
          project_path: { type: "string", description: "Absolute path of the project root for scoping the search to a specific project." },
        },
      },
    },
  ],
}));

function workspaceHintForUser(): string {
  const ws = resolveWorkspace();
  if (ws.source === "cwd-fallback") {
    return `\n\n[Note: MCP server's CWD (${ws.cwdAtStartup}) doesn't look like a project root. ` +
      `For accurate per-project memory, pass project_path explicitly with each call. ` +
      `Detected location: ${ws.memoryFilePath}.]`;
  }
  return "";
}

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;

  try {
    if (name === "memory_load") {
      const section = (args?.section as string | undefined)?.trim() || undefined;
      const projectPath = (args?.project_path as string | undefined)?.trim() || undefined;
      const ws = resolveWorkspace({ explicitProjectPath: projectPath });

      const res = loadMemory({
        section,
        projectPath: ws.projectRoot,
        budget: section ? TOKEN_BUDGET.HARD_CAP : TOKEN_BUDGET.DEFAULT_LOAD,
      });

      logUsage({ ts: new Date().toISOString(), tool: clientTool(), action: "load", tokens: res.tokens, project: projectLabel(ws.projectRoot) });
      logServerEvent("memory_load", { project: ws.projectRoot, source: ws.source, tokens: res.tokens, section });

      if (!res.text) {
        let msg = `(no memory found in project: ${ws.projectRoot})`;
        if (ws.source === "cwd-fallback") {
          msg += workspaceHintForUser();
        }
        return { content: [{ type: "text", text: msg }] };
      }

      let text = res.text;
      if (ws.source === "cwd-fallback" && !projectPath) {
        text += workspaceHintForUser();
      }
      return { content: [{ type: "text", text }] };
    }

    if (name === "memory_save") {
      const content = String(args?.content ?? "").trim();
      const category = String(args?.category ?? "note") as Category;
      const scope = (args?.scope as "project" | "global" | undefined) ?? "project";
      const projectPath = (args?.project_path as string | undefined)?.trim() || undefined;

      if (!content) {
        return { content: [{ type: "text", text: "error: content is required" }], isError: true };
      }

      const ws = resolveWorkspace({ explicitProjectPath: projectPath });

      const res = saveMemory(content, category, {
        scope,
        projectPath: ws.projectRoot,
      });

      if (!res.saved && res.reason === "blocked-sensitive-content") {
        return { content: [{ type: "text", text: "blocked: content looks sensitive (password/key/secret pattern). Not saved." }], isError: true };
      }
      if (!res.saved && res.reason === "duplicates-recently-loaded-memory") {
        return { content: [{ type: "text", text: "skipped: this content was already loaded into context this session. No need to re-save it." }] };
      }

      logUsage({ ts: new Date().toISOString(), tool: clientTool(), action: "save", tokens: 0, project: projectLabel(ws.projectRoot) });
      logServerEvent("memory_save", { project: ws.projectRoot, source: ws.source, category, scope, file: res.file });

      const verb = res.saved ? "saved" : "updated existing";
      let response = `${verb} → ${res.file}\n${res.entry}`;
      if (ws.source === "cwd-fallback" && !projectPath) {
        response += `\n\n[Note: saved using CWD fallback. Pass project_path next time for explicit placement.]`;
      }
      return { content: [{ type: "text", text: response }] };
    }

    if (name === "memory_search") {
      const query = String(args?.query ?? "").trim();
      const projectPath = (args?.project_path as string | undefined)?.trim() || undefined;
      if (!query) {
        return { content: [{ type: "text", text: "error: query is required" }], isError: true };
      }
      const ws = resolveWorkspace({ explicitProjectPath: projectPath });
      const res = searchMemory(query, { projectPath: ws.projectRoot, max: 10 });
      logUsage({ ts: new Date().toISOString(), tool: clientTool(), action: "search", tokens: res.tokens, project: projectLabel(ws.projectRoot) });
      logServerEvent("memory_search", { project: ws.projectRoot, source: ws.source, query, hits: res.results.length });

      if (res.results.length === 0) {
        return { content: [{ type: "text", text: `no matches for "${query}" in ${ws.projectRoot}` }] };
      }
      const text = res.results.map((r) => `[${r.source}] ${r.line}`).join("\n");
      return { content: [{ type: "text", text }] };
    }

    return { content: [{ type: "text", text: `unknown tool: ${name}` }], isError: true };
  } catch (err: any) {
    logServerEvent("error", { tool: name, message: err?.message ?? String(err) });
    return { content: [{ type: "text", text: `error: ${err?.message ?? String(err)}` }], isError: true };
  }
});

async function main() {
  logServerStartup();
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  process.stderr.write(`MemoryBridge server failed to start: ${err}\n`);
  logServerEvent("startup-failed", { error: err?.message ?? String(err) });
  process.exit(1);
});
