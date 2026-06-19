import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { globalDir, usageLog } from "./paths.js";
import { computeStats, readUsage, UsageEvent } from "./stats.js";
import { getCurrentStyle, PROFILES } from "./style.js";
import { listProjects, rebuildIndex, IndexedProject } from "./projects.js";
import { detectTools } from "./scan.js";
import { findProjectFile, lineCount } from "./memory.js";

export const DASHBOARD_FILE = path.join(globalDir(), "dashboard.html");

const PRICING = {
  haiku: { input: 0.25, output: 1.25 },
  sonnet: { input: 3.0, output: 15.0 },
  opus: { input: 15.0, output: 75.0 },
};
const BASELINE_INPUT_PER_LOAD = 3000;
const BASELINE_OUTPUT_PER_LOAD = 800;

interface DailyBucket {
  date: string;
  loads: number;
  saves: number;
  searches: number;
  tokensServed: number;
}

function aggregateByDay(events: UsageEvent[], days: number): DailyBucket[] {
  const buckets = new Map<string, DailyBucket>();
  const now = Date.now();
  const cutoff = now - days * 24 * 60 * 60 * 1000;
  for (let i = 0; i < days; i++) {
    const d = new Date(now - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    buckets.set(d, { date: d, loads: 0, saves: 0, searches: 0, tokensServed: 0 });
  }
  for (const e of events) {
    const ts = new Date(e.ts).getTime();
    if (ts < cutoff) continue;
    const d = e.ts.slice(0, 10);
    const b = buckets.get(d) ?? { date: d, loads: 0, saves: 0, searches: 0, tokensServed: 0 };
    if (e.action === "load") {
      b.loads++;
      b.tokensServed += e.tokens || 0;
    } else if (e.action === "save") b.saves++;
    else if (e.action === "search") b.searches++;
    buckets.set(d, b);
  }
  return Array.from(buckets.values()).sort((a, b) => a.date.localeCompare(b.date));
}

function svgLineChart(buckets: DailyBucket[], width = 760, height = 180): string {
  if (buckets.length === 0) return `<svg width="${width}" height="${height}"></svg>`;
  const padding = { top: 20, right: 16, bottom: 26, left: 44 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const maxTokens = Math.max(1, ...buckets.map((b) => b.tokensServed));
  const stepX = buckets.length > 1 ? w / (buckets.length - 1) : 0;

  const pointsServed = buckets.map((b, i) => {
    const x = padding.left + i * stepX;
    const y = padding.top + h - (b.tokensServed / maxTokens) * h;
    return `${x},${y}`;
  });

  const ySteps = 4;
  const grid: string[] = [];
  for (let i = 0; i <= ySteps; i++) {
    const y = padding.top + h - (i / ySteps) * h;
    const value = Math.round((maxTokens * i) / ySteps).toLocaleString();
    grid.push(`<line x1="${padding.left}" y1="${y}" x2="${padding.left + w}" y2="${y}" stroke="#21262d" stroke-width="1"/>`);
    grid.push(`<text x="${padding.left - 6}" y="${y + 3}" text-anchor="end" fill="#7d8590" font-size="10">${value}</text>`);
  }

  const xLabels: string[] = [];
  const labelEvery = Math.max(1, Math.floor(buckets.length / 8));
  buckets.forEach((b, i) => {
    if (i % labelEvery !== 0 && i !== buckets.length - 1) return;
    const x = padding.left + i * stepX;
    xLabels.push(`<text x="${x}" y="${height - 8}" text-anchor="middle" fill="#7d8590" font-size="10">${b.date.slice(5)}</text>`);
  });

  const lineColor = "#7ee787";
  const areaPath = `M${pointsServed[0]} L${pointsServed.join(" L")} L${padding.left + (buckets.length - 1) * stepX},${padding.top + h} L${padding.left},${padding.top + h} Z`;

  return `<svg width="${width}" height="${height}" font-family="ui-sans-serif, -apple-system, 'Segoe UI', sans-serif">
    ${grid.join("\n")}
    <path d="${areaPath}" fill="${lineColor}" fill-opacity="0.1"/>
    <polyline points="${pointsServed.join(" ")}" fill="none" stroke="${lineColor}" stroke-width="2"/>
    ${pointsServed.map((p) => `<circle cx="${p.split(",")[0]}" cy="${p.split(",")[1]}" r="3" fill="${lineColor}"/>`).join("\n")}
    ${xLabels.join("\n")}
  </svg>`;
}

function svgBarChart(buckets: DailyBucket[], width = 760, height = 140): string {
  if (buckets.length === 0) return `<svg width="${width}" height="${height}"></svg>`;
  const padding = { top: 12, right: 16, bottom: 26, left: 44 };
  const w = width - padding.left - padding.right;
  const h = height - padding.top - padding.bottom;
  const maxCalls = Math.max(1, ...buckets.map((b) => b.loads + b.saves + b.searches));
  const barW = Math.max(2, (w / buckets.length) - 3);

  const bars: string[] = [];
  buckets.forEach((b, i) => {
    const x = padding.left + i * (w / buckets.length);
    const stack = (count: number, baseY: number, color: string) => {
      const barH = (count / maxCalls) * h;
      const y = baseY - barH;
      bars.push(`<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}"/>`);
      return y;
    };
    let y = padding.top + h;
    if (b.loads) y = stack(b.loads, y, "#79c0ff");
    if (b.saves) y = stack(b.saves, y, "#7ee787");
    if (b.searches) y = stack(b.searches, y, "#d2a8ff");
  });

  const ySteps = 3;
  const grid: string[] = [];
  for (let i = 0; i <= ySteps; i++) {
    const y = padding.top + h - (i / ySteps) * h;
    const value = Math.round((maxCalls * i) / ySteps);
    grid.push(`<line x1="${padding.left}" y1="${y}" x2="${padding.left + w}" y2="${y}" stroke="#21262d" stroke-width="1"/>`);
    grid.push(`<text x="${padding.left - 6}" y="${y + 3}" text-anchor="end" fill="#7d8590" font-size="10">${value}</text>`);
  }

  return `<svg width="${width}" height="${height}" font-family="ui-sans-serif, sans-serif">
    ${grid.join("\n")}
    ${bars.join("\n")}
  </svg>`;
}

function describeFile(memoryFile: string): { entries: number; bytes: number; sections: string[] } {
  try {
    const text = fs.readFileSync(memoryFile, "utf8");
    const entries = text.split("\n").filter((l) => l.match(/^-\s*\[\d{4}-\d{2}-\d{2}\]/)).length;
    const sections = Array.from(text.matchAll(/^##\s+(@\w+)/gm)).map((m) => m[1]);
    return { entries, bytes: Buffer.byteLength(text, "utf8"), sections };
  } catch {
    return { entries: 0, bytes: 0, sections: [] };
  }
}

function fmt(n: number): string {
  return n.toLocaleString("en-US");
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

export function generateDashboardHtml(): string {
  const events = readUsage();
  const stats = computeStats(events);
  const style = getCurrentStyle();
  const projects = listProjects();
  const tools = detectTools();
  const buckets = aggregateByDay(events, 30);

  const outputSaved = style.on
    ? Math.round((stats.loads * BASELINE_OUTPUT_PER_LOAD * style.profile.estOutputSavingsPercent) / 100)
    : 0;

  const projectsWithUsage = projects.map((p) => {
    const projEvents = events.filter((e) => e.project === path.basename(p.path));
    const projLoads = projEvents.filter((e) => e.action === "load").length;
    const projTokens = projEvents.filter((e) => e.action === "load").reduce((a, b) => a + (b.tokens || 0), 0);
    const desc = describeFile(p.memoryFile);
    return { ...p, projLoads, projTokens, ...desc };
  });

  const recentEvents = events.slice(-25).reverse();
  const lastActivityDate = events.length > 0 ? events[events.length - 1].ts.slice(0, 10) : "—";
  const firstActivityDate = events.length > 0 ? events[0].ts.slice(0, 10) : "—";

  const totalInputSaved = stats.estimatedSaved;
  const totalOutputSaved = outputSaved;
  const haikuSaved = (totalInputSaved / 1e6) * PRICING.haiku.input + (totalOutputSaved / 1e6) * PRICING.haiku.output;
  const sonnetSaved = (totalInputSaved / 1e6) * PRICING.sonnet.input + (totalOutputSaved / 1e6) * PRICING.sonnet.output;
  const opusSaved = (totalInputSaved / 1e6) * PRICING.opus.input + (totalOutputSaved / 1e6) * PRICING.opus.output;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1"/>
<title>MemoryBridge — Dashboard</title>
<style>
  :root {
    --bg: #0d1117;
    --bg-2: #161a22;
    --bg-3: #1c2128;
    --border: #21262d;
    --border-2: #30363d;
    --text: #e6edf3;
    --text-2: #7d8590;
    --green: #7ee787;
    --blue: #79c0ff;
    --purple: #d2a8ff;
    --orange: #ffa657;
    --red: #ff7b72;
    --yellow: #fbbf24;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: ui-sans-serif, -apple-system, 'Segoe UI', Inter, sans-serif; line-height: 1.5; padding: 24px; max-width: 1200px; margin: 0 auto; }
  h1 { font-size: 24px; font-weight: 700; }
  h2 { font-size: 14px; font-weight: 600; color: var(--text-2); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 12px; }
  h3 { font-size: 16px; font-weight: 600; margin-bottom: 8px; }
  a { color: var(--blue); text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 13px; background: var(--bg-2); padding: 2px 6px; border-radius: 4px; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 32px; padding-bottom: 16px; border-bottom: 1px solid var(--border); }
  .header-meta { color: var(--text-2); font-size: 13px; }
  .grid { display: grid; gap: 16px; }
  .grid-4 { grid-template-columns: repeat(4, 1fr); }
  .grid-2 { grid-template-columns: 1fr 1fr; }
  .grid-3 { grid-template-columns: repeat(3, 1fr); }
  .card { background: var(--bg-2); border: 1px solid var(--border); border-radius: 8px; padding: 20px; }
  .card-stat .label { color: var(--text-2); font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; }
  .card-stat .value { font-size: 28px; font-weight: 700; margin: 6px 0; }
  .card-stat .delta { font-size: 12px; color: var(--green); }
  .card-stat .delta.warn { color: var(--orange); }
  .section { margin-top: 32px; }
  .progress { background: var(--bg-3); height: 8px; border-radius: 999px; overflow: hidden; }
  .progress-fill { height: 100%; background: var(--green); transition: width .3s; }
  .style-slider { display: flex; gap: 4px; margin: 12px 0; }
  .style-pill { flex: 1; padding: 10px 8px; background: var(--bg-3); border-radius: 6px; text-align: center; font-size: 12px; }
  .style-pill.active { background: var(--blue); color: var(--bg); font-weight: 600; }
  .style-pill .level { font-size: 18px; font-weight: 700; display: block; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { text-align: left; color: var(--text-2); font-weight: 500; padding: 10px 8px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; }
  td { padding: 10px 8px; border-bottom: 1px solid var(--border); }
  tr:last-child td { border-bottom: none; }
  td.right { text-align: right; }
  td.muted { color: var(--text-2); }
  td.mono { font-family: ui-monospace, monospace; font-size: 12px; }
  .check { color: var(--green); }
  .cross { color: var(--text-2); }
  .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; font-size: 11px; font-weight: 600; }
  .pill-green { background: rgba(126,231,135,0.15); color: var(--green); }
  .pill-blue { background: rgba(121,192,255,0.15); color: var(--blue); }
  .pill-purple { background: rgba(210,168,255,0.15); color: var(--purple); }
  .legend { display: flex; gap: 16px; font-size: 12px; color: var(--text-2); margin-top: 8px; }
  .legend-dot { display: inline-block; width: 10px; height: 10px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  .activity-row { display: flex; gap: 12px; padding: 8px 0; border-bottom: 1px solid var(--border); font-size: 13px; }
  .activity-row:last-child { border-bottom: none; }
  .activity-ts { color: var(--text-2); font-family: ui-monospace, monospace; min-width: 150px; font-size: 11px; }
  .actions-list { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-top: 12px; }
  .action-item { background: var(--bg-3); padding: 10px 12px; border-radius: 6px; font-size: 13px; }
  .action-item code { background: transparent; padding: 0; color: var(--blue); display: block; margin-bottom: 4px; }
  .action-item .desc { color: var(--text-2); font-size: 11px; }
  .footnote { color: var(--text-2); font-size: 11px; line-height: 1.6; margin-top: 16px; padding: 12px; background: var(--bg-2); border-radius: 6px; border-left: 3px solid var(--orange); }
  @media (max-width: 720px) {
    .grid-4, .grid-3 { grid-template-columns: 1fr 1fr; }
    .grid-2 { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>

<div class="header">
  <div>
    <h1>MemoryBridge — Dashboard</h1>
    <div class="header-meta">Tracking since ${firstActivityDate} · Last activity ${lastActivityDate} · Generated ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC</div>
  </div>
  <div class="header-meta">
    <a href="https://github.com/IamRamgarhia/memorybridge">github.com/IamRamgarhia/memorybridge</a>
  </div>
</div>

<div class="grid grid-4">
  <div class="card card-stat">
    <div class="label">memory_load calls</div>
    <div class="value">${fmt(stats.loads)}</div>
    <div class="delta">${fmt(stats.tokensServed)} tokens served</div>
  </div>
  <div class="card card-stat">
    <div class="label">memory_save calls</div>
    <div class="value">${fmt(stats.saves)}</div>
    <div class="delta">${fmt(stats.searches)} searches</div>
  </div>
  <div class="card card-stat">
    <div class="label">Projects tracked</div>
    <div class="value">${fmt(projects.length)}</div>
    <div class="delta">${projectsWithUsage.filter((p) => p.projLoads > 0).length} active</div>
  </div>
  <div class="card card-stat">
    <div class="label">Estimated $ saved (Sonnet)</div>
    <div class="value">$${sonnetSaved.toFixed(2)}</div>
    <div class="delta">${stats.savingsPercent}% input savings</div>
  </div>
</div>

<div class="section">
  <h2>Token activity — last 30 days</h2>
  <div class="card">
    <h3>Tokens served via memory_load (per day)</h3>
    ${svgLineChart(buckets, 1100, 200)}
    <h3 style="margin-top:20px">Tool calls (per day)</h3>
    ${svgBarChart(buckets, 1100, 140)}
    <div class="legend">
      <div><span class="legend-dot" style="background:#79c0ff"></span>memory_load</div>
      <div><span class="legend-dot" style="background:#7ee787"></span>memory_save</div>
      <div><span class="legend-dot" style="background:#d2a8ff"></span>memory_search</div>
    </div>
  </div>
</div>

<div class="section grid grid-2">
  <div class="card">
    <h2>Response style — biggest output saver</h2>
    <h3>Current: level ${style.profile.level} of 5 — ${style.profile.name}</h3>
    <div class="style-slider">
      ${[1, 2, 3, 4, 5].map((n) => {
        const p = PROFILES[n as 1|2|3|4|5];
        const active = style.on && p.level === style.profile.level;
        return `<div class="style-pill${active ? " active" : ""}">
          <span class="level">${n}</span>
          ${p.name}<br>
          <span style="color:${active ? "var(--bg)" : "var(--text-2)"};font-size:10px">${p.estOutputSavingsPercent}% saved</span>
        </div>`;
      }).join("")}
    </div>
    <p style="color:var(--text-2); font-size:12px; margin-top:8px">
      Run <code>memorybridge shorter</code> / <code>longer</code> to adjust. Output tokens cost 5× input tokens.
    </p>
  </div>

  <div class="card">
    <h2>AI tools connected</h2>
    ${tools.map((t) => `
      <div style="display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid var(--border); font-size:13px">
        <span>${t.detected ? '<span class="check">✓</span>' : '<span class="cross">○</span>'} ${t.name}</span>
        <span class="muted" style="font-family:monospace; font-size:11px; color:var(--text-2)">${escapeHtml(t.configPath ?? "—")}</span>
      </div>`).join("")}
  </div>
</div>

<div class="section">
  <h2>Projects with memory files</h2>
  <div class="card">
    ${projectsWithUsage.length === 0 ? `
      <p style="color:var(--text-2)">No projects indexed yet. Run <code>memorybridge index</code> to scan your filesystem.</p>
    ` : `
    <table>
      <thead>
        <tr>
          <th>Project</th>
          <th class="right">Entries</th>
          <th class="right">Sections</th>
          <th class="right">Bytes</th>
          <th class="right">Loads</th>
          <th class="right">Tokens served</th>
          <th>Path</th>
        </tr>
      </thead>
      <tbody>
        ${projectsWithUsage.map((p) => `
          <tr>
            <td><strong>${escapeHtml(p.name)}</strong></td>
            <td class="right">${fmt(p.entries)}</td>
            <td class="right muted">${p.sections.length}</td>
            <td class="right muted">${fmt(p.bytes)}</td>
            <td class="right">${p.projLoads > 0 ? `<span class="pill pill-blue">${p.projLoads}</span>` : '<span class="muted">0</span>'}</td>
            <td class="right">${p.projTokens > 0 ? `<span class="pill pill-green">${fmt(p.projTokens)}</span>` : '<span class="muted">0</span>'}</td>
            <td class="mono muted">${escapeHtml(p.path)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
    `}
  </div>
</div>

<div class="section grid grid-2">
  <div class="card">
    <h2>Recent activity</h2>
    ${recentEvents.length === 0 ? `
      <p style="color:var(--text-2)">No events yet. Use an AI tool with MemoryBridge connected and events will appear here.</p>
    ` : recentEvents.map((e) => `
      <div class="activity-row">
        <span class="activity-ts">${escapeHtml(e.ts.replace("T", " ").slice(0, 19))}</span>
        <span class="pill pill-${e.action === "load" ? "blue" : e.action === "save" ? "green" : "purple"}">${e.action}</span>
        <span style="color:var(--text-2)">${escapeHtml(e.project ?? "—")}</span>
        <span style="margin-left:auto; color:var(--text-2); font-size:11px">${e.tokens ? `${fmt(e.tokens)} tok` : ""} · ${escapeHtml(e.tool)}</span>
      </div>
    `).join("")}
  </div>

  <div class="card">
    <h2>Estimated $ saved by model tier</h2>
    <table>
      <thead><tr><th>Model</th><th class="right">Per session avg</th><th class="right">Total saved</th></tr></thead>
      <tbody>
        <tr><td>Haiku</td><td class="right muted">$${(haikuSaved / Math.max(1, stats.loads)).toFixed(4)}</td><td class="right" style="color:var(--green)">$${haikuSaved.toFixed(4)}</td></tr>
        <tr><td>Sonnet</td><td class="right muted">$${(sonnetSaved / Math.max(1, stats.loads)).toFixed(4)}</td><td class="right" style="color:var(--green)">$${sonnetSaved.toFixed(2)}</td></tr>
        <tr><td>Opus</td><td class="right muted">$${(opusSaved / Math.max(1, stats.loads)).toFixed(4)}</td><td class="right" style="color:var(--green)">$${opusSaved.toFixed(2)}</td></tr>
      </tbody>
    </table>
    <div class="footnote">
      <strong>What's measured vs estimated:</strong><br>
      <strong>Measured</strong> (real, from <code>${escapeHtml(usageLog())}</code>): every call count, every token served via memory_load.<br>
      <strong>Estimated</strong> (modelled, may not match your habits): "Tokens saved" assumes you would have re-pasted ~${BASELINE_INPUT_PER_LOAD} tokens of context per session without MemoryBridge. If you re-paste less, savings shrink; if more, savings grow. The output-tokens-saved number uses the current style level's published savings rate (${style.profile.estOutputSavingsPercent}%) against an ~${BASELINE_OUTPUT_PER_LOAD}-token baseline reply. Both are approximations — see SAFETY.md for the honest math.
    </div>
  </div>
</div>

<div class="section">
  <h2>Quick actions</h2>
  <div class="card">
    <div class="actions-list">
      <div class="action-item"><code>memorybridge shorter</code><span class="desc">Shorter AI responses → save more output tokens</span></div>
      <div class="action-item"><code>memorybridge longer</code><span class="desc">Longer AI responses → more detail</span></div>
      <div class="action-item"><code>memorybridge add "&lt;text&gt;"</code><span class="desc">Manually save a memory entry</span></div>
      <div class="action-item"><code>memorybridge open</code><span class="desc">Open this project's .ai-memory.md in your editor</span></div>
      <div class="action-item"><code>memorybridge compare</code><span class="desc">Side-by-side before/after with cost math</span></div>
      <div class="action-item"><code>memorybridge quality</code><span class="desc">Score your memory file for junk content (A–F)</span></div>
      <div class="action-item"><code>memorybridge undo</code><span class="desc">Roll back the most recent memory change</span></div>
      <div class="action-item"><code>memorybridge diagnostics</code><span class="desc">Deep health check — finds bugs and suggests fixes</span></div>
    </div>
  </div>
</div>

</body>
</html>`;
}

export function writeDashboard(opts: { rebuildIndex?: boolean; cwd?: string } = {}): string {
  const dir = globalDir();
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const projectsNow = listProjects();
  if (opts.rebuildIndex !== false && projectsNow.length === 0) {
    try { rebuildIndex({ extraRoots: opts.cwd ? [opts.cwd] : [process.cwd()] }); } catch {}
  }
  const html = generateDashboardHtml();
  fs.writeFileSync(DASHBOARD_FILE, html, "utf8");
  return DASHBOARD_FILE;
}

export function openInBrowser(filePath: string): void {
  const platform = process.platform;
  if (platform === "win32") {
    spawn("cmd", ["/c", "start", "", filePath], { detached: true, stdio: "ignore" }).unref();
  } else if (platform === "darwin") {
    spawn("open", [filePath], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [filePath], { detached: true, stdio: "ignore" }).unref();
  }
}
