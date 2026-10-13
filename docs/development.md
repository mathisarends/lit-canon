# Development

Use Node.js 22.18.0 or later. Install the locked dependencies with `npm ci`.
Read the [architecture guide](architecture.md) to find the relevant module.

## Verification commands

```bash
npm ci
npm test
npm run typecheck
npm run example:check
npm run format:check
npm run test:package
npm pack
```

`typecheck` includes the checked-in generated client and Lit component.
`test:package` installs the tarball in an independent temporary project and checks
the CLI, TypeScript configuration, client generation, drift detection and types.
To compare a project's existing generated client against its configuration:

```bash
node test/client-parity.ts /path/to/app/lit-query-codegen.config.ts
```

Orval is pinned because the transformation processes its generated TypeScript
AST. Run the integration tests when upgrading it. The package uses `UNLICENSED`;
choose a public license before publishing if needed.

## Choose the right check

| Change                                         | Verification                                                                                               |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Markdown documentation                         | `npm run format:check` and check relative links and examples.                                              |
| Fetch runtime                                  | `npm run build`, then `node --test test/runtime.test.ts`; run `npm run typecheck` for public type changes. |
| Generator, configuration or output             | `npm test`, `npm run typecheck`, `npm run example:check` and `npm run format:check`.                       |
| Package exports, CLI loading or packaged files | Also run `npm run test:package`.                                                                           |

If a generator change intentionally updates the catalog output, run
`npm run example:generate`, review the generated diff, then run `example:check`
and `typecheck`. Change the specification, configuration or renderer rather than
editing generated files by hand.

CI runs typechecking, example drift checking, formatting, tests and the package
smoke test on Linux and Windows with Node 22.18.0 and 24. See the
[workflow](../.github/workflows/ci.yml) for the exact matrix and commands.

## Repository conventions

- Source is strict TypeScript using ES modules. Source imports use `.js` extensions
  for the compiled NodeNext output.
- Prettier controls formatting: two spaces, double quotes, semicolons and LF endings.
  Format changed files with `npx prettier --write <files>`.
- `dist/`, `node_modules/`, `.test-output/` and package tarballs are ignored build or
  local artifacts. The catalog's generated TypeScript is committed.
- Keep the README focused on first use. Put detailed behavior in the matching
  `docs/` page and update links when moving documentation.

[All documentation](README.md)
