import { LitElement, html } from "lit";
import { createMutationController, createQueryController } from "@tanstack/lit-query";
import { products } from "./generated";

// No QueryClient argument: the controllers request it through queryClientContext
// from the closest provider above this element (see catalog-app.ts).
export class ProductCatalog extends LitElement {
  private readonly catalog = createQueryController(this, () => ({
    ...products.listProductsQuery({ limit: 20 }),
    staleTime: 60_000,
  }));

  private readonly createProduct = createMutationController(this, () => ({
    ...products.createProductMutation(),
    // Decide which data to refresh in the application, after a successful write.
    onSuccess: (_product, _variables, _onMutateResult, { client }) =>
      client.invalidateQueries({ queryKey: products.productsKeys.all }),
  }));

  override render() {
    const catalog = this.catalog();
    const creation = this.createProduct();

    if (catalog.isPending) return html`<p>Loading products…</p>`;
    if (catalog.isError) return html`<p role="alert">${catalog.error.message}</p>`;

    return html`
      <ul>
        ${catalog.data.map((product) => html`<li>${product.name} — ${product.price}</li>`)}
      </ul>
      <button
        ?disabled=${creation.isPending}
        @click=${() => this.createProduct.mutate({ request: { name: "Notebook", price: 12.5 } })}
      >
        Add a notebook
      </button>
      ${creation.isError ? html`<p role="alert">${creation.error.message}</p>` : null}
    `;
  }
}

customElements.define("product-catalog", ProductCatalog);
