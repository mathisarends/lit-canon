import { describe, expect, it, vi } from "vitest";
import { html } from "lit";
import { createContext } from "@lit/context";
import { defineFeature, definePage, provide, redirect, type Guard } from "../src/index.js";
import { back, delay, flush, start, text } from "./helpers.js";

const page = (path: string, guards: Guard[] = []) =>
  definePage({ path, guards, render: () => html`<p>${path} <a href="/guarded">link</a></p>` });

const feature = (...pages: ReturnType<typeof page>[]) =>
  defineFeature({ name: "f", pages: [page("/"), page("/login"), ...pages] });

describe("guards", () => {
  it("runs guards sequentially in declaration order", async () => {
    const events: string[] = [];
    const guard =
      (name: string, ms: number): Guard =>
      async () => {
        events.push(`${name} start`);
        await delay(ms);
        events.push(`${name} end`);
        return true;
      };
    const { app, host } = await start({
      features: [feature(page("/guarded", [guard("slow", 20), guard("fast", 1)]))],
    });
    await app.navigate("/guarded");
    expect(events).toEqual(["slow start", "slow end", "fast start", "fast end"]);
    expect(text(host)).toContain("/guarded");
  });

  it("stops at the first false and stays on the current page", async () => {
    const second = vi.fn(() => true);
    const { app, host } = await start({
      features: [feature(page("/guarded", [() => false, second]))],
    });
    await app.navigate("/guarded");
    expect(second).not.toHaveBeenCalled();
    expect(text(host)).toContain("/ link");
    expect(location.pathname).toBe("/");
  });

  it("restores the URL when a guard cancels a link click", async () => {
    const { host } = await start({ features: [feature(page("/guarded", [() => false]))] });
    host.querySelector("a")!.click();
    await flush(host);
    expect(location.pathname).toBe("/");
    expect(text(host)).toContain("/ link");
  });

  it("supports async guards", async () => {
    const { app, host } = await start({
      features: [feature(page("/guarded", [() => delay(10).then(() => true)]))],
    });
    await app.navigate("/guarded");
    expect(text(host)).toContain("/guarded");
  });

  it("passes params, path and container to guards", async () => {
    const authCtx = createContext<{ user: string }>("auth");
    const guard = vi.fn<Guard>(() => true);
    const { app } = await start({
      features: [feature(page("/guarded/:id", [guard]))],
      providers: [provide(authCtx, () => ({ user: "ada" }))],
    });
    await app.navigate("/guarded/9");
    const ctx = guard.mock.calls[0]![0];
    expect(ctx.params).toEqual({ id: "9" });
    expect(ctx.path).toBe("/guarded/9");
    expect(ctx.container.get(authCtx).user).toBe("ada");
  });

  it("redirects and replaces the history entry", async () => {
    const { app, host } = await start({
      features: [
        feature(page("/other"), page("/guarded", [() => redirect("/login?next=/guarded")])),
      ],
    });
    await app.navigate("/other");
    const length = history.length;
    await app.navigate("/guarded");
    expect(text(host)).toContain("/login");
    expect(location.pathname + location.search).toBe("/login?next=/guarded");
    expect(history.length).toBe(length + 1);
    // Back skips the replaced /guarded entry.
    await back(host);
    expect(location.pathname).toBe("/other");
  });

  it("follows redirects triggered by link clicks", async () => {
    const { host } = await start({
      features: [feature(page("/guarded", [() => redirect("/login")]))],
    });
    host.querySelector("a")!.click();
    await flush(host);
    await flush(host);
    expect(location.pathname).toBe("/login");
    expect(text(host)).toContain("/login");
  });

  it("aborts redirect loops after 10 redirects", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const ping = vi.fn(() => redirect("/pong"));
    const pong = vi.fn(() => redirect("/ping"));
    const { app, host } = await start({
      features: [feature(page("/ping", [ping]), page("/pong", [pong]))],
    });
    await app.navigate("/ping");
    expect(ping.mock.calls.length + pong.mock.calls.length).toBe(11);
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining("more than 10 consecutive redirects"),
    );
    expect(text(host)).toContain("/ link");
    expect(location.pathname).toBe("/");
    error.mockRestore();
  });

  it("resets the redirect count after a successful navigation", async () => {
    let hops = 0;
    const chain: Guard = () => (++hops % 6 === 0 ? true : redirect("/chain"));
    const { app, host } = await start({ features: [feature(page("/chain", [chain]))] });
    await app.navigate("/chain"); // 5 redirects, then success
    await app.navigate("/chain"); // 5 more: would exceed 10 if not reset
    expect(hops).toBe(12);
    expect(text(host)).toContain("/chain");
  });

  it("logs and aborts when a guard throws", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("boom");
    const { app, host } = await start({
      features: [feature(page("/guarded", [() => Promise.reject(failure)]))],
    });
    await app.navigate("/guarded");
    expect(text(host)).toContain("/ link");
    expect(error).toHaveBeenCalledWith(expect.stringContaining('"/guarded"'), failure);
    error.mockRestore();
  });

  it("does not run load when a guard cancels", async () => {
    const load = vi.fn(async () => {});
    const guarded = definePage({
      path: "/guarded",
      guards: [() => false],
      load,
      render: () => html``,
    });
    const { app } = await start({
      features: [defineFeature({ name: "f", pages: [page("/"), guarded] })],
    });
    await app.navigate("/guarded");
    expect(load).not.toHaveBeenCalled();
  });

  it("lets the latest navigation win over a slower earlier one", async () => {
    const { app, host } = await start({
      features: [feature(page("/slow", [() => delay(40).then(() => true)]), page("/fast"))],
    });
    const slow = app.navigate("/slow");
    await app.navigate("/fast");
    await slow;
    expect(text(host)).toContain("/fast");
    expect(location.pathname).toBe("/fast");
  });
});
