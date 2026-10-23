# Architecture

The package has two entry points: the Node.js generator (`lit-query-codegen`) and
the fetch runtime used by generated clients (`lit-query-codegen/runtime`). The
runtime is independent of Orval and the Node.js tooling.

## How generation works

1. The CLI loads a TypeScript config using Jiti and resolves paths relative to it.
2. `generate()` checks output ownership, reads the local OpenAPI JSON and collects
   operations by tag. It validates supported parameters and configured features.
3. Orval generates a split fetch client for each tag in a temporary directory next
   to the output. The pinned Orval version determines the TypeScript shape the
   transformation expects.
4. The renderers transform requests and produce models, query/mutation options,
   optional problem helpers and feature entry points. Export validation detects
   conflicting names, and Prettier formats the output.
5. In check mode, the staged files are compared with the existing generated client.
   In write mode, ownership is checked again before replacing the output. Preserved
   directories move into the new tree; replacement failures attempt to restore the
   previous client.

The root generated `index.ts` exports feature namespaces. Each feature has
`models.ts`, `api.ts` and `index.ts`, with `queries.ts`, `mutations.ts` and
`problems.ts` added when needed. See the
[catalog output](../examples/catalog/generated/products/) for concrete files.

## Source map

| File                                                  | Responsibility                                                           |
| ----------------------------------------------------- | ------------------------------------------------------------------------ |
| [src/index.ts](../src/index.ts)                       | Public generator API, types and `defineConfig`.                          |
| [src/config.ts](../src/config.ts)                     | Configuration, generation options and result types.                      |
| [src/cli.ts](../src/cli.ts)                           | CLI arguments, config loading and exit status.                           |
| [src/generate.ts](../src/generate.ts)                 | Orval orchestration, formatting, staging, checks and output replacement. |
| [src/openapi.ts](../src/openapi.ts)                   | Operation names, tag grouping and parameter validation.                  |
| [src/references.ts](../src/references.ts)             | Local OpenAPI reference resolution.                                      |
| [src/operation.ts](../src/operation.ts)               | Internal operation types shared by renderers.                            |
| [src/render-api.ts](../src/render-api.ts)             | Orval AST transformation, paths and request bodies.                      |
| [src/render-queries.ts](../src/render-queries.ts)     | Query keys, cancellation, mutation variables, feature rules and aliases. |
| [src/render-problems.ts](../src/render-problems.ts)   | Problem response extraction and generated error helpers.                 |
| [src/validate-exports.ts](../src/validate-exports.ts) | Export collision detection.                                              |
| [src/files.ts](../src/files.ts)                       | File traversal, ownership headers and symlink rejection.                 |
| [src/runtime.ts](../src/runtime.ts)                   | Fetch configuration, serialization, responses and `ApiError`.            |

## Tests and examples

| Location                                                                    | Purpose                                                           |
| --------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| [test/fixtures.ts](../test/fixtures.ts)                                     | OpenAPI inputs used by tests.                                     |
| [test/generate.test.ts](../test/generate.test.ts)                           | Generator integration tests, validation and output safety.        |
| [test/runtime.test.ts](../test/runtime.test.ts)                             | Fetch serialization, response handling and errors.                |
| [test/package-smoke.ts](../test/package-smoke.ts)                           | Packed package installed and checked in an independent project.   |
| [test/client-parity.ts](../test/client-parity.ts)                           | Compare an application's existing client with fresh output.       |
| [test/maximus-parity.ts](../test/maximus-parity.ts)                         | Parity check for the Maximus integration.                         |
| [examples/catalog/](../examples/catalog/README.md)                          | Self-contained generation example and handwritten Lit component.  |
| [examples/advanced.config.ts](../examples/advanced.config.ts)               | Application-specific feature rules and aliases.                   |
| [examples/maximus-trading.config.ts](../examples/maximus-trading.config.ts) | Maximus configuration with admin auth and a preserved RPC client. |

[All documentation](README.md)
