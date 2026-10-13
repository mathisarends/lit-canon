# Configuration and CLI

Start with `input` and `output`, then add only the rules your application needs.
The public configuration types are defined in [src/config.ts](../src/config.ts).

## Configuration options

| Option                | Purpose / default                                                         |
| --------------------- | ------------------------------------------------------------------------- |
| `input`               | Required local OpenAPI 3 JSON file.                                       |
| `output`              | Required directory owned by the generator.                                |
| `workspace`           | Workspace passed to Orval; defaults to the config directory.              |
| `request`             | Custom fetch mutator and its re-exports; defaults to the bundled runtime. |
| `excludeTags`         | Tags to leave out.                                                        |
| `preserveDirectories` | Top-level output directories owned by another generator.                  |
| `problems`            | By default, emit helpers for features with problem responses.             |
| `mutationOperations`  | Operation IDs or function names to treat as mutations.                    |
| `features`            | Imports, request options, cache scope and query enablement per tag.       |
| `queryAliases`        | Named groups of query factories per tag.                                  |
| `prettier`            | Overrides for the detected project Prettier configuration.                |

## Run the generator

Create `lit-query-codegen.config.ts` in your application:

```ts
import { defineConfig } from "lit-query-codegen";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
```

All file paths are resolved relative to the configuration file. Formatting follows
your project's Prettier configuration. Override individual options with, for
example, `prettier: { printWidth: 100 }`.

Add generation and drift-check commands to your `package.json`:

```json
{
  "scripts": {
    "api:generate": "lit-query-codegen",
    "api:check": "lit-query-codegen --check"
  }
}
```

```bash
npm run api:generate
npm run api:check
npx lit-query-codegen --config other.config.ts
```

`--check` generates a temporary client and reports missing, changed or obsolete
files with exit code 1. It leaves the existing client untouched.

Normal generation also uses a temporary directory. The output directory is
replaced only after generation and transformation succeed. Use a dedicated
generated directory: files without a generator header and symbolic links prevent
replacement. Features and query or mutation files that are no longer needed are
removed during the next generation run.

If another generator shares the output directory, explicitly preserve its top-level
directories with `preserveDirectories: ["rpc"]`. These trees are excluded from
drift checks and moved intact when replacing the REST client, including binary files
and empty directories. They cannot overlap generated features or contain symbolic
links. Unlisted files still need a generator header.

## Project-specific rules

- `excludeTags`: omit tags such as `system`.
- `mutationOperations`: treat GET operations as mutations, for example an OAuth
  start or callback. Accepts OpenAPI operation IDs or generated function names.
- `features`: add imports, request options, query-key values and an `enabled`
  expression for each feature. Expressions are TypeScript code from your config.
- `queryAliases`: group related queries under an object with an `allKey` property.
- `problems`: emit operation and feature problem types from
  `application/problem+json` responses. By default, only features with problem
  responses get a `problems.ts` file. Set `true` to also generate `never` problem
  types for features without them, or `false` to omit the helpers.
- `preserveDirectories`: retain top-level output directories owned by another
  generator, such as an RPC client.

Problem helpers support named local schema references, `oneOf` and `anyOf`,
including locally referenced responses. They export types such as
`GetProductProblem`, `ProductsProblem`, `ProductsProblemCode` and `isProductsError`.
Code types also work when some problem schemas omit `code`. Inline problem schemas
require `problems: false` or extraction into `components.schemas`. A custom request
module must export a generic `ApiError<P>` when these helpers are enabled.
The error helper identifies `ApiError` instances for use at that feature's call
sites; it does not validate payloads or distinguish errors from other features.

[`examples/maximus-trading.config.ts`](../examples/maximus-trading.config.ts) shows the
established Maximus setup: admin headers and cache scope, OAuth GET mutations,
query aliases, problem types and a preserved RPC client. To verify it against an
existing checkout without writing to it:

```bash
npm run build
node test/maximus-parity.ts /path/to/maximus-trading/frontend
```

[examples/advanced.config.ts](../examples/advanced.config.ts) shows these options for
a product catalog with session-dependent requests and login operations. Adapt the
tags, operation IDs and helper imports to your API. The example expects a
`products` tag with `list_products` and `get_product` operations, plus
`start_login` and `complete_login` operations. Its `auth.ts` module supplies
`authHeaders`, `authScope` and `hasSession`.

Once configured, `"api:generate": "lit-query-codegen"` replaces separate Orval
configuration and transformation scripts. Exporting the OpenAPI specification
and checking it against the backend remain tasks for your project.

## Feature rules and query aliases

The following configuration assumes the `products` tag has `list_products` and
`get_product` operations, and your application supplies the imported auth helpers:

```ts
import { defineConfig } from "lit-query-codegen";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
  features: {
    products: {
      imports: [
        {
          from: "./src/api/auth.ts",
          names: ["authHeaders", "authScope", "hasSession"],
        },
      ],
      requestOptions: "{ headers: authHeaders() }",
      queryKey: ["authScope()"],
      enabled: "hasSession()",
    },
  },
  queryAliases: {
    products: {
      productQueries: {
        list: "list_products",
        detail: "get_product",
      },
    },
  },
});
```

The expression strings are inserted as TypeScript into the generated options.
Imports may be relative files
or bare module specifiers. Request options apply to query and mutation factories;
`queryKey` and `enabled` apply to queries. Direct API calls accept request options
as their final argument.

This creates `products.productQueries.list(...)`,
`products.productQueries.detail(...)` and `products.productQueries.allKey`.
The `allKey` value is `["products"]`, so it can invalidate all queries in that
feature. Alias members must refer to generated queries; `allKey` and `__proto__`
are reserved.

## Programmatic API

```ts
import { generate } from "lit-query-codegen";

await generate(
  { input: "openapi.json", output: "src/api/generated" },
  { cwd: process.cwd(), check: false },
);
```

For programmatic calls, paths resolve against `options.cwd`, which defaults to
`process.cwd()`. The CLI supplies the directory containing the config file.
`generate()` returns the absolute output path, feature tags and generated file names.

For custom request modules, see the [runtime guide](runtime.md).

[All documentation](README.md)
