# Agent guide

Use this page when changing the repository as a coding agent. Human contributors
can use the same workflow. For application usage, start with
[getting started](getting-started.md).

## Before making changes

1. Read the task and inspect `git status --short` so you can preserve unrelated work.
2. Read [architecture](architecture.md) and the relevant source files. Configuration
   types live in [src/config.ts](../src/config.ts); commands live in
   [package.json](../package.json).
3. Find related tests and examples before choosing an implementation. Prefer the
   existing project patterns and keep the change within the requested scope.

## Behaviors to preserve

- Generated files belong to the generator. Change the input, config or renderer,
  then regenerate; keep handwritten application code outside generated output.
- Generation stages output before replacement. Validation failures must leave the
  existing client intact. Keep ownership checks and symlink rejection in place.
- `--check` compares without replacing the client. Preserved output directories are
  excluded from comparison and retained during normal generation.
- Query factories forward TanStack's `AbortSignal`, including when feature options
  contain another signal. Query keys include operation inputs and configured scope.
- Mutations use no variables for zero inputs, the input directly for one input,
  and a typed tuple for multiple inputs.
- Unsupported OpenAPI serialization and generated name collisions fail explicitly.
  See [OpenAPI requirements](openapi.md) for the supported input contract.
- The browser fetch runtime stays independent of Orval and Node.js tooling.
- Orval is pinned because the renderers depend on its generated AST. Treat an
  upgrade as a generator change and verify the resulting output.

## Verify the change

Use the check table in [development](development.md#choose-the-right-check).
For generator changes, the usual commands are:

```bash
npm test
npm run typecheck
npm run example:check
npm run format:check
```

Add `npm run test:package` when changing packaging, exports or CLI loading.
If catalog output intentionally changes, run `npm run example:generate`, review
the generated diff, then repeat `example:check` and `typecheck`.

For documentation-only changes, check formatting, local links and consistency with
the implementation. Format the changed files without reformatting unrelated work.

## Hand off the result

Review `git diff` and `git status --short`. Update the relevant documentation when
changing public behavior. Describe what changed, which checks ran and any remaining
limitations. Do not claim verification that was not performed.

[All documentation](README.md)
