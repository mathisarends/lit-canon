import { LitElement, html } from "lit";
import { QueryClient, QueryClientProvider } from "@tanstack/lit-query";
import "./catalog-element";

// One client for the whole app, so every component shares the same cache.
const queryClient = new QueryClient();

// QueryClientProvider provides the client through queryClientContext. In a lit-canon
// app, use provide(queryClientContext, () => new QueryClient()) instead (docs/lit-canon.md).
customElements.define("query-client-provider", QueryClientProvider);

export class CatalogApp extends LitElement {
  override render() {
    return html`
      <query-client-provider .client=${queryClient}>
        <product-catalog></product-catalog>
      </query-client-provider>
    `;
  }
}

customElements.define("catalog-app", CatalogApp);
