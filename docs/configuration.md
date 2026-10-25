# Configuration and CLI

Start with `input` and `output`, then add only the options your application needs.
The configuration types are defined in
[packages/api/src/config.ts](../packages/api/src/config.ts).

## Configuration options

| Option                | Purpose / default                                                        |
| --------------------- | ------------------------------------------------------------------------ |
| `input`               | Required local OpenAPI 3 JSON file.                                      |
| `output`              | Required directory owned by the generator.                               |
| `workspace`           | Workspace passed to Orval; defaults to the config directory.             |
| `request`             | Custom request module and its re-exports; defaults to `lit-canon-fetch`. |
| `excludeTags`         | Tags to leave out.                                                       |
| `mutationOperations`  | Operation IDs or function names to treat as mutations.                   |
| `problems`            | By default, emit problem types for resources with problem responses.     |
| `preserveDirectories` | Top-level output directories owned by another generator.                 |
| `prettier`            | Overrides for the detected project Prettier configuration.               |

The options `features` and `queryAliases` were removed in 1.0. A config that still
sets them fails with an error pointing to the [migration guide](migration.md).

## Run the generator

Create `lit-canon-api.config.ts` in your application:

```ts
import { defineConfig } from "lit-canon-api";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
```

All paths are resolved relative to the config file. The API generator commands are:

```bash
lit-canon-api generate                          # write the client
lit-canon-api check                             # compare without writing
lit-canon-api generate --config api.config.ts   # use another config file
lit-canon-api --help
```

| Command    | Effect                                                                                | Exit code                             |
| ---------- | ------------------------------------------------------------------------------------- | ------------------------------------- |
| `generate` | Generates in a temporary directory, then replaces the output directory.               | 1 on any error                        |
| `check`    | Generates in a temporary directory and compares it with the output. Changes no files. | 1 for missing, changed or extra files |

`lit-canon-api add-page` is a separate one-time application scaffold. It reads an
already generated client, requires explicit query selection and route bindings,
and creates editable files outside API output. See
[prefetching and scaffolding](prefetching.md) for its flags and ownership rules.

Without a command, or with an unknown one, the CLI prints its usage and exits with
code 1. `-c` is short for `--config`; the default is `lit-canon-api.config.ts` in
the current directory.

The output directory is replaced only after generation and transformation succeed.
Use a dedicated generated directory: files without a generator header and symbolic
links prevent replacement. Resources and query or mutation files that are no longer
needed are removed during the next run.

If another generator shares the output directory, preserve its top-level
directories with `preserveDirectories: ["rpc"]`. These trees are excluded from
`check` and moved intact during `generate`, including binary files and empty
directories. They cannot overlap generated resources or contain symbolic links.
Unlisted files still need a generator header.

## Project-specific options

- `excludeTags`: omit tags such as `system`.
- `mutationOperations`: treat GET operations as mutations, for example an OAuth
  start or callback. Accepts OpenAPI operation IDs or generated function names.
- `problems`: emit operation and resource problem types from
  `application/problem+json` responses. By default, only resources with problem
  responses get a `problems.ts` file. Set `true` to also generate `never` problem
  types for resources without them, or `false` to omit the helpers.
- `preserveDirectories`: keep top-level output directories owned by another
  generator, such as an RPC client.

Problem helpers support named local schema references, `oneOf` and `anyOf`,
including locally referenced responses. For the `products` tag they export types
such as `GetProductProblem`, `ProductsProblem` and `ProductsProblemCode`, and the
guard `isProductsError`. Code types also work when some problem schemas omit
`code`. Inline problem schemas require `problems: false` or extraction into
`components.schemas`. A custom request module must export a generic `ApiError<P>`
when these helpers are enabled. The guard identifies `ApiError` instances; it does
not validate payloads or tell errors of different resources apart.

[examples/advanced.config.ts](../examples/advanced.config.ts) shows these options
together.

## Headers, enablement and cache scope

The config describes how to generate code, not how the application behaves at
runtime. Decisions that depend on the session or the page are made in code:

| Need                                    | Where                                                                    |
| --------------------------------------- | ------------------------------------------------------------------------ |
| Auth or other headers for every request | A headers function in [`configureApiFetch`](runtime.md#dynamic-headers). |
| Headers for one direct call             | The last argument: `products.getProduct("p-1", { headers })`.            |
| Run a query only when ready             | `enabled` at the call site, spread next to the generated options.        |
| Invalidate a whole resource             | `<resource>Keys.all`, for example `products.productsKeys.all`.           |
| Separate cached data per user           | Clear the query cache when the session changes.                          |

## Programmatic API

```ts
import { generate } from "lit-canon-api";

await generate(
  { input: "openapi.json", output: "src/api/generated" },
  { cwd: process.cwd(), check: false },
);
```

For programmatic calls, paths resolve against `options.cwd`, which defaults to
`process.cwd()`. The CLI passes the directory containing the config file.
`generate()` returns the absolute output path, the resource tags and the generated
file names.

For custom request modules, see the [runtime guide](runtime.md#custom-request-module).

[All documentation](README.md)
