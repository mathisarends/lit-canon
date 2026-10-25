// Scaffolded by lit-canon-api. Application code: edit freely.

import { html } from "lit";
import { definePage } from "lit-canon-composition";
import { prefetchQueries } from "lit-canon-composition/query";
import { productsDetailQueries } from "./pages/detail.queries.js";
export const productsDetail = definePage({
  path: "/products/:id",
  load: () => import("./pages/detail-page.js"),
  prefetch: prefetchQueries(({ params }) => productsDetailQueries(params)),
  render: (params) => html`<products-detail-page .params=${params}></products-detail-page>`,
});
