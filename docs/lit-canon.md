# Using the generated client in a lit-canon app

This is the canonical way to use `lit-canon-api` output in an app built with
`lit-canon-composition`. It needs no glue code: the composition package provides
values through Lit context, and TanStack Lit Query controllers read their
`QueryClient` from Lit context.

The packages stay independent. `lit-canon-api` and `lit-canon-fetch` do not depend
on `lit-canon-composition`, and the generated code works in any Lit app.

## 1. Provide one QueryClient

Register the client as an app-wide provider. `createApp` creates it once and
provides it on the root element, so every page and component below it can use it.

```ts
// main.ts
import { QueryClient, queryClientContext } from "@tanstack/lit-query";
import { createApp, provide } from "lit-canon-composition";
import { configureApiFetch } from "lit-canon-fetch";
import { productsFeature } from "./features/products";

configureApiFetch({
  baseUrl: "/api",
  headers: async (): Promise<HeadersInit> => ({ authorization: `Bearer ${await getToken()}` }),
});

createApp({
  root: document.querySelector("#app")!,
  features: [productsFeature],
  providers: [provide(queryClientContext, () => new QueryClient())],
}).start();
```

Call `configureApiFetch` once, before the first request. `getToken` stands for your
own authentication code.

## 2. Use the generated options in pages

Pass the generated factories to the controllers without a client argument. The
controllers find the client through `queryClientContext` when the page connects.

```ts
// features/products/pages/product-list-page.ts
import { LitElement, html } from "lit";
import { createMutationController, createQueryController } from "@tanstack/lit-query";
import { products } from "../../../api/generated";

export class ProductListPage extends LitElement {
  private readonly list = createQueryController(this, () =>
    products.listProductsQuery({ limit: 20 }),
  );

  private readonly create = createMutationController(this, () => ({
    ...products.createProductMutation(),
    onSuccess: (_product, _variables, _onMutateResult, { client }) =>
      client.invalidateQueries({ queryKey: products.productsKeys.all }),
  }));

  override render() {
    const list = this.list();
    if (list.isPending) return html`<p>Loading products…</p>`;
    if (list.isError) return html`<p role="alert">${list.error.message}</p>`;

    return html`
      <ul>
        ${list.data.map((product) => html`<li>${product.name}</li>`)}
      </ul>
      <button @click=${() => this.create.mutate({ request: { name: "Notebook", price: 12.5 } })}>
        Add a notebook
      </button>
    `;
  }
}

customElements.define("product-list-page", ProductListPage);
```

Register the page with `definePage` and `defineFeature` as usual; nothing about the
API client goes into the feature definition.

To prefetch initial data on hover/focus, share a named query-options factory between
the page controller and the route's `prefetch` hook. The
[prefetch and scaffolding guide](prefetching.md) shows this pattern and the
`lit-canon-api add-page` command that creates it.

## Rules

- **One client per app**, provided with `provide(queryClientContext, ...)`. Pages and
  services never create a `QueryClient`.
- **Components never hold the client.** Mutation callbacks receive it as
  `context.client`, the fourth argument of `onSuccess`, `onError` and `onSettled`.
- **Invalidate with the key factory**: `<resource>Keys.all` for a whole resource,
  `<resource>Keys.<operation>(...)` for one query. Do not write query keys by hand.
- **Mutations take one object**, for example `{ productId, request }`.
- **Request defaults belong in `configureApiFetch`**: base URL, credentials and
  headers, including async auth headers.
- **Call-site options stay at the call site**: `enabled`, `staleTime`, `select` and
  similar options are spread next to the generated options.

## Limitations

`useQueryClient()` from `@tanstack/lit-query` does not read Lit context. It reads a
process-wide default client, which `QueryClientProvider` registers but
`provide(...)` does not. Prefer the client passed to mutation callbacks, or consume
`queryClientContext` with `@consume` or `ContextConsumer` from `@lit/context`.

Controllers resolve the client when their host connects. A component rendered
outside the app root has no provider and reports "No QueryClient available". Render
it below the root, or pass a client explicitly in tests.

See the [catalog example](../examples/catalog/README.md) for the generated files and
[getting started](getting-started.md) for the generator setup.

[All documentation](README.md)
