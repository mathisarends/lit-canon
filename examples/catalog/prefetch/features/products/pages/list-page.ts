// Scaffolded by lit-canon-api. Application code: edit freely.

import { LitElement, html } from "lit";
import { createQueryController } from "@tanstack/lit-query";
import { productsListQueries, type ProductsListParams } from "./list.queries.js";
export class ProductsListPage extends LitElement {
  static override properties = { params: { attribute: false } };
  params: ProductsListParams = {};
  private readonly productsQuery = createQueryController(this, () => ({
    ...productsListQueries(this.params).products,
    enabled: Object.values(this.params).every(Boolean),
  }));
  protected override render() {
    const productsResult = this.productsQuery();
    if (productsResult.isPending) return html`<p>Loading…</p>`;
    if (productsResult.isError) return html`<p role="alert">${productsResult.error.message}</p>`;
    return html`
      <h1>Products</h1>
      <p>Hover or focus a product before opening it.</p>
      <ul>
        ${productsResult.data.map(
          (product) => html`
            <li>
              <a href=${`/products/${encodeURIComponent(product.id)}`}>
                ${product.name} — €${product.price.toFixed(2)}
              </a>
            </li>
          `,
        )}
      </ul>
    `;
  }
}
customElements.define("products-list-page", ProductsListPage);
