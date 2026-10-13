# Getting started

This guide takes you from installation to using a generated client in a Lit component.
For a working reference, open the [catalog example](../examples/catalog/README.md).

## Installation

Requires **Node.js 22.18.0 or later**. Orval, TypeScript and Prettier are included
as package dependencies. Your application also needs `@tanstack/lit-query` and its
runtime dependencies. The example is checked against `@tanstack/lit-query@0.2.25`.
Generated imports target a TypeScript frontend build with bundler module resolution,
such as a Lit app built with Vite.

To install a local package before it is published to a registry:

```bash
# In the package directory
npm ci
npm pack

# In your application; adjust the path to the generated tarball
npm install /path/to/lit-query-codegen-0.1.0.tgz
npm install @tanstack/lit-query@0.2.25 @tanstack/query-core@5.104.0 lit
```

For local development, run `npm ci` and `npm run build` in the package directory,
then install it in your application with `npm install /path/to/lit-query-codegen`.
The default client imports `lit-query-codegen/runtime`, so keep the package as an
application dependency. If you use your own fetch mutator, the generator can be
installed with `--save-dev`.

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

`api:generate` writes the client. `api:check` checks for drift without replacing
existing files. Keep handwritten code outside the dedicated generated directory.
See [configuration](configuration.md#run-the-generator) for output ownership and
preserving directories owned by another generator.

## What does the generated code look like?

The checked-in [product catalog specification](../examples/catalog/openapi.json) contains:

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

**[models.ts](../examples/catalog/generated/products/models.ts)** — types derived from the schema:

```ts
export interface Product {
  id: string;
  name: string;
  /** @minimum 0 */
  price: number;
}
```

**[api.ts](../examples/catalog/generated/products/api.ts)** — a normal typed function you can call directly:

```ts
export const listProducts = (
  params?: ListProductsParams,
  options?: ApiRequestOptions,
): Promise<Product[]> =>
  apiFetch<Product[]>("/products", { ...options, method: "GET", query: params });
```

**[queries.ts](../examples/catalog/generated/products/queries.ts)** — the request wired to TanStack Query:

```ts
export const listProductsQuery = (params?: Parameters<typeof listProducts>[0]) =>
  queryOptions({
    queryKey: ["products", "listProducts", params ?? null] as const,
    queryFn: ({ signal }) => listProducts(params, { signal }),
  });
```

**[mutations.ts](../examples/catalog/generated/products/mutations.ts)** — typed inputs for writes:

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

The complete [catalog component](../examples/catalog/catalog-element.ts) also creates
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

[`examples/catalog/`](../examples/catalog/README.md) contains the OpenAPI input, config,
generated output and a handwritten Lit component. `example:generate` rebuilds the
generator and updates that output. `example:check` verifies it without modifying
files; CI runs the same check. The component requires a matching API and a Lit app
to make real requests; this example does not include an API server or dev server.

## Where to go next

- [Configuration](configuration.md) for feature rules, aliases and generation behavior.
- [Runtime](runtime.md) for request defaults, errors and custom fetch mutators.
- [OpenAPI requirements](openapi.md) if generation rejects your specification.

[All documentation](README.md)
