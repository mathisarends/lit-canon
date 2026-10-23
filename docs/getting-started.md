# Getting started

This guide takes you from installation to using a generated client in a Lit component.
For a working reference, open the [catalog example](../examples/catalog/README.md).

## Installation

Requires **Node.js 22.18.0 or later**. Generated code targets a TypeScript frontend
with bundler module resolution, such as a Lit app built with Vite.

```bash
pnpm add lit-canon-fetch @tanstack/lit-query lit
pnpm add -D lit-canon-api
```

- `lit-canon-fetch` is the browser runtime imported by the generated code. It has no
  dependencies.
- `lit-canon-api` is the generator. It brings Orval, TypeScript and Prettier and is
  only needed at development time.
- The examples are checked against `@tanstack/lit-query@0.2.25`.

Orval depends on esbuild, which needs its install script. pnpm only runs approved
install scripts, so allow it in `pnpm-workspace.yaml`:

```yaml
allowBuilds:
  esbuild: true
```

Without this, `pnpm add` fails with `ERR_PNPM_IGNORED_BUILDS`. npm and Yarn run the
script without extra configuration.

## Configure and generate

Create `lit-canon-api.config.ts` in your application:

```ts
import { defineConfig } from "lit-canon-api";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
```

Paths are relative to the config file. Use a dedicated output directory and keep
handwritten code outside it. Formatting follows your project's Prettier
configuration; override options with, for example, `prettier: { printWidth: 100 }`.

Add the two commands to your `package.json`:

```json
{
  "scripts": {
    "api:generate": "lit-canon-api generate",
    "api:check": "lit-canon-api check"
  }
}
```

```bash
pnpm api:generate
pnpm api:check
pnpm lit-canon-api generate --config other.config.ts
```

`generate` writes the client. `check` compares a fresh generation with the committed
client and exits with code 1 on any difference, without changing files. Run it in CI.
See [configuration](configuration.md#run-the-generator) for output ownership and
directories owned by another generator.

## What does the generated code look like?

The checked-in [product catalog specification](../examples/catalog/openapi.json) contains:

| OpenAPI operation                              | Generated request                       | Generated options                  |
| ---------------------------------------------- | --------------------------------------- | ---------------------------------- |
| `GET /products?limit=20` · `list_products`     | `listProducts({ limit: 20 })`           | `listProductsQuery({ limit: 20 })` |
| `GET /products/{productId}` · `get_product`    | `getProduct("p-1")`                     | `getProductQuery("p-1")`           |
| `POST /products` · `create_product`            | `createProduct({ name, price })`        | `createProductMutation()`          |
| `PUT /products/{productId}` · `update_product` | `updateProduct("p-1", { name, price })` | `updateProductMutation()`          |

All four operations have the OpenAPI tag `products`. Each tag becomes a resource
directory; `snake_case` operation IDs become `camelCase` function names. GET
operations become queries; other HTTP methods become mutations.

```text
generated/
  index.ts                   # exports the products namespace
  products/
    models.ts                # Product, ProductInput, ListProductsParams
    api.ts                   # typed fetch functions
    queries.ts               # productsKeys + query options
    mutations.ts             # mutation options
    index.ts                 # resource exports + runtime error types
```

These are excerpts from the committed output, without the file headers. The linked
files contain the complete generated code.

**[models.ts](../examples/catalog/generated/products/models.ts)**: types derived from the schema.

```ts
export interface Product {
  id: string;
  name: string;
  /** @minimum 0 */
  price: number;
}
```

**[api.ts](../examples/catalog/generated/products/api.ts)**: a typed function you can call directly.

```ts
export const listProducts = (
  params?: ListProductsParams,
  options?: ApiRequestOptions,
): Promise<Product[]> =>
  apiFetch<Product[]>("/products", { ...options, method: "GET", query: params });
```

**[queries.ts](../examples/catalog/generated/products/queries.ts)**: a key factory and query options.

```ts
export const productsKeys = {
  all: ["products"] as const,
  listProducts: (params?: Parameters<typeof listProducts>[0]) =>
    ["products", "listProducts", params ?? null] as const,
  getProduct: (productId: Parameters<typeof getProduct>[0]) =>
    ["products", "getProduct", productId] as const,
};

export const listProductsQuery = (params?: Parameters<typeof listProducts>[0]) =>
  queryOptions({
    queryKey: productsKeys.listProducts(params),
    queryFn: ({ signal }) => listProducts(params, { signal }),
  });
```

**[mutations.ts](../examples/catalog/generated/products/mutations.ts)**: mutation
options that take one object.

```ts
export const updateProductMutation = () =>
  mutationOptions({
    mutationKey: ["products", "updateProduct"] as const,
    mutationFn: (variables: {
      productId: Parameters<typeof updateProduct>[0];
      request: Parameters<typeof updateProduct>[1];
    }) => updateProduct(variables.productId, variables.request),
  });
```

The properties are named after the parameters of the API function: path parameters
by name, `params` for query parameters and `request` for the body. Call it with
`mutate({ productId: "p-1", request: { name, price } })`.

## Use it in a Lit component

Provide one `QueryClient` above your components, then create controllers without a
client argument. They find the client through `queryClientContext`:

```ts
import { LitElement, html } from "lit";
import { createMutationController, createQueryController } from "@tanstack/lit-query";
import { products } from "./api/generated";

class ProductList extends LitElement {
  private readonly catalog = createQueryController(this, () => ({
    ...products.listProductsQuery({ limit: 20 }),
    staleTime: 60_000,
  }));

  private readonly create = createMutationController(this, () => ({
    ...products.createProductMutation(),
    onSuccess: (_product, _variables, _onMutateResult, { client }) =>
      client.invalidateQueries({ queryKey: products.productsKeys.all }),
  }));

  override render() {
    const query = this.catalog();
    if (query.isPending) return html`<p>Loading products…</p>`;
    if (query.isError) return html`<p>${query.error.message}</p>`;

    return html`
      <ul>
        ${query.data.map((product) => html`<li>${product.name}</li>`)}
      </ul>
      <button @click=${() => this.create.mutate({ request: { name: "Notebook", price: 12.5 } })}>
        Add
      </button>
    `;
  }
}

customElements.define("product-list", ProductList);
```

The data is inferred as `Product[]`. Options such as `staleTime` or `enabled` are
spread next to the generated options. After a successful write, the mutation
invalidates every `products` query through `productsKeys.all`, using the client
TanStack passes to `onSuccess`.

To provide the client:

- **In a lit-canon app**, add `provide(queryClientContext, () => new QueryClient())`
  to `createApp`. See [Using the client in a lit-canon app](lit-canon.md).
- **In any other Lit app**, render the components inside a `QueryClientProvider`, as
  [catalog-app.ts](../examples/catalog/catalog-app.ts) does.

## Configure requests

By default, requests use relative paths and include cookies. Configure the runtime
once when your application starts:

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({
  baseUrl: "https://api.example.com",
  headers: async (): Promise<HeadersInit> => ({ authorization: `Bearer ${await getToken()}` }),
});
```

`getToken` stands for your own authentication code. See the [runtime guide](runtime.md)
for header functions, errors and custom request modules.

## Try the checked-in example

No backend is needed to generate or inspect the client. From the repository root:

```bash
pnpm install
pnpm example:generate
pnpm example:check
pnpm typecheck
```

[`examples/catalog/`](../examples/catalog/README.md) contains the OpenAPI input,
config, generated output and handwritten Lit components. `example:generate` builds
the packages and updates the output; `example:check` verifies it without changing
files, as CI does. Making real requests requires a Lit app and a matching API.

## Where to go next

- [Configuration](configuration.md) for options and generation behavior.
- [Runtime](runtime.md) for request defaults, errors and custom request modules.
- [OpenAPI requirements](openapi.md) if generation rejects your specification.
- [Migration](migration.md) if you are upgrading from the 0.x generator.

[All documentation](README.md)
