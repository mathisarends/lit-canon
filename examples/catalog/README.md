# Product catalog: OpenAPI to Lit Query

This example shows what `lit-canon-api` takes as input, what it writes, and how a
Lit component uses the generated code. The generated files are committed so you can
inspect them on GitHub without installing or running anything.

| File                                                               | Role                                                                    |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| [openapi.json](openapi.json)                                       | Handwritten input: list, get, create and update product endpoints       |
| [lit-canon-api.config.ts](lit-canon-api.config.ts)                 | Generator configuration: input file and output directory                |
| [generated/products/models.ts](generated/products/models.ts)       | Generated request, response and query parameter types                   |
| [generated/products/api.ts](generated/products/api.ts)             | Generated typed fetch functions                                         |
| [generated/products/queries.ts](generated/products/queries.ts)     | Generated `productsKeys` factory and query options for GET operations   |
| [generated/products/mutations.ts](generated/products/mutations.ts) | Generated mutation options for POST and PUT operations                  |
| [generated/index.ts](generated/index.ts)                           | Generated entry point exporting the `products` namespace                |
| [catalog-element.ts](catalog-element.ts)                           | Handwritten Lit component: list products, create one, refresh the cache |
| [catalog-app.ts](catalog-app.ts)                                   | Handwritten app root providing the `QueryClient` through Lit context    |

## Regenerate and check

From the repository root:

```bash
pnpm install
pnpm example:generate
pnpm example:check
pnpm typecheck
```

`example:generate` builds the packages and regenerates `examples/catalog/generated/`.
`example:check` runs `lit-canon-api check`: it fails if the committed output differs
from a fresh generation and leaves existing files untouched. CI runs the check, and
`typecheck` checks both the generated API and the components. Edit `openapi.json` or
the config, then regenerate; do not edit files inside `generated/` manually.

## Call the generated API

Inside a TypeScript application with bundler module resolution:

```ts
import { products } from "./generated";

const catalog = await products.listProducts({ limit: 20 }); // Product[]
const product = await products.getProduct("p-1"); // Product
const created = await products.createProduct({ name: "Notebook", price: 12.5 });
await products.updateProduct(created.id, { name: "Large notebook", price: 15 });
```

`lit-canon-fetch` sends query parameters and JSON bodies, handles HTTP errors and
returns the response body. `getProduct` and `updateProduct` encode the path parameter.

## Use the options with Lit Query

[`catalog-app.ts`](catalog-app.ts) creates one `QueryClient` and provides it through
`queryClientContext`. [`catalog-element.ts`](catalog-element.ts) creates its
controllers without a client argument, so they take the client from that context. The
query reads products with inferred `Product[]` data. The mutation takes
`{ request: ProductInput }` and invalidates every product query through
`productsKeys.all` on success, using the client TanStack passes to `onSuccess`.
Loading, errors, rendering and cache invalidation are application code.

Mutations take one object named after the operation's parameters:

```ts
// Inside a LitElement rendered below the provider:
const update = createMutationController(this, () => products.updateProductMutation());
update.mutate({ productId: "p-1", request: { name: "Large notebook", price: 15 } });
```

The key factory covers every query of the resource:

```ts
products.productsKeys.all; // ["products"]
products.productsKeys.listProducts({ limit: 20 }); // ["products", "listProducts", { limit: 20 }]
products.productsKeys.getProduct("p-1"); // ["products", "getProduct", "p-1"]
```

To use the full example, copy it into a Lit application, install the dependencies
described in the [main README](../../README.md#installation), import `catalog-app.ts`
from the app's entry point, and render:

```html
<catalog-app></catalog-app>
```

In a lit-canon app, provide the client with `provide(queryClientContext, ...)` instead
of `catalog-app.ts`; see [docs/lit-canon.md](../../docs/lit-canon.md).

By default, requests go to `/products` on the application's origin. Point the runtime
at a matching API before mounting the component if it lives elsewhere:

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({ baseUrl: "http://localhost:3000" });
```

This example does not include an API server or a development server. Generation and
typechecking work without a backend; fetching and saving products require a Lit app
and an API implementing the included contract.
