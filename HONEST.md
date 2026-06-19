# Is MemoryBridge actually helping me?

> The honest answer, with the math, based on your real usage pattern.
> No marketing. No hand-waving. If it isn't helping you, this document tells you.

---

## What MemoryBridge does well (and doesn't)

### ✅ It actually works (measured, not promised)

These are real, observable on every install:

1. **The MCP server runs.** Every AI tool that supports MCP (Claude Code, Cursor, Antigravity, Windsurf, Gemini CLI, Continue, VS Code Copilot, Claude Desktop) calls into it. You can verify yourself: in Claude Code ask *"list your MCP tools"* — `memory_load`, `memory_save`, `memory_search` will be there.
2. **The memory file is real.** It's plain Markdown in your project folder. Open it in Notepad. Edit it. It survives `git clone`. There's no cloud, no API key, no database.
3. **Cross-tool memory is real.** The same `.ai-memory.md` is read by every tool that opens that folder. Tested.
4. **Token counts are real.** Every `memory_load` is measured by `gpt-tokenizer` on the actual returned text. The number is in `~/.memorybridge/usage.jsonl` — go look.
5. **The 8-step install works on Windows, macOS, and Linux.** CI proves it on every push.

### ⚠️ It works only when the AI calls the tools

MCP doesn't let us *force* the AI to load memory. We can only put a tool in front of it and a hint in the description. If the AI forgets to call `memory_load`, MemoryBridge contributes nothing to that session.

In practice the AI does call it — but not 100% of the time. Expect ~70–90% session coverage, not 100%.

### ❌ It does NOT track your real Claude usage

We track **tools we serve**. We do NOT track **what Claude Code actually billed you for**. If you want hard before/after on your monthly Claude bill, the only way is to use MemoryBridge for a month, then disable it for a month, and compare your Anthropic Console usage.

We don't pretend to do that. The dashboard's "$ saved" is an **estimate against a 3,000-token re-paste baseline**, clearly labelled as such.

---

## Who MemoryBridge helps a lot (and how much)

### Heavy savings — 30%+ of your AI session overhead

You match this profile if you:

- Switch between **multiple AI tools** on the same project (e.g. Claude Code in the morning, Cursor in the afternoon)
- Have **many short sessions** (20–100 per month, each under 30 minutes)
- Were **re-pasting project context** before — "this is a Next.js app using Supabase, the auth flow is..."
- Use the **response-style toggle** at level 1 or 2 (`memorybridge style 1` or `memorybridge shorter`)

For this user pattern, the savings can be very real — 30–60% reduction in input tokens spent on context re-establishment, plus 55–75% reduction in output tokens via style instructions. On a $20 Sonnet plan that's the difference between hitting your weekly limit on Thursday vs Sunday.

### Modest savings — 5–15% of overhead

You match this profile if you:

- Use **one AI tool primarily** (e.g. only Claude Code)
- Have **medium-length sessions** (1–3 hours each)
- **Sometimes** re-explained project context, sometimes didn't
- Use the response-style toggle at level 3 (default)

Still worth installing — invisible, free, runs in the background — but don't expect your bill to shrink by half.

### Minimal savings — under 5%

You match this profile if you:

- Have **very long sessions** (8+ hours continuous)
- Your usage is **>150k tokens of context** per session
- You **never re-paste** project context anyway because the AI has it from the same session
- You leave response-style at level 5 (verbose)

**MemoryBridge cannot help you much here.** Your session length and context depth dominate everything else. A 400-token memory load against a 200,000-token conversation is rounding error. Your dollar problem is "long sessions are expensive even when cached" — MemoryBridge doesn't solve that.

### Where MemoryBridge actively hurts

- **Nowhere on the cost side** — worst case it contributes zero tokens to a session
- **Trust side** — if the AI saves a wrong fact, the wrong fact propagates across sessions until you `memorybridge undo` or edit the file

Both are recoverable. Neither costs you actual money.

---

## A worked example: your screenshot's usage pattern

From the Claude Code Account & Usage panel you shared:

- **Session (5hr): 85%**
- **Weekly (7-day): 62%**
- **96% of your usage was at >150k context**
- **55% of your usage came from sessions active for 8+ hours**

Honest read:

You're a **heavy-context, long-session** user. MemoryBridge's mechanism is to save tokens at **session start** — at most ~3,000 tokens per session of context re-paste. If your session then grows to 150k+ tokens of context, your **per-session cost is dominated by that growth**, not the start.

Math (rough, Sonnet pricing):

- Without MemoryBridge: ~3,000 input tokens for context re-paste + 150,000 input tokens for the rest of the session = 153,000 × $3/M = **$0.46/session input**
- With MemoryBridge: ~250 input tokens served + 150,000 input tokens for the rest = 150,250 × $3/M = **$0.45/session input**
- **Savings: $0.01/session.** Multiplied by 30 sessions/month = $0.30/month.

That is not a useful number for your usage pattern. Be honest with yourself.

Where you *would* save: the response-style toggle. If you set `memorybridge style 1`, AI responses get capped at ~15 words. Output tokens cost 5× input ($15/M). If your sessions generate ~5,000 tokens of output per session (probably more for you), 75% off = 3,750 saved × 30 sessions × $15/M = **$1.69/month**. Better, but still not life-changing.

**For your usage pattern, the most useful Claude Code action is what Claude already suggests in that panel:** `/compact mid-task, /clear when switching to new tasks`. MemoryBridge complements that — it preserves project context across sessions so you can `/clear` more aggressively without losing what the AI knew. But the dollar savings are modest for heavy-context users.

---

## So why use it at all (your actual pattern)

Two reasons, neither is dollar-savings:

1. **Cross-tool continuity.** When you open the same project in Cursor or Antigravity, you don't re-onboard the AI. That's a time saving, not a token saving.
2. **Project knowledge that survives session clearing.** If you aggressively `/clear` (which the Claude panel recommends), MemoryBridge preserves the durable facts (stack, decisions, known bugs) across clear boundaries. You can clear context confidently, knowing the AI will reload what matters in the next session.

If you don't care about either of those, **uninstall it** — `memorybridge uninstall --purge`. Zero shame. No subscription to cancel.

---

## How to verify it's actually doing something on YOUR machine

Run these in order:

```bash
# 1. Did the MCP server actually start? (real file, real timestamps)
cat ~/.memorybridge/server.log

# 2. Did any AI tool actually call us? (real counts)
cat ~/.memorybridge/usage.jsonl

# 3. What does the AI see when it asks? (the actual returned text)
memorybridge load

# 4. Where do saves land? (the actual file)
cat <your-project>/.ai-memory.md

# 5. Open the dashboard with all of the above visualized
memorybridge dashboard
```

If `usage.jsonl` is empty or hasn't been written to in days, **the AI isn't calling us**. Possible causes:

- Claude Code hasn't been restarted since `memorybridge init` — restart it
- MCP config didn't take — run `memorybridge doctor`
- The AI just isn't calling memory_load proactively — try asking *"call memory_load"* in your next session

If `usage.jsonl` shows entries but you don't feel the difference, you're probably in the "modest savings" or "minimal savings" tier above. Decide if cross-tool continuity is worth the install.

---

## The straight answer

| Question | Answer |
|---|---|
| Does the MCP server work? | Yes, measurable, with proof in `~/.memorybridge/server.log` |
| Do my AI tools see MemoryBridge? | If `init` was run and you restarted them — yes. Run `memorybridge doctor` to verify. |
| Does it save tokens? | Yes, but only at session start, and only if the AI calls memory_load |
| Does it save dollars? | Sometimes meaningfully, sometimes negligibly — depends entirely on your usage pattern. Read the worked example above. |
| Is "tokens saved" measured? | The numerator (tokens served) is real. The denominator (baseline you'd have spent) is an estimate. Honest math on the dashboard footnote. |
| Will it break my projects? | No — see SAFETY.md. Audited every write operation. |
| Should I keep it installed? | Yes if cross-tool continuity matters to you. Yes if you have short, frequent sessions. Probably no if you live in 8-hour sessions at 150k+ context. |
| How do I get out? | `memorybridge uninstall --purge` — clean and reversible. |

---

*This document is honest by design. If a competitor's docs sound better than this, ask them to publish the same level of detail about their own product's failure modes. Then compare.*
