import { describe, expect, expectTypeOf, it, vi } from "vitest";
import { LitElement, html } from "lit";
import {
  QueryClient,
  createQueryController,
  queryClientContext,
  queryOptions,
} from "@tanstack/lit-query";
import {
  defineFeature,
  definePage,
  provide,
  redirect,
  type PageDef,
  type PageParams,
} from "../src/index.js";
import { prefetchQueries } from "../src/query.js";
import { delay, flush, start, text } from "./helpers.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};
const home = definePage({ path: "/", render: () => html`home` });
const feature = (...pages: PageDef[]) => defineFeature({ name: "f", pages: [home, ...pages] });

describe("intent prefetch", () => {
  it("starts chunk and data concurrently, shares the chunk with navigation, and never blocks on data", async () => {
    const chunk = deferred();
    const data = deferred();
    const load = vi.fn(() => chunk.promise);
    const prefetch = vi.fn((_ctx: unknown) => data.promise);
    const { app, host } = await start({
      features: [
        feature(
          definePage({
            path: "/items/:id",
            load,
            prefetch,
            render: ({ id }) => html`item ${id}`,
          }),
        ),
      ],
    });
    const intent = app.prefetch("/items/42?tab=info#heading");
    await delay(0);
    expect(load).toHaveBeenCalledOnce();
    expect(prefetch).toHaveBeenCalledOnce();
    expect(prefetch.mock.calls[0]![0]).toMatchObject({ params: { id: "42" }, path: "/items/42" });
    expect(location.pathname).toBe("/");
    const nav = app.navigate("/items/42");
    chunk.resolve();
    await nav;
    expect(text(host)).toBe("item 42");
    expect(load).toHaveBeenCalledOnce();
    data.resolve();
    await intent;
  });

  it("deduplicates overlapping intent but allows later attempts and failed chunk retries", async () => {
    const wait = deferred();
    const load = vi.fn().mockRejectedValueOnce(new Error("chunk")).mockResolvedValue(undefined);
    const prefetch = vi.fn(() => wait.promise);
    const { app } = await start({
      features: [feature(definePage({ path: "/a", load, prefetch, render: () => html`` }))],
    });
    const first = app.prefetch("/a");
    const second = app.prefetch("/a#other");
    await delay(0);
    expect(prefetch).toHaveBeenCalledOnce();
    wait.resolve();
    await Promise.all([first, second]);
    await app.prefetch("/a");
    expect(load).toHaveBeenCalledTimes(2);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("matches registration order and ignores external, unknown and current-document URLs", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { app } = await start({
      features: [
        feature(
          definePage({ path: "/items/new", prefetch: first, render: () => html`` }),
          definePage({ path: "/items/:id", prefetch: second, render: () => html`` }),
        ),
      ],
    });
    await app.prefetch("https://example.com/items/new");
    await app.prefetch("mailto:someone@example.com");
    await app.prefetch("/missing");
    await app.prefetch("/#heading");
    expect(first).not.toHaveBeenCalled();
    await app.prefetch("/items/new");
    expect(first).toHaveBeenCalledOnce();
    expect(second).not.toHaveBeenCalled();
  });

  it("does not execute guards or redirect on intent, and checks permission again on each attempt", async () => {
    const guard = vi.fn(() => redirect("/login"));
    const prefetch = vi.fn();
    const load = vi.fn();
    let allowed = false;
    const { app } = await start({
      features: [
        feature(
          definePage({ path: "/protected", guards: [guard], load, prefetch, render: () => html`` }),
          definePage({
            path: "/allowed",
            guards: [guard],
            canPrefetch: () => allowed,
            load,
            prefetch,
            render: () => html``,
          }),
        ),
      ],
    });
    await app.prefetch("/protected");
    await app.prefetch("/allowed");
    expect(load).not.toHaveBeenCalled();
    allowed = true;
    await app.prefetch("/allowed");
    expect(prefetch).toHaveBeenCalledOnce();
    allowed = false;
    await app.prefetch("/allowed");
    expect(prefetch).toHaveBeenCalledOnce();
    expect(guard).not.toHaveBeenCalled();
    expect(location.pathname).toBe("/");
  });

  it("ignores speculative errors but navigation still handles chunk failures", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const { app, host } = await start({
        features: [
          feature(
            definePage({
              path: "/broken",
              load: () => Promise.reject(new Error("chunk")),
              prefetch: () => {
                throw new Error("data");
              },
              render: () => html`broken`,
            }),
          ),
        ],
      });
      await expect(app.prefetch("/broken")).resolves.toBeUndefined();
      expect(error).not.toHaveBeenCalled();
      await app.navigate("/broken");
      expect(text(host)).toBe("home");
      expect(error).toHaveBeenCalledOnce();
    } finally {
      error.mockRestore();
    }
  });

  it("cancels short hover, preserves movement inside a link, and cleans up on disconnect", async () => {
    const prefetch = vi.fn();
    const { host } = await start({
      features: [
        defineFeature({
          name: "links",
          pages: [
            definePage({ path: "/", render: () => html`<a href="/next"><span>next</span></a>` }),
            definePage({ path: "/next", prefetch, render: () => html`` }),
          ],
        }),
      ],
    });
    const anchor = host.querySelector("a")!;
    anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true, pointerType: "mouse" }));
    anchor.dispatchEvent(new PointerEvent("pointerout", { bubbles: true }));
    await delay(80);
    expect(prefetch).not.toHaveBeenCalled();
    anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    anchor.dispatchEvent(
      new PointerEvent("pointerout", { bubbles: true, relatedTarget: anchor.firstElementChild }),
    );
    await delay(80);
    expect(prefetch).toHaveBeenCalledOnce();
    anchor.dispatchEvent(new PointerEvent("pointerover", { bubbles: true }));
    host.remove();
    await delay(80);
    expect(prefetch).toHaveBeenCalledOnce();
  });

  it("handles focus and touch through shadow DOM, ignores opt-out links, and stays inside its app", async () => {
    const prefetch = vi.fn();
    const { host } = await start({
      features: [
        defineFeature({
          name: "links",
          pages: [
            definePage({
              path: "/",
              render: () =>
                html`<div id="shadow"></div>
                  <a href="/next" data-no-prefetch>skip</a>`,
            }),
            definePage({ path: "/next", prefetch, render: () => html`` }),
          ],
        }),
      ],
    });
    const shadow = host.querySelector("#shadow")!.attachShadow({ mode: "open" });
    shadow.innerHTML = '<a href="/next">next</a>';
    shadow
      .querySelector("a")!
      .dispatchEvent(new FocusEvent("focusin", { bubbles: true, composed: true }));
    await flush(host);
    expect(prefetch).toHaveBeenCalledOnce();
    shadow
      .querySelector("a")!
      .dispatchEvent(new Event("touchstart", { bubbles: true, composed: true }));
    await flush(host);
    expect(prefetch).toHaveBeenCalledTimes(2);
    host.querySelector("a")!.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    const outside = document.createElement("a");
    outside.href = "/next";
    document.body.append(outside);
    outside.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    outside.remove();
    await flush(host);
    expect(prefetch).toHaveBeenCalledTimes(2);
  });

  it("honors Save-Data", async () => {
    const prefetch = vi.fn();
    const { app } = await start({
      features: [feature(definePage({ path: "/a", prefetch, render: () => html`` }))],
    });
    const previous = Object.getOwnPropertyDescriptor(navigator, "connection");
    Object.defineProperty(navigator, "connection", {
      value: { saveData: true },
      configurable: true,
    });
    try {
      await app.prefetch("/a");
      expect(prefetch).not.toHaveBeenCalled();
    } finally {
      if (previous) Object.defineProperty(navigator, "connection", previous);
      else Reflect.deleteProperty(navigator, "connection");
    }
  });
});

describe("shared query options", () => {
  it("joins the intent request when the page connects and does not refetch fresh data", async () => {
    const wait = deferred();
    const fetch = vi.fn(async () => {
      await wait.promise;
      return { name: "Notebook" };
    });
    const queries = ({ id }: { id: string }) => ({
      product: queryOptions({
        queryKey: ["prefetch-product", id],
        queryFn: fetch,
        staleTime: 30_000,
      }),
    });
    class ProductPage extends LitElement {
      private product = createQueryController(this, () => queries({ id: "42" }).product);
      protected override render() {
        return html`${this.product().data?.name ?? "pending"}`;
      }
    }
    customElements.define("prefetch-product-page", ProductPage);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const detail = definePage({
      path: "/products/:id",
      prefetch: prefetchQueries(({ params }) => queries(params)),
      render: ({ id }) => {
        expectTypeOf(id).toEqualTypeOf<string>();
        return html`<prefetch-product-page></prefetch-product-page>`;
      },
    });
    const { app, host } = await start({
      features: [feature(detail)],
      providers: [provide(queryClientContext, () => client)],
    });
    try {
      const intent = app.prefetch("/products/42");
      await delay(0);
      await app.navigate("/products/42");
      expect(fetch).toHaveBeenCalledOnce();
      wait.resolve();
      await intent;
      await delay(10);
      expect(host.querySelector("prefetch-product-page")!.shadowRoot?.textContent).toBe("Notebook");
      await app.navigate("/");
      await app.navigate("/products/42");
      expect(fetch).toHaveBeenCalledOnce();
    } finally {
      wait.resolve();
      client.clear();
    }
  });

  it("infers simple params and keeps complex patterns conservative", () => {
    expectTypeOf<PageParams<"/teams/:teamId/products/:id">>().toEqualTypeOf<
      { teamId: string } & { id: string }
    >();
    expectTypeOf<PageParams<"/items/:id?">["id"]>().toEqualTypeOf<string | undefined>();
    expectTypeOf<PageParams<"/files/:name.:ext">["name"]>().toEqualTypeOf<string | undefined>();
  });
});
