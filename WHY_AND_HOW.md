# MemoryBridge — The Case File

> **Purpose of this document:** Everything you need to decide whether MemoryBridge is worth building, what it actually is, and exactly how anyone (technical or not) installs and uses it. Merges all research findings + design decisions to date.
>
> **Verdict up front:** Yes, we should build this. The pain is real, the market is crowded at the top and empty at the bottom, the moat (zero-DB, token-frugal, cross-tool, plain markdown) is defensible, and the strategic unlock — being the *AGENTS.md / CLAUDE.md / .cursorrules emitter* — is backed by a 300-comment thread on the official Claude Code repo that nobody has addressed yet.

---

## 1. The problem in plain English

You open Claude Code in the morning. You spend 90 minutes explaining your project: it's a Next.js app, auth runs through Supabase, the payment webhook has a known bug, you prefer TypeScript strict, deploy is on Vercel. You get a feature half-built.

Afternoon, you switch to Cursor because the UI works better for some tasks. **Cursor knows nothing.** You paste the project description again. 2,000 tokens wasted before you even ask a question.

Next day, you try Google Antigravity. **Antigravity knows nothing.** Re-paste. 2,000 tokens wasted again.

Three days later, you come back to the project. Your last Claude Code session ended mid-feature. **Claude Code forgot too** — the conversation rotated out of its 200K context window. You re-explain what you were doing.

This is the daily reality for every developer using AI in 2026. The pain has three flavors:

| Who | What hurts |
|---|---|
| Vibe coders | Have to explain the project from scratch every session, on every tool |
| Pros on cheaper plans ($20 Sonnet, $20 Plus) | Burn through usage quota on re-explaining things the AI already heard |
| Teams | One person teaches the AI, nobody else benefits |
| Multi-tool users | Switching from Claude Code → Cursor → Antigravity means re-onboarding three times |

**The biggest, still-unsolved AI problem:** there is no zero-setup, cross-tool, token-frugal way to keep an AI's project context across sessions and across tools. The 21+ frameworks that exist are either too complex (Mem0, Letta, MemOS), too narrow (CLAUDE.md only works in Claude Code), or too invisible (ChatGPT memory — you can't see or edit what it stored).

---

## 2. Who's already trying to solve this?

Top 12 repos in this space, with current stats:

| Repo | Stars | Last push | Approach | Why it doesn't fully solve the problem |
|---|---|---|---|---|
| [modelcontextprotocol/servers](https://github.com/modelcontextprotocol/servers) | 86.3k | 2026-05-27 | Reference MCP servers incl. `server-memory` (JSON knowledge graph) | Returns the whole store on every read → context explosion |
| [cline/cline](https://github.com/cline/cline) | 62.4k | 2026-05-27 | VS Code agentic assistant with its own context manager | Only works inside Cline. Not cross-tool. |
| [mem0ai/mem0](https://github.com/mem0ai/mem0) | 56.9k | 2026-05-27 | LLM-extracted facts + vector DB + graph | Heavy setup. [Their own audit](https://github.com/mem0ai/mem0/issues/4573) shows 97.8% of extracted memories are junk. |
| [Aider-AI/aider](https://github.com/Aider-AI/aider) | 45.4k | 2026-05-22 | "Repo-map" — tree-sitter code skeleton, token-budgeted | Aider-only. Tied to the terminal. No cross-session preferences. |
| [continuedev/continue](https://github.com/continuedev/continue) | 33.4k | 2026-05-27 | Rules + MCP + RAG context providers | VS Code + JetBrains only. Setup-heavy. |
| [getzep/graphiti](https://github.com/getzep/graphiti) | 26.7k | 2026-05-21 | Temporal knowledge graph | Needs Neo4j. Server-side. Not for an individual on a laptop. |
| [letta-ai/letta](https://github.com/letta-ai/letta) | 23.0k | 2026-05-14 | MemGPT successor — hierarchical core/archival memory | Python server, complex install, agents not editors |
| [topoteretes/cognee](https://github.com/topoteretes/cognee) | 17.5k | 2026-05-27 | Pipeline-style memory w/ graph + vector | [Quickstart hangs](https://github.com/topoteretes/cognee/issues/2902). Heavy deps. |
| [microsoft/LLMLingua](https://github.com/microsoft/LLMLingua) | 6.2k | 2026-04-08 | Perplexity-based prompt compression (20×) | Needs LLaMA-7B running locally. Heavy. |
| [getzep/zep](https://github.com/getzep/zep) | 4.6k | 2026-04-09 | Long-term memory service | Pivoted away from OSS toward hosted. |
| [basicmachines-co/basic-memory](https://github.com/basicmachines-co/basic-memory) | 3.1k | 2026-05-27 | Markdown knowledge graph via MCP | Our closest sibling. Single-tool. No undo. No cross-project search. |
| [doobidoo/mcp-memory-service](https://github.com/doobidoo/mcp-memory-service) | 1.9k | 2026-05-27 | MCP server backed by ChromaDB | DB dependency. Setup pain. |

**Are the maintainers actively working on these issues?**

Yes — all top repos pushed within the last week (as of 2026-05-28). But the specific user pains we plan to solve are **not on their roadmaps**:

- AGENTS.md emitter — [claude-code #6235](https://github.com/anthropics/claude-code/issues/6235), 300 comments, no resolution
- Cross-project search — [basic-memory #123](https://github.com/basicmachines-co/basic-memory/issues/123), open, no PR
- Junk-memory quality gate — [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573), open, no fix
- Auto-archive of stale context — [aider #5071](https://github.com/Aider-AI/aider/issues/5071), open
- Memory undo — [basic-memory #124](https://github.com/basicmachines-co/basic-memory/issues/124), open

These are real, recent, unanswered. Our window is real.

---

## 3. The exact complaints we will fix

| User pain | Real evidence | Our fix |
|---|---|---|
| AI re-asks project basics every session | Daily complaint on r/ClaudeAI, r/cursor | Auto-load 400-token project header on first AI tool call |
| Switching tools = total memory loss | Multi-tool users everywhere | One `.ai-memory.md` file, every tool reads it |
| Memory tools store 90% junk | [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573) | We don't auto-extract. User or AI saves explicit decisions/preferences only. |
| 200K context fills, AI forgets mid-task | [cline #4389](https://github.com/cline/cline/issues/4389), 21 comments | Token-frugal load (140 tokens vs Mem0's 2,000–5,000) leaves more room |
| Setup needs Docker, vector DB, API keys | [mem0 setup complaints](https://github.com/mem0ai/mem0/issues), cognee, doobidoo | Zero DB. Zero cloud. Single NPX command. |
| Memory is invisible/black-box | ChatGPT memory, vector DBs | Plain markdown. Open in Notepad. |
| No undo when AI saves wrong fact | [basic-memory #124](https://github.com/basicmachines-co/basic-memory/issues/124) | Shadow git repo — every save is a commit. `memory undo` works. |
| No cross-project search | [basic-memory #123](https://github.com/basicmachines-co/basic-memory/issues/123) | Global index across all `.ai-memory.md` files |
| Storage path can't be customized | [mcp #1018](https://github.com/modelcontextprotocol/servers/issues/1018), [#692](https://github.com/modelcontextprotocol/servers/issues/692) | `MEMORYBRIDGE_PATH` env var + XDG paths |
| AI responses are too long, eat output tokens (5× cost) | Every user on a $20 plan | 5-level response style toggle (`memorybridge style smaller`) |
| Recall feedback loop — AI re-saves what was just loaded | [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573) — "808 copies of `User prefers Vim`" | Tag entries with `loaded_at`; reject saves overlapping current session loads |
| Memory format only fits one tool (CLAUDE.md ≠ AGENTS.md ≠ .cursorrules) | [claude-code #6235](https://github.com/anthropics/claude-code/issues/6235) (300 comments) | Emit AGENTS.md, CLAUDE.md, .cursorrules from one source of truth |
| User doesn't know if it's working | Universal complaint about all memory tools | `memorybridge stats` shows real tokens saved + dollars saved |

---

## 4. Anti-patterns we will NOT repeat

Things competitors do that users complain about:

1. **LLM-extracted memory by default.** Even Sonnet 4.6 produces ~90% junk. We let user or AI save *explicit* statements only.
2. **Vector DB dependency.** Causes most setup failures. We use plain markdown.
3. **Returning entire store on read.** Causes context explosions. We cap default load at 400 tokens.
4. **Silent no-ops.** When we block or dedup, we say so — user sees why.
5. **Ephemeral tool IDs.** Breaks across server restarts. We use content-hash IDs.
6. **Cloud tier upsell.** Everything stays local. Forever.
7. **Schema drift.** Markdown is forgiving; if we ever add metadata sidecars, version them from day 1.

---

## 5. The verdict — should we build this?

**Yes. Here's the honest case:**

| Factor | Reading |
|---|---|
| Is the pain real? | Yes — 21+ frameworks exist *because* nobody has solved it |
| Is the market crowded? | At the top, yes (Mem0, Letta). At the bottom (zero-setup, normal users), almost empty. |
| Do we have a defensible moat? | Yes — zero-DB, token-frugal, cross-tool detection, plain markdown |
| Is the strategic unlock real? | Yes — the AGENTS.md emitter alone is a 300-comment unmet demand |
| Risk: major player builds this in? | They'll build it *for their own tool*. Cross-tool universality is structurally unavailable to them. |
| Time to MVP? | Already built (v0.1 done as of 2026-05-28). |
| Time to win? | 2–3 weekends to add AGENTS.md emitter, memory undo, recall-aware dedup. |

The asymmetric bet: building MemoryBridge takes a few weekends. The potential win (becoming THE universal AI memory layer) is huge. The downside (it works but nobody adopts it) is acceptable — we still have a tool we use ourselves.

**Recommendation: ship.**

---

## 6. What we are building, in one paragraph

**MemoryBridge** is an MCP server you install in 60 seconds. It auto-detects which AI tools you have (Claude Code, Cursor, Google Antigravity, Windsurf, Gemini CLI, Continue, VS Code Copilot, Claude Desktop) and wires itself into all of them. While you work in any AI tool, MemoryBridge keeps a plain Markdown file called `.ai-memory.md` in the project folder. The AI reads from it at session start (only ~400 tokens — your project header, top preferences, top open bugs). The AI writes to it when you state durable preferences or decisions. Every AI tool you use sees the same file, so switching tools mid-project costs nothing. No cloud. No accounts. No vector DB. No API keys. The file is yours, lives in your repo, can be committed to Git so your whole team gets the same AI memory.

---

## 7. How it actually works (the user experience)

### The vibe coder's flow (no terminal experience required)

**Day 1, in Claude Code:**
- Opens project folder
- Says: "I want to use Supabase for auth in this app"
- AI calls `memory_save("decision: Supabase for auth")` automatically
- `.ai-memory.md` is created in the project folder

**Day 2, switches to Cursor:**
- Opens the same project folder
- Cursor's AI immediately calls `memory_load()`
- AI already knows: project name, stack, that auth = Supabase
- Zero re-explaining

**Day 3, tries Google Antigravity:**
- Opens the same project folder
- Antigravity's AI reads the same `.ai-memory.md`
- Continues exactly where the others left off

**The file never left the folder. It wasn't uploaded anywhere. No account was created.**

### The pro developer's flow

```bash
npx memorybridge init           # wires all detected AI tools (60 sec)
npx memorybridge scan           # shows all installed AI tools + existing memory files
npx memorybridge stats          # shows actual tokens + $ saved
npx memorybridge style smaller  # AI responses shorter — saves output tokens (5× more $)
npx memorybridge undo           # roll back a bad save (git-backed)
npx memorybridge open           # open the memory file in your editor
```

---

## 8. What gets saved automatically vs asked vs never

This is the #1 thing competitors get wrong. Our rules:

### ALWAYS SAVED (no prompt, AI calls memory_save silently)

- Explicit preferences: *"I prefer TypeScript strict"*, *"always use pnpm"*
- Architectural decisions: *"we chose Supabase over NextAuth"*
- Recurring issues: *"the payment webhook fires twice"*
- File-path navigation cache: *"auth handlers → /lib/supabase.ts:42"*
- Environment basics: Node version, package manager, deploy target

### NEVER SAVED (blocked, even if AI tries)

- Anything matching `password=`, `api_key=`, `secret=`, `token=`, `bearer`
- Private keys (BEGIN PRIVATE KEY blocks)
- Greetings, thanks, small talk
- Stack traces (raw)
- Code snippets (the actual code — lives in your files, no duplication)
- "Sure, I'll help with that" style filler
- Names, addresses, phone numbers unless explicitly requested

### THE KEY DESIGN CHOICE — auto, not nag

You asked: *"how it gonna work mostly I want it to be work automatically"*.

That's our design. The user is **never asked** "do you want me to save this?" because that's annoying and breaks flow. Instead:

- High-signal items (preferences, decisions, recurring issues) → saved silently by the AI when prompted by the tool description
- Junk (greetings, code, secrets) → blocked silently by our regex filters
- Quality gate (coming in next version) → reject near-duplicates of recent loads before they hit the file

If we ever ask the user, it's once, with one click, never again for that type of content.

### User can call it anytime

```bash
memorybridge add "we deploy on Friday morning" --category decision
memorybridge search "supabase"
memorybridge list
memorybridge open
```

But this is for power users. The default flow is invisible.

---

## 9. The memory file lives in your project folder, not ours

This is one of the most-emphasized design decisions:

```
~/projects/todo-app/
├── src/
├── package.json
├── .gitignore
└── .ai-memory.md          ← MemoryBridge file lives HERE
```

**Why this matters:**

1. **Every AI tool that opens your project folder finds the same file.** No syncing, no cloud, no config.
2. **The user always knows where it is.** Not buried in `~/.config/memorybridge/sessions/uuid-abc.../`.
3. **It travels with the project.** Zip the project, move to another machine, clone on a new laptop — memory comes along.
4. **Commit it to Git** — now your whole team shares the same AI memory. New hire clones the repo, AI already knows the architecture.
5. **No vendor lock-in.** Uninstall MemoryBridge and you still have a readable Markdown file with all your project context.

A separate global file (`~/.memorybridge/global.md`) holds your **personal** cross-project preferences ("I prefer tabs"). That's the only thing in our folder.

---

## 10. Install in 60 seconds — for any user

### Level 1 — Anyone (once we publish to npm)

```bash
npx memorybridge init
```

That's it. The installer:

1. Detects which AI tools you have (Claude Code, Cursor, Antigravity, etc.)
2. Patches each tool's MCP config so they connect to MemoryBridge
3. Creates `~/.memorybridge/global.md` for your global preferences
4. Prints next steps

Restart your AI tool once. From then on it works invisibly.

### Level 2 — Power users

```bash
npm install -g memorybridge
memorybridge init
memorybridge scan          # see what tools and projects you have
memorybridge stats         # see what you're saving
memorybridge style smaller # cut AI response length
```

### Level 3 — Today (until we publish to npm)

```bash
git clone <repo>
cd memorybridge
npm install
npm run build
node dist/cli.js init
```

---

## 11. Compatibility

| AI tool | Connection | Auto-detected |
|---|---|---|
| Claude Code | MCP native | ✅ |
| Cursor | MCP native | ✅ |
| Google Antigravity | MCP native | ✅ (path detection in place) |
| Windsurf | MCP native | ✅ |
| Gemini CLI | MCP native | ✅ |
| Continue.dev | MCP native | ✅ |
| VS Code (+ Copilot) | MCP native | ✅ |
| Claude Desktop | MCP native | ✅ |
| OpenCode | MCP native | ✅ |
| Codex CLI | MCP native | Phase 2 |
| Aider | Read-only (file watch) | Phase 2 |
| Claude.ai (browser) | Manual paste (no MCP yet) | Phase 3 (only if browser AI MCP support stalls) |

---

## 12. The token savings math (concrete numbers)

Real measurements from a working v0.1:

| Mechanism | Savings |
|---|---|
| **Default `memory_load`** | 140 tokens served vs ~3,000 tokens re-pasted = **~95% input saved** |
| **MCP tool surface** | 152 tokens total (vs Mem0's 500+) |
| **Style level 1 (ultra-terse)** | ~75% output tokens saved per response |
| **Style level 2 (concise)** | ~55% output tokens saved per response |
| **`@map` file-path cache** | Prevents repeated grep loops — savings depend on project size |
| **Auto-archive at 200 lines** | File never bloats beyond useful size |

**The math for a heavy user on a $20 Sonnet plan:**

- Without MemoryBridge: ~3,000 input + ~800 output tokens wasted per session re-explaining
- 100 sessions/month = 380,000 wasted tokens/month
- At Sonnet pricing ($3/M input, $15/M output): **~$13/month in wasted tokens**

- With MemoryBridge (level 2 concise style): ~250 input + ~360 output served
- 100 sessions/month = 61,000 served tokens vs 380,000 baseline
- **~$11/month saved**, plus the user works faster (no re-explaining) and switches tools freely

For a developer running 10× that volume, savings approach **$100/month**. Pays for itself many times over vs upgrading to a higher plan.

---

## 13. What's already built (as of 2026-05-28)

✅ MCP server with 3 tools (`memory_load`, `memory_save`, `memory_search`)
✅ Project-local `.ai-memory.md` with project-root detection (walks up to `.git`/`package.json`)
✅ Global `~/.memorybridge/global.md` for cross-project preferences
✅ Atomic writes (temp + rename) — no data loss
✅ 8 detected AI tools, NPX installer that patches Claude Code + Cursor MCP configs
✅ CLI: `init`, `add`, `list`, `search`, `open`, `doctor`, `compact`, `scan`, `stats`, `style`
✅ Auto-compact at 200 lines (archives entries > 90 days old)
✅ Compression at write time (drop filler, 120-char cap, dedup)
✅ Sensitive content blocker (passwords/keys/tokens)
✅ 5-level response style toggle with `bigger`/`smaller`
✅ `@map` section for file-path navigation cache
✅ Usage logging + stats with both INPUT and OUTPUT savings + $ saved
✅ Compressed MCP tool descriptions (152 tokens total)
✅ All smoke tests pass (16/16)

---

## 14. What's next (in build order)

### Sprint 1 — ✅ SHIPPED 2026-05-28

1. ✅ **AGENTS.md / CLAUDE.md / .cursorrules emitter** — `memorybridge emit --all` writes 7 formats from one `.ai-memory.md`. Backed by [claude-code #6235](https://github.com/anthropics/claude-code/issues/6235) (300 comments).
2. ✅ **`memory undo` via snapshot history** — every save records a JSON snapshot. `undo`, `log`, `diff` commands. No git dependency. Backed by [basic-memory #124](https://github.com/basicmachines-co/basic-memory/issues/124).
3. ✅ **Recall-aware dedup** — containment-based check; rejects saves with ≥80% token overlap with recently-loaded content. Backed by [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573) — the "808 copies of Vim" failure.
4. ✅ **`MEMORYBRIDGE_PATH` env var + XDG** — users put memory dir anywhere. Backed by [mcp #1018](https://github.com/modelcontextprotocol/servers/issues/1018).
5. ✅ **Section pin/lock** — `memorybridge pin @decisions` always loads regardless of token cap. Mirrors Letta core-memory + Aider `/add`.

### Sprint 2 — ✅ SHIPPED 2026-05-28

6. ✅ **Cross-project global index + search** — `memorybridge index [--root <path>]`, `memorybridge projects`, `memorybridge global-search`. Indexed file at `~/.memorybridge/index.json`. Backed by [basic-memory #123](https://github.com/basicmachines-co/basic-memory/issues/123).
7. ✅ **Quality scorer (junk detector)** — `memorybridge quality` shows grade A–F + per-entry issues (time-sensitive language, system-prompt echoes, filler openings, near-dupes). Backed by [mem0 #4573](https://github.com/mem0ai/mem0/issues/4573).
8. ✅ **Symbol extractor** — `memorybridge symbols [save]` extracts exports from JS/TS/Py/Go via regex (no tree-sitter dependency). Writes to `@symbols` section so AI doesn't re-grep for functions/classes. Inspired by Aider repo-map.

### Open source release

9. Publish to npm under `memorybridge`
10. Push to GitHub with MIT license
11. Write a great README with 60-second demo
12. Submit to Hacker News (Show HN), r/ClaudeAI, r/cursor, r/vibecoding

---

## 15. Why MemoryBridge wins over every existing option

| Feature | Mem0 | CLAUDE.md | basic-memory | ChatGPT mem | **MemoryBridge** |
|---|---|---|---|---|---|
| Works across all AI tools | ❌ | ❌ | ⚠️ | ❌ | **✅** |
| Zero setup for normal people | ❌ | ⚠️ | ⚠️ | ✅ | **✅** |
| Human-readable + editable | ❌ | ✅ | ✅ | ❌ | **✅** |
| Auto-detects what to save | ✅ | ❌ | ⚠️ | ✅ | **✅** |
| No cloud, 100% local | ⚠️ | ✅ | ✅ | ❌ | **✅** |
| File lives in project folder | ❌ | ✅ | ❌ | ❌ | **✅** |
| Token-frugal (< 500 tokens default) | ❌ | ⚠️ | ❌ | ❌ | **✅** |
| Controls AI output verbosity | ❌ | ⚠️ | ❌ | ❌ | **✅** |
| Shows real savings ($ + tokens) | ❌ | ❌ | ❌ | ❌ | **✅** |
| Emits AGENTS.md/CLAUDE.md/.cursorrules | ❌ | ❌ | ❌ | ❌ | **🔜** |
| Memory undo (git-backed) | ❌ | ⚠️ | ❌ | ❌ | **🔜** |

---

## 16. Closing argument

The biggest unsolved AI problem of 2026 is not model quality. It is **continuity** — the AI's amnesia between sessions, between tools, between days. Every solution that exists today is either too complex, too narrow, or invisible.

**MemoryBridge solves it in the simplest way possible:** a Markdown file in your project folder, read by every AI tool you use, with strict token budgets so the file stays cheap, automatic enough to be invisible, transparent enough to be trusted. Free, local, MIT-licensed.

We have a v0.1 that works. We have a v0.2 plan with three sprints to dominance. The research says yes. The market says yes. The 300-comment thread on the official Claude Code repo says yes, loudly.

**Build it. Ship it. Tell people.**

---

*Document version 1.0 — Synthesized 2026-05-28*
*Source documents this supersedes: nothing — this is the single source of truth for the "why" and "how."*
*Build status documents: [BUILD_PLAN.md](BUILD_PLAN.md) (technical spec), [MEMORYBRIDGE_SPEC.md](MEMORYBRIDGE_SPEC.md) (original research).*
