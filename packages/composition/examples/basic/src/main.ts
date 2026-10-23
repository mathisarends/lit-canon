import { html } from "lit";
import { createApp, provide } from "lit-canon-composition";
import { apiCtx, FakeApiClient } from "./api.js";
import { authFeature } from "./features/auth/index.js";
import { browsersFeature } from "./features/browsers/index.js";
import "./not-found-page.js";

const FEATURES = [authFeature, browsersFeature];

createApp({
  root: document.querySelector("#app")!,
  features: FEATURES,
  providers: [provide(apiCtx, () => new FakeApiClient())],
  notFound: () => html`<not-found-page></not-found-page>`,
  baseTitle: "Example",
}).start();
