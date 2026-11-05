# Migration

- [From lit-canon-api 1.x to 2.0](#from-lit-canon-api-1x-to-20)
- [From lit-query-codegen 0.x to lit-canon-api 1.0](#from-lit-query-codegen-0x-to-lit-canon-api-10)

## From lit-canon-api 1.x to 2.0

2.0 gives every operation one input object, moves query keys into one `keys` factory
per resource and groups the configuration options. Upgrade `lit-canon-api` and
`lit-canon-fetch` together, update the config, regenerate, then let TypeScript point
to the call sites.

| 1.x                                              | 2.0                                                                            |
| ------------------------------------------------ | ------------------------------------------------------------------------------ |
| `getProduct("p-1")`                              | `getProduct({ productId: "p-1" })`                                             |
| `listProducts({ limit: 20 })`                    | unchanged: query parameters are fields of the input                            |
| `updateProduct("p-1", input, { "If-Match": e })` | `updateProduct({ productId: "p-1", body: input, headers: { "If-Match": e } })` |
| `mutate({ productId, request })`                 | `mutate({ productId, body })`                                                  |
| `mutate({ itemId, params: { force: true } })`    | `mutate({ itemId, force: true })`                                              |
| `UpdateProductVariables`                         | `UpdateProductInput`                                                           |
| `products.productsKeys.all`                      | `products.keys.all`                                                            |
| `products.productsKeys.getProduct("p-1")`        | `products.keys.getProduct({ productId: "p-1" })`                               |
| `products.ApiError`, `products.ApiProblem`       | `import { ApiError } from "lit-canon-fetch"`                                   |
| `credentials` default `"include"`                | `"same-origin"`                                                                |

### 1. Update the config

Renamed options fail with their replacement, for example
`"excludeTags" was replaced by "tags.exclude" in lit-canon-api 2.0`.

| 1.x                                              | 2.0                                      |
| ------------------------------------------------ | ---------------------------------------- |
| `excludeTags: ["system"]`                        | `tags: { exclude: ["system"] }`          |
| `defaultTag: "general"`                          | `tags: { fallback: "general" }`          |
| `mutationOperations: ["start_login"]`            | `operations: { startLogin: "mutation" }` |
| `preserveDirectories: ["rpc"]`                   | `preserve: ["rpc"]`                      |
| `request: { path: "./src/api/request.ts", ... }` | `runtime: "./src/api/request.ts"`        |
| `problems` unset                                 | unchanged, or `problems: "auto"`         |

`operations` takes the generated camelCase function name, not the OpenAPI operation
ID. It also works the other way round: `{ searchProducts: "query" }` turns a
read-only POST into a query.

`request.exports` and `request.typeExports` are gone because resources no longer
re-export runtime symbols. A custom runtime now exports
`apiFetch(request, options)`, where `request` is
`{ method, path, query?, headers?, body?, contentType? }`; see the
[runtime guide](runtime.md#custom-request-module).

`defineConfig` is no longer generic, so TypeScript reports misspelled options.

### 2. Regenerate and update call sites

Run `lit-canon-api generate`, then your typecheck. Every operation now takes one
object:

- path parameters are fields under their camelCase name (`productId`);
- query parameters are fields under their own name (`limit`);
- the request body is `body`;
- header parameters are `headers`.

The same object is the argument of the API function, of its query options and of
`mutate`. Request options such as per-call headers or `signal` stay the last argument.

```ts
// 1.x
products.getProductQuery(id);
update.mutate({ productId: id, request: { name, price } });

// 2.0
products.getProductQuery({ productId: id });
update.mutate({ productId: id, body: { name, price } });
```

### 3. Update keys

Each resource exports `keys`:

```ts
products.keys.all; // ["products"]
products.keys.listProducts(); // ["products", "listProducts"]: every list query
products.keys.listProducts({ limit: 20 }); // ["products", "listProducts", { limit: 20 }]
products.keys.createProduct(); // ["products", "createProduct"]: the mutation key
```

Query keys changed: the input object replaces the positional values, and a key
called without input is the prefix of every query of that operation instead of
ending in `null`. Persisted caches from 1.x do not match the new keys.

### 4. Check credentials

`lit-canon-fetch` now sends cookies only to the same origin, like `fetch`. If your
API runs on another origin and uses cookie sessions, configure it explicitly:

```ts
configureApiFetch({ baseUrl: "https://api.example.com", credentials: "include" });
```

## From lit-query-codegen 0.x to lit-canon-api 1.0

The steps below describe the 1.0 shapes. When upgrading from 0.x straight to 2.0,
apply them, then the [2.0 changes](#from-lit-canon-api-1x-to-20).

`lit-canon-api` 1.0 is the successor of `lit-query-codegen` 0.x. The generator and
the browser runtime are now two packages:

| Before (0.x)                       | Now (1.0)                                   |
| ---------------------------------- | ------------------------------------------- |
| `lit-query-codegen` (generator)    | `lit-canon-api` (dev dependency)            |
| `lit-query-codegen/runtime`        | `lit-canon-fetch` (application dependency)  |
| `lit-query-codegen.config.ts`      | `lit-canon-api.config.ts`                   |
| `lit-query-codegen`                | `lit-canon-api generate`                    |
| `lit-query-codegen --check`        | `lit-canon-api check`                       |
| "feature" (one OpenAPI tag)        | "resource" (one OpenAPI tag)                |
| `features`, `queryAliases` options | removed; see [below](#removed-options)      |
| Mutation variables: value or tuple | always one object named after the inputs    |
| `null` query values sent as "null" | `null` and `undefined` query values omitted |

Work through the steps in order, then run `lit-canon-api check` and your typecheck.
TypeScript points to every call site that still uses the old shapes.

### 1. Replace the packages

```bash
pnpm remove lit-query-codegen
pnpm add lit-canon-fetch
pnpm add -D lit-canon-api
```

`lit-canon-fetch` is imported by generated code, so it is a normal dependency.
`lit-canon-api` is only needed to generate and check the client. With pnpm, allow
the esbuild install script that Orval needs; see
[getting started](getting-started.md#installation).

Update handwritten imports of the runtime:

```ts
// Before
import { ApiError, configureApiFetch } from "lit-query-codegen/runtime";
// After
import { ApiError, configureApiFetch } from "lit-canon-fetch";
```

The exports are the same: `apiFetch`, `configureApiFetch`, `createApiFetch`,
`ApiError`, `ApiProblem`, `ApiRequestOptions` and `ApiFetchConfig`.

### 2. Rename the config and the scripts

Rename `lit-query-codegen.config.ts` to `lit-canon-api.config.ts` and import
`defineConfig` from `lit-canon-api`. Then update the scripts:

```json
{
  "scripts": {
    "api:generate": "lit-canon-api generate",
    "api:check": "lit-canon-api check"
  }
}
```

The command is now required. Running `lit-canon-api` without `generate` or `check`
prints the usage and exits with code 1. `--config` still works with both commands.

### 3. Regenerate

Run `pnpm api:generate`. The generator recognizes output written by 0.x (its files
start with "Generated by orval"), so it replaces the directory without manual
cleanup. New files start with:

```text
Generated by lit-canon-api. Do not edit manually.
```

Commit the regenerated client together with the call-site changes below.

### Removed options

Both options now fail with an error instead of being ignored:

```text
"features" was removed in lit-canon-api 1.0. See docs/migration.md.
```

They put application code, as strings, into generated files. 1.0 keeps generated
files free of application code and moves those decisions to the runtime or the call
site.

#### `features.<tag>.requestOptions` and `imports`

Use a header function in `configureApiFetch`. It runs before every request, may be
async, and receives the request path and method:

```ts
import { configureApiFetch } from "lit-canon-fetch";
import { authHeaders } from "./auth";

configureApiFetch({
  headers: async ({ url }): Promise<HeadersInit> =>
    url.startsWith("/admin") ? await authHeaders() : {},
});
```

Per-request options still work when calling an API function directly:
`products.getProduct("p-1", { headers })`.

#### `features.<tag>.enabled`

Set `enabled` where the query is used:

```ts
createQueryController(this, () => ({
  ...products.listProductsQuery(),
  enabled: hasSession(),
}));
```

#### `features.<tag>.queryKey`

Generated keys no longer include extra scope values. If you scoped keys by session
or user, clear the cache when the session changes instead, for example with
`client.clear()` on logout. This drops every cached response of the previous user.

#### `queryAliases`

Each resource now exports a key factory, `<resource>Keys`, and the query factories
directly:

| Before                                 | After                                |
| -------------------------------------- | ------------------------------------ |
| `products.productQueries.list(params)` | `products.listProductsQuery(params)` |
| `products.productQueries.detail(id)`   | `products.getProductQuery(id)`       |
| `products.productQueries.allKey`       | `products.productsKeys.all`          |

The key factory name is the camelCase tag plus `Keys`, so the tag `user-settings`
produces `userSettingsKeys`. Query keys keep their old values:
`[tag, operation, ...inputs]`, with `null` for omitted optional inputs.

### Mutation variables

Mutations now always take one object. Its properties use the parameter names of the
generated API function: path parameters by name, `params` for query parameters and
`request` for the request body.

```ts
// Before
create.mutate({ name: "Notebook", price: 12.5 });
update.mutate(["p-1", { name: "Large notebook", price: 15 }]);

// After
create.mutate({ request: { name: "Notebook", price: 12.5 } });
update.mutate({ productId: "p-1", request: { name: "Large notebook", price: 15 } });
```

Mutations without inputs are unchanged: `mutate()`. Update `onSuccess` and other
callbacks that read `variables` in the same way.

### Query parameters set to `null`

0.x sent `null` query values as the string `"null"`. `lit-canon-fetch` omits `null`
and `undefined`, including inside arrays. If your API relied on receiving `"null"`,
pass the string explicitly.

### Wording

Documentation, errors and the CLI output say "resource" where 0.x said "feature".
A resource is the code generated for one OpenAPI tag. In lit-canon apps,
"feature" refers to a `defineFeature(...)` slice from `lit-canon-composition`.

[All documentation](README.md)
