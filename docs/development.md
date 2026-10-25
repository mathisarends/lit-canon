# Development

This repository is a pnpm workspace with three packages:

| Package                 | Directory                                       | Purpose                                                   |
| ----------------------- | ----------------------------------------------- | --------------------------------------------------------- |
| `lit-canon-api`         | [packages/api](../packages/api)                 | Generator and CLI: OpenAPI → client, keys, query options. |
| `lit-canon-fetch`       | [packages/fetch](../packages/fetch)             | Browser fetch runtime used by generated clients.          |
| `lit-canon-composition` | [packages/composition](../packages/composition) | App composition: pages, features, guards, providers.      |

The repository name, lit-canon, is the umbrella; there is no `lit-canon` package.
`lit-canon-api` has no runtime dependency on `lit-canon-fetch`: generated code
imports it in the application. The generator uses it only as a `workspace:*` dev
dependency for its tests. The composition package is independent of the other two.

Use Node.js 22.18.0 or later and the pnpm version from `packageManager` in the root
[package.json](../package.json). Read the [architecture guide](architecture.md) to
find the relevant module.

## Setup and verification

```bash
pnpm install
pnpm --filter lit-canon-composition exec playwright install chromium   # once
pnpm build
pnpm typecheck
pnpm test
pnpm example:check
pnpm format:check
pnpm test:package
```

| Command                 | What it does                                                                                 |
| ----------------------- | -------------------------------------------------------------------------------------------- |
| `pnpm build`            | Builds every package into its `dist/`.                                                       |
| `pnpm typecheck`        | Typechecks every package, then the root `examples/` against the built packages.              |
| `pnpm test`             | Runs `node --test` for api and fetch, and Vitest browser tests for composition.              |
| `pnpm example:generate` | Builds, then regenerates `examples/catalog/generated/`.                                      |
| `pnpm example:check`    | Builds, then runs `lit-canon-api check` on the catalog example.                              |
| `pnpm format:check`     | Checks Prettier formatting for the whole repository.                                         |
| `pnpm test:package`     | Packs all packages, installs them in a temporary pnpm project and checks public entrypoints. |

Run a single package with `pnpm --filter <name> <script>`, for example
`pnpm --filter lit-canon-fetch test`. The composition example app runs with
`pnpm --filter lit-canon-composition example`.

`test:package` must run through pnpm: it uses pnpm to pack and to install the
tarballs, and checks that only `dist/`, `README.md`, `LICENSE` and `package.json`
are published and that no `workspace:` specifier remains.

Orval is pinned because the generator transforms its TypeScript output; see
[decision 0001](decisions/0001-orval-postprocessing.md). Run the generator tests and
review the catalog diff when upgrading it.

## Choose the right check

| Change                                         | Verification                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Markdown documentation                         | `pnpm format:check`, then check relative links and examples.                                    |
| Fetch runtime                                  | `pnpm --filter lit-canon-fetch test`; `pnpm typecheck` for public type changes.                 |
| Generator, configuration or output             | `pnpm test`, `pnpm typecheck`, `pnpm example:check` and `pnpm format:check`.                    |
| Package exports, CLI loading or packaged files | Also run `pnpm test:package`.                                                                   |
| Composition package                            | `pnpm --filter lit-canon-composition test` and `pnpm --filter lit-canon-composition typecheck`. |

If a generator change intentionally updates the catalog output, run
`pnpm example:generate`, review the generated diff, then run `example:check` and
`typecheck`. Change the specification, configuration or renderer rather than
editing generated files by hand.

CI runs build, typecheck, the example drift check, formatting, all tests and the
package smoke test on Linux and Windows with Node 22.18.0 and 24. There is no
publish workflow. See the [workflow](../.github/workflows/ci.yml) for the exact steps.

## Repository conventions

- Source is strict TypeScript with ES modules. api and fetch use NodeNext and import
  with `.js` extensions; composition uses its own TypeScript version and Vitest.
- Prettier controls formatting: two spaces, double quotes, semicolons and LF endings.
  Format changed files with `pnpm exec prettier --write <files>`.
- `dist/`, `node_modules/`, `.test-output/`, Vitest output and package tarballs are
  ignored. The catalog's generated TypeScript is committed.
- Every package ships `README.md` and `LICENSE` (MIT). Keep package READMEs focused
  on first use and put details into `docs/`.
- Record decisions that close an open design question in `docs/decisions/`.

[All documentation](README.md)
