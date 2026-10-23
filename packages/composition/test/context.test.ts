import { describe, expect, it } from "vitest";
import { LitElement, html } from "lit";
import { consume, createContext } from "@lit/context";
import { defineFeature, definePage, provide } from "../src/index.js";
import { start } from "./helpers.js";

class ApiClient {
  name = "api";
}
class Greeter {
  greet = () => "hello";
}
const apiCtx = createContext<ApiClient>("api-client");
const greeterCtx = createContext<Greeter>("greeter");

class ConsumerPage extends LitElement {
  @consume({ context: apiCtx }) api?: ApiClient;
  @consume({ context: greeterCtx }) greeter?: Greeter;

  override render() {
    return html`${this.api?.name} ${this.greeter?.greet()}`;
  }
}
customElements.define("consumer-page", ConsumerPage);

describe("context", () => {
  it("provides app and feature values to pages via @consume", async () => {
    // The greeter is declared in another feature: feature providers are organisation, not encapsulation.
    const other = defineFeature({
      name: "other",
      pages: [definePage({ path: "/other", render: () => html`` })],
      providers: [provide(greeterCtx, () => new Greeter())],
    });
    const consumer = defineFeature({
      name: "consumer",
      pages: [definePage({ path: "/", render: () => html`<consumer-page></consumer-page>` })],
    });
    const { app, host } = await start({
      features: [consumer, other],
      providers: [provide(apiCtx, () => new ApiClient())],
    });
    const page = host.querySelector<ConsumerPage>("consumer-page")!;
    await page.updateComplete;
    expect(page.api).toBe(app.container.get(apiCtx));
    expect(page.greeter).toBe(app.container.get(greeterCtx));
    expect(page.shadowRoot!.textContent).toContain("api hello");
  });
});
