# Intent prefetch reference app

From the workspace root:

```bash
pnpm install
pnpm example:prefetch
```

Open the local URL printed by Vite. The development server supplies a catalog API
with a 700 ms response delay; no backend or credentials are needed.

Hover a product link for at least 60 ms, or focus it with the keyboard. Its page
chunk and detail query begin loading together. Click after the response finishes
and the detail renders from the cache. Click sooner and the page joins the ongoing
request. With no prior intent, the page displays its normal loading state.

The Network panel shows one detail request while the query remains fresh (30 s).
Leaving a link before 60 ms cancels the pending hover timer. Touch starts prefetch
immediately. The app uses one context-provided QueryClient and ordinary anchors.

The feature was created with the new scaffold, then its two render methods were
edited to display product data:

```bash
pnpm exec lit-canon-api add-page --config examples/catalog/lit-canon-api.config.ts --feature prefetch/features/products --name detail --path /products/:id --query product=get_product --bind product.productId=id
pnpm exec lit-canon-api add-page --config examples/catalog/lit-canon-api.config.ts --feature prefetch/features/products --name list --path /products --query products=list_products
```

These commands describe its provenance; re-running them refuses to overwrite the
checked-in application files. API regeneration only replaces `../generated/`.

- [Shared detail options](features/products/pages/detail.queries.ts)
- [Route and prefetch declaration](features/products/detail.route.ts)
- [Page query controller](features/products/pages/detail-page.ts)
- [Explicit feature registration](features/products/index.ts)
- [Scaffolding and SDK guide](../../../docs/prefetching.md)
