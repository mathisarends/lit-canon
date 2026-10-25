// Scaffolded by lit-canon-api. Application code: edit freely.

import type { PageParams } from "lit-canon-composition";
import { queryOptions } from "@tanstack/lit-query";
import { products } from "../../../../generated/index.js";
export type ProductsDetailParams = PageParams<"/products/:id">;
export const productsDetailQueries = (params: ProductsDetailParams) => ({
  product: queryOptions({ ...products.getProductQuery(params.id), staleTime: 30_000 }),
});
