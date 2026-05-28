# Contributing to MemoryBridge

Thanks for considering a contribution. MemoryBridge stays useful by staying small, honest, and token-frugal — please read this before you open a PR.

## Quick start

```bash
git clone https://github.com/IamRamgarhia/memorybridge.git
cd memorybridge
npm install
npm run build
node dist/cli.js doctor
```

## Good first issues

These are concrete, contained tasks that map well to a first PR:

1. **Add a new AI tool to detection** — edit `src/scan.ts` to add the config-path checks for tools like Aider, JetBrains AI, Zed, or Codex CLI when they ship MCP. Each new tool is a 10-line addition.
2. **Add an emit format** — edit `src/emit.ts` to add a new format (e.g. `aiderrules`, JetBrains AI rules) when those tools land. Each format is ~30 lines.
3. **Improve symbol extraction** — `src/symbols.ts` is regex-based for JS/TS/Py/Go. PRs that add Rust, Java, Ruby, or PHP patterns are welcome.
4. **Add to the sensitive-content blocker** — `src/memory.ts` has the `BLOCKED_PATTERNS` array. Currently English-only and regex-based. Multilingual patterns + better heuristics are needed.
5. **Tests** — there's currently no test suite. The smoke tests live in this README's commands. A real Jest/Vitest suite would be welcome.
6. **README translations** — if you can read and translate to a non-English language, the README's value prop should travel.

## The rules (please follow)

### Token frugality is the #1 design constraint

Any change that increases the default `memory_load` size by more than 20 tokens needs a strong justification. The whole product breaks if the file gets bloaty. If your change adds anything to the loaded output, measure the before/after with `memorybridge load` and include the numbers in your PR.

### Safety contract — never break the promises in SAFETY.md

We do not modify user source code. We do not silently overwrite hand-written files. We do not lose data without recording a snapshot. If your PR touches anything that writes a file, read [SAFETY.md](SAFETY.md) first and explain in the PR description how your change preserves every promise there.

### No vector DB. No cloud. No LLM dependencies.

These are not "v1 limitations" — they are the product. MemoryBridge competes by being the smallest, least-magical, most-local memory tool. PRs that add a vector store, an embedding model, an LLM extraction step, or a cloud-sync feature will be closed.

### Honest output is required

Every metric the tool shows should clearly distinguish **measured** from **estimated**. If you add a number to `stats`, `compare`, `quality`, or `doctor`, label it. The user must be able to know which numbers came from real counters and which came from assumptions.

### Smallest possible scope per PR

Three lines that fix one bug > 300 lines that add 5 features. If you have multiple things to change, open multiple PRs.

## How to propose a bigger change

Open an issue first describing:

1. The user problem (in plain English, with an example)
2. What you'd change
3. How you'd preserve the token-frugality + safety contracts above
4. Roughly how much code (small, medium, large)

Big changes that surprise the maintainer are hard to merge. Discussion first is faster than rewriting later.

## Code style

- TypeScript, strict mode, no `any` unless absolutely needed
- ES modules
- No new runtime dependencies without strong justification (current deps: `@modelcontextprotocol/sdk`, `gpt-tokenizer` — that's it)
- Prefer regex-based heuristics over heavy parsers (we picked this trade-off deliberately — see why-not-tree-sitter in [BUILD_PLAN.md](BUILD_PLAN.md))
- Stderr for status messages MemoryBridge emits during a save (so users know what we did)
- Don't add comments that just restate the code

## Build + verify locally before opening a PR

```bash
npm run build           # must succeed with no TS errors
node dist/cli.js help   # smoke test the CLI
node dist/cli.js doctor # smoke test core paths
```

## License

By contributing you agree that your contribution is MIT-licensed under the project's [LICENSE](LICENSE).

## Conduct

Be kind. Be honest. Don't drama. See [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
