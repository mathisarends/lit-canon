# Intent prefetching and page scaffolding

Declare the initial queries of a page once, in a small application-owned module.
The route prefetches those options and the page observes the same options with
`createQueryController`. Both use the one QueryClient provided by the app.

Run the [catalog reference app](../examples/catalog/prefetch/README.md) with
`pnpm example:prefetch` to try it without a backend.

## Scaffold a page

Generate the API client first, then run:

```bash
pnpm exec lit-canon-api add-page --feature src/features/products --name detail --path /products/:id --query product=get_product --bind product.productId=id
```

`--config` defaults to `lit-canon-api.config.ts`. Feature and API paths are resolved
against the config's directory, just as they are for `generate` and `check`.

- `--feature`: feature directory; its last segment is its kebab-case name.
- `--name`: kebab-case name local to that feature. Names and custom element tags
  include the feature prefix, so different features can both have a `detail` page.
- `--path`: simple pathname containing literal and required `/:param` segments.
- `--query product=get_product`: give the start query a local name and select an
  OpenAPI operation ID (the generated camelCase name also works).
- `--bind product.productId=id`: bind that query's API input to the route's `id`.
  Every required input needs an explicit binding; there is no name/path guessing.

Repeat `--query` and `--bind` for several independent start queries. The initial
scaffold supports string inputs bound to route parameters; optional inputs are
omitted. Required query objects, number conversions, search parameters and dependent
queries need explicit application code after scaffolding. Only included GET queries
are eligible; operations configured as mutations are rejected.

The command creates:

```text
src/features/products/
  index.ts                    # explicit pages array
  detail.route.ts             # route descriptor, no eager component import
  pages/
    detail.queries.ts         # shared initial query options
    detail-page.ts            # lazy component and ordinary query controllers
```

An existing `index.ts` must export one `defineFeature` call with a literal `pages`
array. The scaffold adds an import and an array entry, preserving layouts, providers
and other code. Unsupported registration shapes fail before creating files.

All four files are editable application code. The scaffold refuses to overwrite
page files, and API regeneration never replaces them. Keep the feature directory
outside the generator-owned API output. A new feature still needs to be explicitly
listed in the app's `features`; the scaffold does not scan or rewrite app entrypoints.

The same operation is available as `scaffoldPage(config, options)` from
`lit-canon-api`; its options correspond to the CLI fields (`queries`, `bindings`).

## Shared query options

The scaffold writes a named object so each controller can select its own query:

```ts
import { queryOptions } from "@tanstack/lit-query";
import type { PageParams } from "lit-canon-composition";
import { products } from "../../../api/generated";

export type ProductsDetailParams = PageParams<"/products/:id">;

export const productsDetailQueries = ({ id }: ProductsDetailParams) => ({
  product: queryOptions({
    ...products.getProductQuery(id),
    staleTime: 30_000,
  }),
});
```

The 30 s stale time is a starting application policy, not an API contract. Adjust it
here so intent and observers agree about freshness. `queryOptions` preserves data
inference, including when exporting declarations. No handwritten keys or extra
fetch/cache abstraction is involved.

```ts
import { definePage } from "lit-canon-composition";
import { prefetchQueries } from "lit-canon-composition/query";

export const productsDetail = definePage({
  path: "/products/:id",
  load: () => import("./pages/detail-page.js"),
  prefetch: prefetchQueries(({ params }) => productsDetailQueries(params)),
  render: (params) => html`<products-detail-page .params=${params}></products-detail-page>`,
});
```

In the component:

```ts
private readonly productQuery = createQueryController(this, () => ({
  ...productsDetailQueries(this.params).product,
  enabled: Boolean(this.params.id),
}));
```

`enabled` and `select` belong to observers, not the shared prefetch set. Include only
executable initial read queries there, rather than queries for every tab or future
interaction. Adding an entry to the shared set automatically adds it to prefetching;
displaying it still requires a controller and UI in the page.

`prefetchQueries` is an optional package subpath. It uses the app container's
`queryClientContext`; it never creates a client. The core composition entrypoint
does not import TanStack or the API packages. Install `@tanstack/lit-query` only when
using the adapter. Core `prefetch` callbacks work with any data layer.

## Runtime behavior

Each app root owns one intent controller. Normal `<a href>` elements below it work
without per-link handlers, including anchors in open shadow roots:

- Mouse/pen hover starts after 60 ms. Leaving earlier cancels the timer; moving
  between children of the same anchor does not.
- Keyboard focus and touch start immediately.
- External links, downloads, targets other than `_self`, current-document links,
  unknown routes and `data-no-prefetch` anchors are ignored.
- Save-Data skips speculative work. Disconnecting the app root removes listeners
  and clears pending timers. Already-started queries may finish in the shared cache.

`app.prefetch(href)` exposes the same best-effort path for explicit callers. It
matches pathname patterns in registration order, passes `{ params, path, url,
container }` to hooks, and leaves history, titles, scrolling and rendering alone.
Search parameters remain available through `url.searchParams`.

Chunk imports and the data hook start concurrently. Concurrent intents for the
same pathname/search share a promise. Successful chunk loads are reused by
navigation; rejected loads can be retried. Data caching, freshness and in-flight
request sharing remain TanStack's responsibility, so later intent attempts can
refresh stale data rather than permanently skipping a previously visited URL.

Navigation still runs guards first. Once permitted, it starts the data hook without
waiting for it and waits only for the chunk before rendering. Pages retain normal
pending/error UI when data is missing or prefetch fails. There is no blocking route
data loader. Speculative errors are ignored; navigation chunk errors follow the
existing logging and cancellation behavior.

## Guards and typed params

Hover never runs navigation guards: they may redirect or perform other actions.
Pages with guards skip speculative loading unless they explicitly supply a
side-effect-free `canPrefetch` permission check:

```ts
canPrefetch: ({ container }) => Boolean(container.get(authCtx).user),
```

This check runs again on later intents. It does not replace real navigation guards
or backend authorization. After real guards pass, navigation starts data regardless
of the speculative permission check.

`definePage` infers required strings from simple named segments such as
`/teams/:teamId/products/:id` in `render`, `title`, `prefetch` and `canPrefetch`.
`PageParams<Path>` exposes the same type for shared modules. Dynamic strings and
complex URLPattern segments conservatively retain `string | undefined`; full
URLPattern syntax remains supported at runtime. Typed URL builders and search-param
schemas are separate work.

[All documentation](README.md)
