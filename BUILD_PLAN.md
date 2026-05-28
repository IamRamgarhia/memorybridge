# MemoryBridge — Build Plan v0.2

> **Status:** Ready to build
> **Supersedes design decisions in:** [MEMORYBRIDGE_SPEC.md](MEMORYBRIDGE_SPEC.md) (keep as research reference)
> **Last updated:** 2026-05-28

This document is the **source of truth** for what we are actually building. The original spec stays as research context, but every conflict is resolved in favor of this file.

---

## 1. The Core Principle: Token Frugality

Every memory we load costs tokens on **every session, on every tool, forever.** A memory system that bloats context is worse than no memory system.

**The hard rule:** Default memory load = **≤ 400 tokens**. Anything more must be earned by the AI explicitly asking for it.

This is the #1 design constraint. It comes before features, before polish, before anything else.

---

## 2. Tagline

**MemoryBridge — Cross-tool AI memory that costs 400 tokens, not 4,000.**

---

## 3. Differentiation (Post-Research)

OpenMemory MCP and Basic Memory MCP already exist. We are NOT "the first cross-tool memory." Our real edge:

1. **Smallest token footprint** — 400 tokens default vs competitors' 2,000+
2. **Project-local file** — travels with the repo, Git-versionable, no global DB
3. **Zero-config NPX install** — one command, no Docker, no vector DB, no API keys
4. **Plain Markdown** — readable, editable, greppable
5. **No LLM-side dependencies** — works with any model, even tiny ones

Token efficiency is the headline.

---

## 4. Token-Saving Mechanisms (The 7 Rules)

### 4.1 Tiered Loading (Header-First)
Session start injects only the `@header` block: project name, stack, top 3 open issues, top 3 preferences. ~200–400 tokens. AI requests more sections only if relevant.

```
memory_load()              → 400 tokens (header only)
memory_load("decisions")   → pulls decisions section on demand
memory_load("issues")      → pulls issues section on demand
```

### 4.2 Compression at Write Time
Every save runs through a compressor:
- Drop filler ("the user said they want to…")
- One line per fact
- Format: `[date] category: 1-sentence claim`
- Hard cap: 120 chars per entry

### 4.3 Auto-Archive Stale Entries
Entries unused for 90 days move to `.ai-memory.archive.md` — present on disk, **not loaded** into context. Restore via `memorybridge restore`.

### 4.4 Deduplication on Save
Before appending, check for near-duplicates. Update the date instead of adding a new line.

### 4.5 Skip Empty Loads
If no `.ai-memory.md` exists, `memory_load` returns empty string. No tool-call overhead.

### 4.6 Section-Indexed File Format
The file has named sections (`@header`, `@decisions`, `@issues`, etc.). Loading "issues" doesn't require parsing decisions.

### 4.7 Minimal MCP Tool Descriptions
Tool schemas themselves cost tokens (loaded on every session). Each MemoryBridge tool description ≤ 1 sentence. Total MCP overhead < 150 tokens.

**Estimated total token cost per session: 400–600 tokens** (vs Mem0's typical 2,000–5,000).

---

## 5. v0.1 MVP — Scope (Brutal Cut)

### IN
- MCP server with 3 tools (Claude Code + Cursor only)
- Project-local `.ai-memory.md` + global `~/.memorybridge/global.md`
- **Project-root detection** — walks up from cwd looking for `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, `go.mod`, `pom.xml`, `build.gradle`, `composer.json`, `.hg`, `.svn`. Memory file always lands at project root, even when invoked from a deep subdirectory.
- **Atomic writes** — temp file + rename. Delivers the no-data-loss goal of "append-only" without the format complexity. Race-free on POSIX, near-atomic on Windows.
- Explicit `/remember`-style flow via system prompt footer (AI calls save)
- CLI: `init`, `add`, `list`, `search`, `open`, `doctor`, `compact`, `scan`, **`stats`**
- Token budget enforcement (hard cap)
- **`scan` command** — detects installed AI tools (Claude Code, Cursor, Antigravity, Windsurf, Gemini CLI, Continue, VS Code Copilot, Claude Desktop), discovers projects they've worked on, and surfaces existing memory files (CLAUDE.md, AGENTS.md, .cursorrules, .ai-memory.md, GEMINI.md) in a clean human-readable table.
- **`stats` command** — every `memory_load` / `memory_save` / `memory_search` call is logged to `~/.memorybridge/usage.jsonl`. Stats shows total calls, tokens served, estimated INPUT savings (vs 3,000-token re-paste baseline) AND estimated OUTPUT savings (based on active style level), plus combined dollar savings at Haiku and Sonnet pricing (input + output). **This is how users SEE that MemoryBridge is working.**
- **Auto-compaction at 200 lines** — saveFile triggers archive-pass when file grows past 200 lines. Stale entries (> 90 days old) move to `.ai-memory.archive.md`.
- **Doctor compaction guidance** — `memorybridge doctor` shows current line count and warns at 150+ lines.
- **5-level response style toggle** — `memorybridge style 1..5` (or `bigger` / `smaller` to step). Levels: 1 ultra-terse (≤15 words, ~75% output savings), 2 concise (≤60 words, ~55%), 3 balanced (≤150 words, ~25%), 4 detailed (≤300 words, ~10%), 5 verbose (no limit, no savings). Style profile injects directives into every `memory_load` output. **Output tokens cost 5× more than input, so this is the biggest lever for total $ saved.**
- **Custom style directives** — `memorybridge style add "<directive>"` lets users append project-specific rules (e.g. "always use TypeScript", "no markdown headers in answers").
- **`@map` section** — file-path navigation cache. AI saves "auth handlers → /lib/supabase.ts:42" via `memory_save category=map`. Up to 5 most recent map entries appear in the header on every `memory_load`. Stops the AI from re-grepping files it already located.
- **Compressed instruction footer** — single line, ~12 tokens (was ~30) saved per `memory_load`. Adds up over thousands of sessions.
- **`MEMORYBRIDGE_PATH` env var + XDG support** — users put memory dir anywhere. Falls back to `~/.memorybridge` or `$XDG_DATA_HOME/memorybridge` if env var unset.
- **Memory undo / log / diff via snapshot history** — every save records a JSON snapshot to `~/.memorybridge/history/<project-hash>.jsonl`. Commands: `memorybridge undo` (restore previous), `memorybridge log` (timeline of saves), `memorybridge diff N` (diff vs N snapshots ago). No git dependency.
- **AGENTS.md / CLAUDE.md / .cursorrules emitter** — `memorybridge emit --all` writes 7 formats from one `.ai-memory.md`: AGENTS.md (cross-tool standard), CLAUDE.md (Claude Code), .cursorrules (Cursor), .windsurfrules (Windsurf), GEMINI.md (Gemini CLI), .continuerules (Continue), .github/copilot-instructions.md (VS Code Copilot). Files include a banner so we never overwrite hand-written ones. Backed by [claude-code #6235](https://github.com/anthropics/claude-code/issues/6235) (300 comments).
- **Recall-aware dedup (containment-based)** — every `memory_load` notes loaded tokens in an in-process cache (10-minute TTL). When AI calls `memory_save`, if ≥80% of the save's tokens are contained in a recently-loaded entry, the save is rejected with `"skipped: this content was already loaded into context this session"`. Prevents the "808 copies of Vim" failure ([mem0 #4573](https://github.com/mem0ai/mem0/issues/4573)).
- **Section pin/lock** — `memorybridge pin @decisions` marks a section as always-loaded. Pinned sections appear in `memory_load()` regardless of token cap. Commands: `pin`, `unpin`, `pins`. Mirrors Letta core-memory + Aider `/add`.
- **Cross-project global index** — `memorybridge index` scans the filesystem (common project roots + `--root <path>` + cwd) and builds `~/.memorybridge/index.json`. `memorybridge projects` lists every indexed project. Backed by [basic-memory #123](https://github.com/basicmachines-co/basic-memory/issues/123).
- **Global search across projects** — `memorybridge global-search "supabase"` searches every indexed project's `.ai-memory.md`. Returns hits grouped by project. Lets users find context that may have been written in another project months ago.
- **Quality scorer (junk detector)** — `memorybridge quality` scans the project memory for entries with: time-sensitive language ("today", "tomorrow"), system-prompt echoes ("You are an assistant"), filler-style openings ("Sure I will help"), over-long content, and near-duplicates within a section. Returns a grade A–F and concrete issues. Backed by [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573) — the 97.8%-junk problem.
- **Symbol extractor** — `memorybridge symbols [save]` scans up to 200 source files (JS/TS/Py/Go) and extracts top-level exports via regex (no tree-sitter dep). `save` writes them to the `@symbols` section so AI can find functions/classes without re-grepping. Inspired by [Aider's repo-map](https://github.com/Aider-AI/aider).

### OUT (deferred or cut entirely)
- GUI installer
- Browser extension
- Auto-classifier (AI decides what to save, prompted by tool description)
- Staleness automation (manual `compact` for v0.1)
- Session-end auto-summary (unreliable triggers)
- Team sync features
- Vector embeddings
- LLM-based classification
- VS Code, Gemini CLI, OpenCode integrations (Phase 2)

**Why the cut:** Ships in 2–3 weekends. Get 50 real users. Then expand based on feedback.

---

## 6. Architecture

```
memorybridge/
├── src/
│   ├── server.ts          MCP server (3 tools)
│   ├── memory.ts          Read/write/compress, project-root detection, atomic writes, recall-aware dedup
│   ├── format.ts          Section parser, compressor, dedup, @map, pin/unpin
│   ├── budget.ts          Token counting + truncation
│   ├── install.ts         Detects tools, patches configs
│   ├── scan.ts            Discovers installed AI tools + their projects
│   ├── stats.ts           Usage logging + savings calculator (input + output)
│   ├── style.ts           5-level response style profiles + custom directives
│   ├── paths.ts           Central path lookup (MEMORYBRIDGE_PATH + XDG)
│   ├── history.ts         Snapshot history, undo, log, diff
│   ├── emit.ts            AGENTS.md / CLAUDE.md / .cursorrules / .windsurfrules / GEMINI.md / .continuerules / copilot emitter
│   ├── projects.ts        Cross-project global index + global search
│   ├── quality.ts         Junk-score heuristic (time-sensitive, prompt-echo, filler, dupes)
│   ├── symbols.ts         Regex-based symbol extractor for JS/TS/Py/Go
│   ├── cli.ts             20+ commands incl. emit/pin/undo/log/diff/index/projects/global-search/quality/symbols
│   └── index.ts           Entry point
├── package.json
├── tsconfig.json
└── README.md
```

**Stack:**
- **Language:** TypeScript
- **Runtime:** Node 20+
- **Deps:** `@modelcontextprotocol/sdk`, `gpt-tokenizer` (for cl100k_base counting)
- **Zero extra runtime deps** beyond those two

---

## 7. The 3 MCP Tools (Minimal Surface)

```
memory_load(section?)
  Returns header (default) or named section.
  Default cap: 400 tokens. Hard cap: 1500.

memory_save(content, category)
  Compresses, dedupes, appends to .ai-memory.md.
  Category: preference | decision | issue | resolved | env

memory_search(query)
  Returns matching lines (max 10). Used for specific recall.
```

**Cut from original spec:**
- `session_summary` — no reliable trigger
- `flag_stale` — replaced by archive on `compact`
- `memory_update` — `memory_save` + dedup handles it

---

## 8. System Prompt Injection (How AI Knows to Save)

`memory_load` returns the header **plus a 2-line instruction footer**:

```
---
[Memory: call memory_save when user states a preference, decision,
or recurring issue worth remembering across sessions.]
```

Total overhead: ~20 tokens. This replaces the architecturally-impossible "silent classifier from the original spec" — the AI does the classification, prompted by the tool description and footer.

---

## 9. File Format

```markdown
# .ai-memory.md | MemoryBridge | v1
# Updated: 2026-05-28

## @header
project: todo-app
stack: Next.js 14, Supabase, PostgreSQL
top-issues:
  - Payment webhook fires twice
  - Mobile nav doesn't close on route change
top-prefs:
  - TypeScript strict mode always
  - Tailwind utility-first, no CSS modules

## @decisions
- [2026-05-20] Auth → Supabase (simpler than NextAuth)
- [2026-05-21] DB → PostgreSQL (need relational joins)

## @issues
- [2026-05-27] Payment webhook fires twice — /api/webhook.ts race condition

## @resolved
- [2026-05-25] Vercel build → missing NEXT_PUBLIC_ env prefix

## @env
node: 20.x | pkg: pnpm | dev: localhost:3000
```

`memory_load()` returns just `@header` block. Cheap, predictable, capped.

---

## 10. Concurrency: Append-Only Log

Forget file locking. Each tool **appends** a single line to `.ai-memory.md` with a unique entry ID. Reads parse the whole file. Compaction (dedup + reorganize sections + archive stale) runs:
- On `memorybridge doctor`
- Automatically when file > 200 lines
- Manually via `memorybridge compact`

No locks. No corruption. No data loss on simultaneous writes.

---

## 11. Install (NPX Only for v0.1)

```bash
npx memorybridge init
```

Does:
1. Installs MCP server to `~/.memorybridge/`
2. Detects Claude Code → uses `claude mcp add` or merges `.mcp.json`
3. Detects Cursor → writes/merges `.cursor/mcp.json`
4. Creates `~/.memorybridge/global.md`
5. Prints next-step instructions

**Important:** Verify each tool's current MCP config path before writing the installer. Spec had several wrong paths.

```bash
npx memorybridge doctor    # Verifies MCP wiring, file perms, token budget
npx memorybridge add "Use pnpm not npm"
npx memorybridge list
npx memorybridge search "database"
npx memorybridge open
npx memorybridge compact   # Dedup + archive stale
```

**No GUI. No browser extension. No global npm install required.**

---

## 12. Critical Issues from Original Spec — Resolved

| Original Spec Said | Reality | Our Fix |
|---|---|---|
| MCP server "silently watches" every message and classifies | MCP cannot observe messages — only responds to AI tool calls | AI does classification, prompted by tool description + footer |
| Auto session-start / session-end hooks across all tools | Only Claude Code has SessionStart; others don't | Trigger memory_load on first tool call; no end hook needed |
| Claude Code uses `~/.claude/claude_desktop_config.json` | That's Claude Desktop. Claude Code uses `.mcp.json` or `claude mcp add` | Installer uses `claude mcp add` CLI |
| VS Code Copilot via `github.copilot.advanced.mcpServers` | Wrong. VS Code 1.99+ uses `.vscode/mcp.json` | Defer VS Code to Phase 2; use correct path then |
| "Lightweight ML classifier" runs server-side | Misleading — would have been regex/heuristics | Honest: classification is AI-side, server is dumb storage |
| File locking for simultaneous writes | Hard on Windows | Append-only log, periodic compaction |
| Browser extension for Claude.ai / ChatGPT in Phase 1 | Hostile DOM, ToS risk, Claude.ai now supports MCP natively | Cut. Maybe Phase 3 if ever |
| "1–2 weekends" build estimate | Wildly optimistic for original scope | 2–3 weekends for the cut-down MVP |

---

## 13. Build Phases (Realistic)

### Phase 1 — Working MVP (2–3 weekends)
- [ ] MCP server with 3 tools
- [ ] File format + compressor + section parser + dedup
- [ ] Token budget enforcement (hard cap)
- [ ] `npx init` for Claude Code + Cursor
- [ ] CLI commands (`init`, `add`, `list`, `search`, `open`, `doctor`, `compact`)
- [ ] README + 60-second demo video
- [ ] Ship to GitHub + Hacker News + r/ClaudeAI

### Phase 2 — Validated Expansion (only after 50+ real users)
- [ ] Add VS Code, Gemini CLI, OpenCode based on user demand
- [ ] Auto-archive of stale entries
- [ ] Automatic compaction
- [ ] Project profiles / multi-project headers

### Phase 3 — Polish (only if traction)
- [ ] GUI tray app (Electron) — only if non-technical users actually ask
- [ ] Browser extension — only if MCP-native browser AI still lags
- [ ] Optional team sync via Git hooks

---

## 14. Open Questions Before Coding

1. **Repo name** — `memorybridge` on npm + GitHub. Need to verify availability.
2. **License** — MIT (per original spec). Confirm.
3. **Tokenizer** — `gpt-tokenizer` for cl100k_base. Good approximation for Claude, but not perfect. Acceptable for budgeting.

---

## 15. Success Criteria for v0.1

- One-command install works on Mac, Linux, Windows
- Default session memory load: < 500 tokens (measured, not estimated)
- `.ai-memory.md` is human-readable without any tools
- Survives a `git commit` and clone — memory travels with project
- Two AI tools can write to the same file in the same minute without data loss
- A non-technical user can open the file in Notepad and understand it

---

*Build Plan v0.2 — Token-first redesign — 2026-05-28*
*When in doubt, choose the option that uses fewer tokens.*
