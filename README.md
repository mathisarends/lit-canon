# lit-canon

Libraries for building [Lit](https://lit.dev/) single-page apps in one fixed shape:
a typed API layer generated from OpenAPI, and an app composition layer for pages,
features, guards and providers. The [vision](vision.md) explains why.

| Package                                                 | What it does                                                                                         |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| [lit-canon-api](packages/api/README.md)                 | Generator and CLI: OpenAPI 3 → typed client, query-key factories and TanStack Lit Query options.     |
| [lit-canon-fetch](packages/fetch/README.md)             | Browser runtime used by the generated code: request defaults, auth headers, `ApiError`. No deps.     |
| [lit-canon-composition](packages/composition/README.md) | App composition over Lit, `@lit-labs/router` and `@lit/context`: pages, features, guards, providers. |

The packages are independent. The API packages work in any Lit app, and
`lit-canon-composition` works with any data layer.
[Using the client in a lit-canon app](docs/lit-canon.md) shows how they fit together.

## Quick look

```ts
import { createQueryController } from "@tanstack/lit-query";
import { products } from "./api/generated";

// Generated from the OpenAPI tag "products"; the data is typed as Product[].
catalog = createQueryController(this, () => products.listProductsQuery({ limit: 20 }));

// Invalidate with the generated key factory, never with hand-written keys.
client.invalidateQueries({ queryKey: products.productsKeys.all });
```

```ts
import { createApp, provide } from "lit-canon-composition";

createApp({
  root: document.querySelector("#app")!,
  features: [authFeature, productsFeature],
  providers: [provide(queryClientContext, () => new QueryClient())],
}).start();
```

The [catalog example](examples/catalog/README.md) contains an OpenAPI document, the
[generated client](examples/catalog/generated/products/) and Lit components using it.

## Get started

```bash
pnpm add lit-canon-fetch @tanstack/lit-query lit
pnpm add -D lit-canon-api
```

Then follow [getting started](docs/getting-started.md). Upgrading from
`lit-query-codegen`? See the [migration guide](docs/migration.md).

## Documentation

Intent prefetching and editable page scaffolding are covered in the
[guide](docs/prefetching.md). Run `pnpm example:prefetch` for a self-contained catalog
demo with lazy pages and a delayed local API.

| Task                                               | Read                                                     |
| -------------------------------------------------- | -------------------------------------------------------- |
| Install, generate and use a client                 | [Getting started](docs/getting-started.md)               |
| Configure the generator and run it in CI           | [Configuration and CLI](docs/configuration.md)           |
| Set up requests, auth headers and error handling   | [Fetch runtime](docs/runtime.md)                         |
| Check whether your specification is supported      | [OpenAPI requirements](docs/openapi.md)                  |
| Wire the client into a `lit-canon-composition` app | [Using the client in a lit-canon app](docs/lit-canon.md) |
| Compose pages, features and guards                 | [lit-canon-composition](packages/composition/README.md)  |
| Work on this repository                            | [Development](docs/development.md)                       |
| Make changes as a coding agent                     | [Agent guide](docs/agents.md)                            |

The [documentation index](docs/README.md) has reading paths for app developers,
contributors and agents.

## Development

This is a pnpm workspace; Node.js 22.18.0 or later is required.

```bash
pnpm install
pnpm build
pnpm test
pnpm typecheck
```

See [development](docs/development.md) for all checks. Licensed under [MIT](LICENSE).
