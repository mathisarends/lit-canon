import { describe, expect, it, vi } from "vitest";
import { createContext } from "@lit/context";
import { createApp, defineFeature, provide } from "../src/index.js";

const root = () => document.createElement("div");
let n = 0;
const tag = () => `c-root-${++n}`;

describe("container", () => {
  it("creates app providers first, then features in list order, each in declaration order", () => {
    const order: string[] = [];
    const track = (name: string) =>
      provide(createContext<string>(name), () => {
        order.push(name);
        return name;
      });
    const f1 = defineFeature({ name: "f1", pages: [], providers: [track("f1-a"), track("f1-b")] });
    const f2 = defineFeature({ name: "f2", pages: [], providers: [track("f2-a")] });
    createApp({
      root: root(),
      rootTagName: tag(),
      features: [f2, f1],
      providers: [track("app-a"), track("app-b")],
    });
    expect(order).toEqual(["app-a", "app-b", "f2-a", "f1-a", "f1-b"]);
  });

  it("lets a provider use values created before it", () => {
    const apiCtx = createContext<{ base: string }>("api");
    const serviceCtx = createContext<{ url: string }>("service");
    const f = defineFeature({
      name: "f",
      pages: [],
      providers: [provide(serviceCtx, (c) => ({ url: `${c.get(apiCtx).base}/items` }))],
    });
    const app = createApp({
      root: root(),
      rootTagName: tag(),
      features: [f],
      providers: [provide(apiCtx, () => ({ base: "/api" }))],
    });
    expect(app.container.get(serviceCtx).url).toBe("/api/items");
  });

  it("throws when a provider requests a context that is created later, naming both", () => {
    const early = createContext<number>("early");
    const late = createContext<number>("late");
    const a = defineFeature({
      name: "a",
      pages: [],
      providers: [provide(early, (c) => c.get(late) + 1)],
    });
    const b = defineFeature({ name: "b", pages: [], providers: [provide(late, () => 1)] });
    expect(() => createApp({ root: root(), rootTagName: tag(), features: [a, b] })).toThrow(
      'The provider for "early" (feature "a") requested context "late", which is not provided yet.',
    );
  });

  it("throws on get of a context nobody provides", () => {
    const app = createApp({ root: root(), rootTagName: tag(), features: [] });
    expect(() => app.container.get(createContext<number>("unknown"))).toThrow(
      'No provider registered for context "unknown".',
    );
  });

  it("creates every provider exactly once", () => {
    const ctx = createContext<object>("singleton");
    const factory = vi.fn(() => ({}));
    const app = createApp({
      root: root(),
      rootTagName: tag(),
      features: [],
      providers: [provide(ctx, factory)],
    });
    expect(app.container.get(ctx)).toBe(app.container.get(ctx));
    expect(factory).toHaveBeenCalledTimes(1);
  });
});
