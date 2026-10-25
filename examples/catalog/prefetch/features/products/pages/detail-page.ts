// Scaffolded by lit-canon-api. Application code: edit freely.

import { LitElement, html } from "lit";
import { createQueryController } from "@tanstack/lit-query";
import { productsDetailQueries, type ProductsDetailParams } from "./detail.queries.js";
export class ProductsDetailPage extends LitElement {
  static override properties = { params: { attribute: false } };
  params: ProductsDetailParams = { id: "" };
  private readonly productQuery = createQueryController(this, () => ({
    ...productsDetailQueries(this.params).product,
    enabled: Object.values(this.params).every(Boolean),
  }));
  protected override render() {
    const productResult = this.productQuery();
    if (productResult.isPending) return html`<p>Loading…</p>`;
    if (productResult.isError) return html`<p role="alert">${productResult.error.message}</p>`;
    const product = productResult.data;
    return html`
      <a href="/products">← Products</a>
      <h1>${product.name}</h1>
      <p>€${product.price.toFixed(2)}</p>
    `;
  }
}
customElements.define("products-detail-page", ProductsDetailPage);
