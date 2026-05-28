<!-- Thanks for sending a PR. Please fill out the checklist below — it saves a lot of back-and-forth. -->

## What this changes

<!-- One or two sentences. What does this PR do and why? -->

## How I verified it works

<!-- The exact commands you ran and what you saw. Smoke-test output is fine. -->

```
$ npm run build
$ node dist/cli.js doctor
$ ...
```

## Token-frugality check

- [ ] My change does not increase the default `memory_load` size by more than 20 tokens, OR I have a strong justification documented below.
- [ ] If I added MCP tool surface, the total token count is still under 200.

<!-- If your PR doesn't touch loading: just check the box and move on. -->

## Safety check

- [ ] My change does not write to any file outside the SAFETY.md contract.
- [ ] My change does not silently overwrite hand-written files.
- [ ] My change does not introduce a cloud / network dependency.
- [ ] My change does not introduce a vector DB / LLM extraction step.

## Scope check

- [ ] This PR does one thing. (If it does multiple things, please split into multiple PRs.)
- [ ] I have not added new runtime dependencies (or, if I have, I've explained why below).

## Linked issues

<!-- Closes #N — or, for big changes, "Discussed in #N" -->
