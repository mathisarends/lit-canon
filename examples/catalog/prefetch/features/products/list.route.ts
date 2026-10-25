// Scaffolded by lit-canon-api. Application code: edit freely.

import { html } from "lit";
import { definePage } from "lit-canon-composition";
import { prefetchQueries } from "lit-canon-composition/query";
import { productsListQueries } from "./pages/list.queries.js";
export const productsList = definePage({
  path: "/products",
  load: () => import("./pages/list-page.js"),
  prefetch: prefetchQueries(({ params }) => productsListQueries(params)),
  render: (params) => html`<products-list-page .params=${params}></products-list-page>`,
});
