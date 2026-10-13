# lit-query-codegen

**Turn an OpenAPI specification into typed API calls and ready-to-use TanStack Lit Query options.**

[![TypeScript](https://img.shields.io/badge/TypeScript-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![OpenAPI 3](https://img.shields.io/badge/OpenAPI-3-6BA539?logo=openapiinitiative&logoColor=white)](#openapi-requirements)
[![Lit Query](https://img.shields.io/badge/TanStack-Lit_Query-00ADD8)](https://tanstack.com/query/latest/docs/framework/lit/overview)
[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D22.18.0-5FA04E?logo=nodedotjs&logoColor=white)](#installation)

Building a [Lit](https://lit.dev/) frontend for a REST API? This tool reads the backend's
OpenAPI JSON and generates TypeScript models, fetch functions, query keys and
query/mutation option factories, grouped by API feature. You import them into your
components instead of writing and maintaining that API glue for every endpoint.

```ts
import { products } from "./api/generated";

// A typed API call: Promise<Product[]>
const catalog = await products.listProducts({ limit: 20 });

// Options to pass to a Lit Query controller or QueryClient:
const query = products.listProductsQuery({ limit: 20 });
const mutation = products.createProductMutation();
```

**[See the generated code](examples/catalog/generated/products/)** ·
**[See a Lit component using it](examples/catalog/catalog-element.ts)** ·
**[Try the example](#try-the-checked-in-example)**

## Why use it?

For each endpoint, a frontend usually needs a request function, parameter and response
types, a cache key and a query or mutation definition. When the API changes, those
pieces need to stay in sync. `lit-query-codegen` derives them from the same contract.

| What you would maintain by hand                           | What the generator produces                                                          |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| Request and response interfaces                           | TypeScript models from the OpenAPI schemas                                           |
| URLs, path encoding, query parameters and request bodies  | Typed fetch functions using a shared request runtime                                 |
| Query keys and functions for each read operation          | `...Query()` factories with operation inputs in the key and `AbortSignal` forwarding |
| Mutation functions and input types for writes             | `...Mutation()` factories, including typed tuples for multiple inputs                |
| Checking whether committed clients match the API contract | A `--check` command for local development and CI                                     |

Use it when your application uses **Lit + TanStack Query**, your backend exports
**OpenAPI 3 JSON**, and you want to keep generated clients in your repository.
For example, a product dashboard can regenerate its client after a backend change;
TypeScript then flags frontend calls that no longer match the generated types.

```text
Backend OpenAPI JSON
        |
        v  lit-query-codegen (Orval + TypeScript transformation)
TypeScript models + fetch functions + query/mutation options
        |
        v  Your Lit components + TanStack Query
UI, loading/error states, caching and refetching
```

[TanStack Lit Query](https://tanstack.com/query/latest/docs/framework/lit/overview)
provides caching and reactive controllers. This package generates the options you
pass to those controllers. You still write your UI and decide when to invalidate
cached data after a mutation. It does not generate a backend, components or runtime
response validation. If you only need fetch functions, you can import `api.ts`
directly; the query options specifically target the Lit adapter.

## What does the generated code look like?

The checked-in [product catalog specification](examples/catalog/openapi.json) contains:

| OpenAPI operation                              | Generated request                       | Generated options                  |
| ---------------------------------------------- | --------------------------------------- | ---------------------------------- |
| `GET /products?limit=20` · `list_products`     | `listProducts({ limit: 20 })`           | `listProductsQuery({ limit: 20 })` |
| `GET /products/{productId}` · `get_product`    | `getProduct("p-1")`                     | `getProductQuery("p-1")`           |
| `POST /products` · `create_product`            | `createProduct({ name, price })`        | `createProductMutation()`          |
| `PUT /products/{productId}` · `update_product` | `updateProduct("p-1", { name, price })` | `updateProductMutation()`          |

All four operations have the OpenAPI tag `products`. Tags become feature directories;
`snake_case` operation IDs become `camelCase` function names. GET operations become
queries by default; other HTTP methods become mutations.

```text
generated/
  index.ts                   # exports the products namespace
  products/
    models.ts                # Product, ProductInput, ListProductsParams
    api.ts                   # typed fetch functions
    queries.ts               # query keys + query functions
    mutations.ts             # mutation keys + mutation functions
    index.ts                 # feature exports + runtime error types
```

These are actual excerpts from the committed output; headers and unrelated
declarations are omitted here. The linked files contain the complete generated code.

**[models.ts](examples/catalog/generated/products/models.ts)** — types derived from the schema:

```ts
export interface Product {
  id: string;
  name: string;
  /** @minimum 0 */
  price: number;
}
```

**[api.ts](examples/catalog/generated/products/api.ts)** — a normal typed function you can call directly:

```ts
export const listProducts = (
  params?: ListProductsParams,
  options?: ApiRequestOptions,
): Promise<Product[]> =>
  apiFetch<Product[]>("/products", { ...options, method: "GET", query: params });
```

**[queries.ts](examples/catalog/generated/products/queries.ts)** — the request wired to TanStack Query:

```ts
export const listProductsQuery = (params?: Parameters<typeof listProducts>[0]) =>
  queryOptions({
    queryKey: ["products", "listProducts", params ?? null] as const,
    queryFn: ({ signal }) => listProducts(params, { signal }),
  });
```

**[mutations.ts](examples/catalog/generated/products/mutations.ts)** — typed inputs for writes:

```ts
export const createProductMutation = () =>
  mutationOptions({
    mutationKey: ["products", "createProduct"] as const,
    mutationFn: (variables: Parameters<typeof createProduct>[0]) => createProduct(variables),
  });
```

Operations with multiple inputs use one typed tuple of variables. For example,
`updateProductMutation()` expects `[productId, { name, price }]` when you call
the mutation controller's `mutate` method.

## Use it in a Lit component

Create a shared `QueryClient` and pass the generated options to a controller:

```ts
import { LitElement, html } from "lit";
import { QueryClient, createQueryController } from "@tanstack/lit-query";
import { products } from "./api/generated";

const queryClient = new QueryClient();

class ProductList extends LitElement {
  private readonly catalog = createQueryController(
    this,
    () => ({ ...products.listProductsQuery({ limit: 20 }), staleTime: 60_000 }),
    queryClient,
  );

  override render() {
    const query = this.catalog();
    if (query.isPending) return html`<p>Loading products…</p>`;
    if (query.isError) return html`<p>${query.error.message}</p>`;

    return html`<ul>
      ${query.data.map((product) => html`<li>${product.name}</li>`)}
    </ul>`;
  }
}

customElements.define("product-list", ProductList);
```

Add `<product-list></product-list>` to your page after importing the component.
The data is inferred as `Product[]`; you can add options such as `staleTime`
without changing the generated files. A `QueryClientProvider` can supply the client
through Lit context instead of passing it explicitly.

The complete [catalog component](examples/catalog/catalog-element.ts) also creates
products with `createMutationController` and invalidates the `products` queries
after a successful write.

## Try the checked-in example

No backend is needed to generate or inspect the client. From this repository:

```bash
npm ci
npm run example:generate
npm run example:check
npm run typecheck
```

[`examples/catalog/`](examples/catalog/README.md) contains the OpenAPI input, config,
generated output and a handwritten Lit component. `example:generate` rebuilds the
generator and updates that output. `example:check` verifies it without modifying
files; CI runs the same check. The component requires a matching API and a Lit app
to make real requests; this example does not include an API server or dev server.

## Installation

Requires **Node.js 22.18.0 or later**. Orval, TypeScript and Prettier are included
as package dependencies. Your application also needs `@tanstack/lit-query` and its
runtime dependencies. The example is checked against `@tanstack/lit-query@0.2.25`.
Generated imports target a TypeScript frontend build with bundler module resolution,
such as a Lit app built with Vite.

To install a local package before it is published to a registry:

```bash
# In the package directory
npm install
npm pack

# In your application; adjust the path to the generated tarball
npm install /path/to/lit-query-codegen-0.1.0.tgz
npm install @tanstack/lit-query@0.2.25 @tanstack/query-core@5.104.0 lit
```

For local development, you can install directly from the package directory with
`npm install /path/to/lit-query-codegen`. If you use your own fetch mutator instead
of `lit-query-codegen/runtime`, the generator can be installed with `--save-dev`.

## Configuration and CLI

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

## Fetch runtime

Generated clients use `lit-query-codegen/runtime` by default. This module has no
Orval, Node.js or Vite dependencies.

```ts
import { configureApiFetch } from "lit-query-codegen/runtime";

configureApiFetch({ baseUrl: "https://api.example.com" });
```

Without configuration, requests use relative API paths and send cookies with
`credentials: "include"`. You can configure default `headers`, `credentials` and
a custom `fetch` implementation. `createApiFetch(config)` creates an independent
fetch mutator for separate API clients or server-side use.

The mutator serializes plain objects, arrays and `null` as JSON. `FormData` and
other native request bodies are passed through. Query arrays use repeated
parameters; `undefined` values are omitted and `null` is sent as the string
`"null"`. Successful responses return the body, or `undefined` for an empty
response. HTTP failures throw `ApiError` with a `status` and optional RFC 9457
problem details.

To use an existing fetch mutator, configure its path:

```ts
import { defineConfig } from "lit-query-codegen";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
  request: {
    path: "./src/api/request.ts",
    exports: ["ApiError"],
    typeExports: ["ApiProblem", "ApiRequestOptions"],
  },
});
```

The module must export `apiFetch<T>(url, options): Promise<T>` and
`ApiRequestOptions`. The options contain an unserialized `body`, a `query` object
and fetch options. Feature entry points also export `ApiError`, `ApiProblem` and
`ApiRequestOptions` by default. Adjust `exports` and `typeExports`, or set them to
`[]`, if your mutator exposes different symbols.

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

[`examples/maximus-trading.config.ts`](examples/maximus-trading.config.ts) shows the
established Maximus setup: admin headers and cache scope, OAuth GET mutations,
query aliases, problem types and a preserved RPC client. To verify it against an
existing checkout without writing to it:

```bash
npm run build
node test/maximus-parity.ts /path/to/maximus-trading/frontend
```

[examples/advanced.config.ts](examples/advanced.config.ts) shows these options for
a product catalog with session-dependent requests and login operations. Adapt the
tags, operation IDs and helper imports to your API. The example expects a
`products` tag with `list_products` and `get_product` operations, plus
`start_login` and `complete_login` operations. Its `auth.ts` module supplies
`authHeaders`, `authScope` and `hasSession`.

Once configured, `"api:generate": "lit-query-codegen"` replaces separate Orval
configuration and transformation scripts. Exporting the OpenAPI specification
and checking it against the backend remain tasks for your project.

## Programmatic API

```ts
import { generate } from "lit-query-codegen";

await generate(
  { input: "openapi.json", output: "src/api/generated" },
  { cwd: process.cwd(), check: false },
);
```

## OpenAPI requirements

Each included operation must have exactly one tag in the format
`lower-case-with-hyphens` and a unique, explicit `operationId` in `snake_case` or
`camelCase`. Local parameter references are supported. Bundle path-item references
before generation.

The transformation targets JSON and multipart fetch requests, scalar path parameters
with `simple` serialization and query parameters with `form`/`explode: true`
serialization. Path identifiers such as `item_id`, `scope.id` and `class` use
Orval's TypeScript naming rules. Header and cookie parameters, object parameters
and other serialization styles are rejected rather than silently producing a
different request. Authentication headers can be supplied through feature
`requestOptions`.

Query factories always forward TanStack's `AbortSignal`, including when feature
request options contain their own signal. Generated export and alias collisions
fail before the existing client is replaced; alias members `allKey` and `__proto__`
are reserved.

Generated TypeScript types describe the API contract; the runtime does not validate
response bodies against the schema.

## Development

```bash
npm install
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
