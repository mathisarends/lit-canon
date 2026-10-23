import { describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { defineFeature, definePage, type Layout } from "../src/index.js";
import { back, delay, flush, start, text } from "./helpers.js";

const layout: Layout = (content) => html`<section class="layout">${content}</section>`;

const items = defineFeature({
  name: "items",
  layout,
  pages: [
    definePage({ path: "/items", render: () => html`<p>list</p>` }),
    definePage({ path: "/items/new", render: () => html`<p>new item</p>` }),
    definePage({ path: "/items/:id", render: ({ id }) => html`<p>item ${id}</p>` }),
  ],
});
const plain = defineFeature({
  name: "plain",
  pages: [
    definePage({ path: "/", render: () => html`<p>home</p>` }),
    definePage({ path: "/about", render: () => html`<p>about <a href="/items/7">seven</a></p>` }),
  ],
});
const notFound = () => html`<p>not found</p>`;

describe("routing", () => {
  it("renders the page for the initial URL", async () => {
    const { host } = await start({ features: [items, plain] }, "/items/3");
    expect(text(host)).toBe("item 3");
  });

  it("renders the matching page with params on navigate", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/items/42");
    expect(text(host)).toBe("item 42");
    expect(location.pathname).toBe("/items/42");
  });

  it("matches in registration order", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/items/new");
    expect(text(host)).toBe("new item");
  });

  it("wraps pages of a feature in its layout", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/items");
    expect(host.querySelector(".layout")?.textContent?.trim()).toBe("list");
  });

  it("does not wrap pages of a feature without layout", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/about");
    expect(text(host)).toContain("about");
    expect(host.querySelector(".layout")).toBeNull();
  });

  it("renders notFound for unknown paths", async () => {
    const { app, host } = await start({ features: [items, plain], notFound });
    await app.navigate("/nope/nope");
    expect(text(host)).toBe("not found");
  });

  it("renders nothing for unknown paths without notFound", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/nope");
    expect(text(host)).toBe("");
  });

  it("follows link clicks via the router", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/about");
    host.querySelector("a")!.click();
    await flush(host);
    expect(text(host)).toBe("item 7");
    expect(location.pathname).toBe("/items/7");
  });

  it("navigates back with popstate", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/items/1");
    await app.navigate("/items/2");
    await back(host);
    expect(text(host)).toBe("item 1");
  });

  it("keeps query and hash in the URL", async () => {
    const { app, host } = await start({ features: [items, plain] });
    await app.navigate("/items/5?tab=info#top");
    expect(text(host)).toBe("item 5");
    expect(location.search + location.hash).toBe("?tab=info#top");
  });

  it("throws when navigating before start", async () => {
    const { setup } = await import("./helpers.js");
    const { app } = setup({ features: [plain] });
    await expect(app.navigate("/")).rejects.toThrow("before app.start()");
  });
});

describe("lazy loading", () => {
  it("calls load only when the route is entered", async () => {
    const load = vi.fn(() => import("./fixtures/lazy-page.js"));
    const lazy = defineFeature({
      name: "lazy",
      pages: [definePage({ path: "/lazy", load, render: () => html`<lazy-page></lazy-page>` })],
    });
    const { app, host } = await start({ features: [plain, lazy] });
    expect(load).not.toHaveBeenCalled();
    expect(customElements.get("lazy-page")).toBeUndefined();

    await app.navigate("/lazy");
    expect(load).toHaveBeenCalledOnce();
    expect(customElements.get("lazy-page")).toBeDefined();
    const page = host.querySelector("lazy-page")!;
    expect(page.shadowRoot?.textContent).toBe("lazy page");
  });

  it("waits for load before rendering", async () => {
    let rendered = false;
    const lazy = defineFeature({
      name: "slow",
      pages: [
        definePage({
          path: "/slow",
          load: () => delay(30),
          render: () => ((rendered = true), html`<p>slow</p>`),
        }),
      ],
    });
    const { app, host } = await start({ features: [plain, lazy] });
    const nav = app.navigate("/slow");
    await delay(5);
    expect(rendered).toBe(false);
    await nav;
    expect(text(host)).toBe("slow");
  });

  it("aborts navigation and logs with the page path when load fails", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("chunk missing");
    const broken = defineFeature({
      name: "broken",
      pages: [
        definePage({
          path: "/broken/:id",
          load: () => Promise.reject(failure),
          render: () => html`<p>broken</p>`,
        }),
      ],
    });
    const { app, host } = await start({ features: [plain, broken] });
    await app.navigate("/broken/1");
    expect(text(host)).toBe("home");
    expect(location.pathname).toBe("/");
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"/broken/:id"'), failure);
    error.mockRestore();
  });
});

describe("title", () => {
  const titled = defineFeature({
    name: "titled",
    pages: [
      definePage({ path: "/static", title: "Static", render: () => html`` }),
      definePage({
        path: "/b/:id",
        title: ({ params }) => `Browser ${params.id}`,
        render: () => html``,
      }),
      definePage({ path: "/untitled", render: () => html`` }),
    ],
  });

  it("sets a string title", async () => {
    const { app } = await start({ features: [titled] });
    await app.navigate("/static");
    expect(document.title).toBe("Static");
  });

  it("sets a title computed from params", async () => {
    const { app } = await start({ features: [titled] });
    await app.navigate("/b/42");
    expect(document.title).toBe("Browser 42");
  });

  it("combines title and baseTitle", async () => {
    const { app } = await start({ features: [titled], baseTitle: "Example" });
    await app.navigate("/b/42");
    expect(document.title).toBe("Browser 42 · Example");
  });

  it("uses only baseTitle for pages without title", async () => {
    const { app } = await start({ features: [titled], baseTitle: "Example" });
    await app.navigate("/untitled");
    expect(document.title).toBe("Example");
  });

  it("leaves document.title alone without title and baseTitle", async () => {
    const { app } = await start({ features: [titled] });
    document.title = "unchanged";
    await app.navigate("/untitled");
    expect(document.title).toBe("unchanged");
  });

  it("sets the title only after load succeeded", async () => {
    const title = vi.fn(() => "Loaded");
    let resolveLoad!: () => void;
    const f = defineFeature({
      name: "f",
      pages: [
        definePage({ path: "/", render: () => html`` }),
        definePage({
          path: "/later",
          title,
          load: () => new Promise<void>((r) => (resolveLoad = r)),
          render: () => html``,
        }),
      ],
    });
    const { app } = await start({ features: [f] });
    const nav = app.navigate("/later");
    await delay(5);
    expect(title).not.toHaveBeenCalled();
    resolveLoad();
    await nav;
    expect(document.title).toBe("Loaded");
  });
});

describe("scroll", () => {
  const tall = defineFeature({
    name: "tall",
    pages: ["/", "/a", "/b"].map((path) =>
      definePage({ path, render: () => html`<div style="height: 5000px">${path}</div>` }),
    ),
  });

  it("scrolls to the top after navigate", async () => {
    const { app } = await start({ features: [tall] });
    await app.navigate("/a");
    window.scrollTo(0, 800);
    expect(window.scrollY).toBe(800);
    await app.navigate("/b");
    expect(window.scrollY).toBe(0);
  });

  it("does not scroll after popstate", async () => {
    const { app, host } = await start({ features: [tall] });
    await app.navigate("/a");
    await app.navigate("/b");
    const scrollTo = vi.spyOn(window, "scrollTo");
    await back(host);
    expect(text(host)).toBe("/a");
    expect(scrollTo).not.toHaveBeenCalled();
    scrollTo.mockRestore();
  });
});
