# lit-canon-api

Generate a typed API client, query-key factories and
[TanStack Lit Query](https://tanstack.com/query/latest/docs/framework/lit/overview)
options from an OpenAPI 3 document. Generated code runs on
[lit-canon-fetch](https://github.com/mathisarends/lit-canon/tree/main/packages/fetch).

```bash
pnpm add lit-canon-fetch @tanstack/lit-query lit
pnpm add -D lit-canon-api
```

Create `lit-canon-api.config.ts` next to your `package.json`:

```ts
import { defineConfig } from "lit-canon-api";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
});
```

Then generate the client, and check it in CI:

```bash
pnpm lit-canon-api generate
pnpm lit-canon-api check   # fails if the committed client is out of date
```

Each OpenAPI tag becomes one resource with a typed API, a key factory, query options
and mutation options:

```ts
import { createMutationController, createQueryController } from "@tanstack/lit-query";
import { products } from "./api/generated";

// Inside a LitElement below a QueryClient provider:
catalog = createQueryController(this, () => products.listProductsQuery({ limit: 20 }));
update = createMutationController(this, () => ({
  ...products.updateProductMutation(),
  onSuccess: (_data, _variables, _result, { client }) =>
    client.invalidateQueries({ queryKey: products.productsKeys.all }),
}));

update.mutate({ productId: "p-1", request: { name: "Notebook", price: 12.5 } });
```

See the [documentation](https://github.com/mathisarends/lit-canon/tree/main/docs) for
configuration, the OpenAPI contract and the generated code.

## Page scaffolding

After generating the client, scaffold an editable page and its shared start queries:

```bash
pnpm exec lit-canon-api add-page --feature src/features/products --name detail --path /products/:id --query product=get_product --bind product.productId=id
```

The command writes a lazy page, a shared query factory, a route descriptor and an
explicit feature registration outside API output. It refuses application overwrites.
See the [prefetch and scaffolding guide](../../docs/prefetching.md).

## License

MIT
