// Scaffolded by lit-canon-api. Application code: edit freely.

import type { PageParams } from "lit-canon-composition";
import { queryOptions } from "@tanstack/lit-query";
import { products } from "../../../../generated/index.js";
export type ProductsListParams = PageParams<"/products">;
export const productsListQueries = (_params: ProductsListParams) => ({
  products: queryOptions({ ...products.listProductsQuery(), staleTime: 30_000 }),
});
