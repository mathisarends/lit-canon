import { productsList } from "./list.route.js";
import { defineFeature } from "lit-canon-composition";
import { productsDetail } from "./detail.route.js";
export const productsFeature = defineFeature({
  name: "products",
  pages: [productsDetail, productsList],
});
