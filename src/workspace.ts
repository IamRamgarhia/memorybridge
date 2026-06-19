import fs from "node:fs";
import path from "node:path";
import { findProjectFile, findProjectRoot, PROJECT_FILE } from "./memory.js";

const PROJECT_MARKERS = [".git", "package.json", "pyproject.toml", "Cargo.toml", "go.mod", "pom.xml", "build.gradle", "composer.json"];

export interface WorkspaceResolution {
  source: "explicit" | "env" | "cwd-has-memory" | "cwd-has-marker" | "cwd-fallback" | "global-only";
  cwdAtStartup: string;
  projectRoot: string;
  memoryFilePath: string;
  memoryFileExists: boolean;
  envHintsTried: string[];
  envHintFound?: string;
  warning?: string;
}

const ENV_HINTS = [
  "MEMORYBRIDGE_PROJECT",
  "WORKSPACE_FOLDER",
  "VSCODE_WORKSPACE_FOLDER",
  "CURSOR_WORKSPACE",
  "CLAUDE_PROJECT_DIR",
  "INIT_CWD",
  "PWD",
];

function looksLikeProjectRoot(p: string): boolean {
  try {
    if (!fs.existsSync(p)) return false;
    if (fs.existsSync(path.join(p, PROJECT_FILE))) return true;
    for (const m of PROJECT_MARKERS) {
      if (fs.existsSync(path.join(p, m))) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function resolveWorkspace(opts: { explicitProjectPath?: string } = {}): WorkspaceResolution {
  const cwd = process.cwd();
  const envHintsTried: string[] = [];

  if (opts.explicitProjectPath && opts.explicitProjectPath.trim()) {
    const abs = path.resolve(opts.explicitProjectPath.trim());
    const memFile = findProjectFile(abs) ?? path.join(findProjectRoot(abs), PROJECT_FILE);
    return {
      source: "explicit",
      cwdAtStartup: cwd,
      projectRoot: findProjectRoot(abs),
      memoryFilePath: memFile,
      memoryFileExists: fs.existsSync(memFile),
      envHintsTried: [],
    };
  }

  for (const key of ENV_HINTS) {
    envHintsTried.push(key);
    const val = process.env[key];
    if (val && val.trim() && fs.existsSync(val) && looksLikeProjectRoot(val)) {
      const abs = path.resolve(val.trim());
      const memFile = findProjectFile(abs) ?? path.join(findProjectRoot(abs), PROJECT_FILE);
      return {
        source: "env",
        cwdAtStartup: cwd,
        projectRoot: findProjectRoot(abs),
        memoryFilePath: memFile,
        memoryFileExists: fs.existsSync(memFile),
        envHintsTried,
        envHintFound: `${key}=${val}`,
      };
    }
  }

  const memInCwd = findProjectFile(cwd);
  if (memInCwd) {
    return {
      source: "cwd-has-memory",
      cwdAtStartup: cwd,
      projectRoot: path.dirname(memInCwd),
      memoryFilePath: memInCwd,
      memoryFileExists: true,
      envHintsTried,
    };
  }

  const markerRoot = findProjectRoot(cwd);
  if (markerRoot !== cwd || PROJECT_MARKERS.some((m) => fs.existsSync(path.join(cwd, m)))) {
    return {
      source: "cwd-has-marker",
      cwdAtStartup: cwd,
      projectRoot: markerRoot,
      memoryFilePath: path.join(markerRoot, PROJECT_FILE),
      memoryFileExists: fs.existsSync(path.join(markerRoot, PROJECT_FILE)),
      envHintsTried,
    };
  }

  return {
    source: "cwd-fallback",
    cwdAtStartup: cwd,
    projectRoot: cwd,
    memoryFilePath: path.join(cwd, PROJECT_FILE),
    memoryFileExists: false,
    envHintsTried,
    warning: "No project marker (.git / package.json / etc.) found by walking up from CWD. The AI should pass project_path explicitly for accurate memory placement. Otherwise only global memory will be used.",
  };
}

export function formatResolution(r: WorkspaceResolution): string {
  const out: string[] = [];
  out.push(`source:           ${r.source}`);
  out.push(`cwd at startup:   ${r.cwdAtStartup}`);
  out.push(`detected root:    ${r.projectRoot}`);
  out.push(`memory file:      ${r.memoryFilePath}`);
  out.push(`exists:           ${r.memoryFileExists}`);
  if (r.envHintFound) out.push(`env hint found:   ${r.envHintFound}`);
  if (r.envHintsTried.length > 0) out.push(`env hints tried:  ${r.envHintsTried.join(", ")}`);
  if (r.warning) out.push(`WARNING:          ${r.warning}`);
  return out.join("\n");
}
