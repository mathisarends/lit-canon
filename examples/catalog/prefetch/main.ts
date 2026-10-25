import { html } from "lit";
import { QueryClient, queryClientContext } from "@tanstack/lit-query";
import { createApp, defineFeature, definePage, provide, redirect } from "lit-canon-composition";
import { configureApiFetch } from "lit-canon-fetch";
import { productsFeature } from "./features/products/index.js";

configureApiFetch({ baseUrl: "/api" });
createApp({
  root: document.querySelector("#app")!,
  features: [
    defineFeature({
      name: "home",
      pages: [
        definePage({
          path: "/",
          guards: [() => redirect("/products")],
          render: () => html``,
        }),
      ],
    }),
    productsFeature,
  ],
  providers: [provide(queryClientContext, () => new QueryClient())],
  notFound: () =>
    html`<h1>Not found</h1>
      <a href="/products">Products</a>`,
  baseTitle: "Catalog",
}).start();
