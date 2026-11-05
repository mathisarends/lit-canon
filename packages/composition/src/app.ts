import { LitElement, html, type TemplateResult } from "lit";
import { Router } from "@lit-labs/router";
import { ContextProvider, type Context } from "@lit/context";
import {
  resolveProviders,
  type Container,
  type OwnedProvider,
  type ProviderDef,
} from "./container.js";
import * as errors from "./errors.js";
import type { FeatureDef } from "./feature.js";
import { isRedirect } from "./guard.js";
import type { PageDef, Params } from "./page.js";
import { IntentPrefetchController } from "./intent-prefetch.js";

export interface AppOptions {
  /** Element the root element is appended to. */
  root: Element;
  features: FeatureDef[];
  /** App-wide providers, created before any feature provider. */
  providers?: ProviderDef[];
  notFound?: () => TemplateResult;
  /** Default: `'lit-canon-root'`. */
  rootTagName?: string;
  /** E.g. `'Vizro'` turns a page title `'Browser 42'` into `'Browser 42 · Vizro'`. */
  baseTitle?: string;
  /**
   * Called when a navigation is aborted by an error, e.g. to show a toast or report it.
   * Replaces the default `console.error`. The current page stays in both cases.
   */
  onNavigationError?: (error: NavigationError) => void;
}

/** A navigation that was aborted by an error. */
export interface NavigationError {
  /** `'guard'`: a guard threw. `'load'`: `load()` rejected. `'redirect-loop'`: too many redirects. */
  reason: "guard" | "load" | "redirect-loop";
  /** The page's path pattern, e.g. `/browsers/:id`. */
  page: string;
  /** The pathname being navigated to, e.g. `/browsers/42`. */
  path: string;
  /** The thrown value, or an `Error` describing the redirect loop. */
  error: unknown;
}

export interface App {
  start(): void;
  /** `history.pushState` + routing. Resolves once the navigation (and any redirects) settled. */
  navigate(path: string): Promise<void>;
  /** Best-effort same-origin intent prefetch; does not navigate or execute guards. */
  prefetch(href: string): Promise<void>;
  container: Container;
}

/** How the navigation that is about to enter a route was started. */
interface Intent {
  /** Scroll to the top, or to the `#hash` target when there is one. */
  scroll: boolean;
  /** Scroll to the `#hash` target when there is one, but never to the top. */
  anchor: boolean;
  redirects: number;
}

const MAX_REDIRECTS = 10;
const DEFAULT_INTENT: Intent = { scroll: true, anchor: true, redirects: 0 };
/** Back/forward: the browser restores the scroll position. */
const NO_SCROLL: Intent = { scroll: false, anchor: false, redirects: 0 };
/** The first route: the browser looked for the `#hash` target before it existed. */
const INITIAL: Intent = { scroll: false, anchor: true, redirects: 0 };

/** URLPattern returns encoded groups; application inputs are decoded exactly once. */
function decodeParams(params: Params): Params {
  return Object.fromEntries(
    Object.entries(params).map(([key, value]) => {
      try {
        return [key, value === undefined ? undefined : decodeURIComponent(value)];
      } catch {
        return [key, value];
      }
    }),
  );
}

/** The element a `#hash` points to, also inside open shadow roots of rendered pages. */
function findAnchor(root: ParentNode, hash: string): Element | null {
  let id: string;
  try {
    id = decodeURIComponent(hash.slice(1));
  } catch {
    return null;
  }
  const selector = `[id="${CSS.escape(id)}"], a[name="${CSS.escape(id)}"]`;
  const search = (node: ParentNode): Element | null => {
    const found = node.querySelector(selector);
    if (found) return found;
    for (const element of node.querySelectorAll("*")) {
      const inner = element.shadowRoot && search(element.shadowRoot);
      if (inner) return inner;
    }
    return null;
  };
  return search(root);
}

export function createApp(options: AppOptions): App {
  const { features, baseTitle, rootTagName = "lit-canon-root" } = options;
  const providers = collectProviders(options);
  validate(options, providers, rootTagName);
  const { container, values } = resolveProviders(providers);
  const pages = features
    .flatMap((feature) => feature.pages)
    .map((page) => ({
      page,
      pattern: new URLPattern({ pathname: page.path }),
    }));
  const loads = new Map<PageDef, Promise<unknown>>();
  const pending = new Map<string, Promise<void>>();

  // Share chunk loads across hover and navigation; a failed load can be retried.
  const load = (page: PageDef): Promise<unknown> => {
    let task = loads.get(page);
    if (!task) {
      task = Promise.resolve().then(() => page.load?.());
      loads.set(page, task);
      void task.catch(() => loads.delete(page));
    }
    return task;
  };

  const prefetch = async (href: string): Promise<void> => {
    try {
      const connection = (navigator as Navigator & { connection?: { saveData?: boolean } })
        .connection;
      if (connection?.saveData) return;
      const url = new URL(href, location.href);
      if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      const key = url.pathname + url.search;
      const existing = pending.get(key);
      if (existing) return await existing;
      const match = pages.find(({ pattern }) => pattern.test({ pathname: url.pathname }));
      if (!match) return;
      const { page, pattern } = match;
      const ctx = {
        params: decodeParams(pattern.exec({ pathname: url.pathname })!.pathname.groups),
        path: url.pathname,
        url,
        container,
      };
      const task = (async () => {
        if (page.canPrefetch) {
          if (!(await page.canPrefetch(ctx))) return;
        } else if (page.guards?.length) return;
        await Promise.allSettled([load(page), Promise.resolve().then(() => page.prefetch?.(ctx))]);
      })();
      pending.set(key, task);
      try {
        await task;
      } finally {
        pending.delete(key);
      }
    } catch {
      // Intent must never affect navigation, including permission checks and chunk failures.
    }
  };

  let root: RootElement | undefined;
  // Set right before the router calls `enter`; link clicks leave it unset (= DEFAULT_INTENT).
  let intent: Intent | undefined;
  let navId = 0;
  let committedUrl: string | undefined;
  let scrollPending = false;
  let anchorPending = false;
  let redirectTask: Promise<void> | undefined;

  const currentUrl = () => location.pathname + location.search + location.hash;

  const setTitle = (title: string | undefined) => {
    const full =
      title !== undefined && baseTitle !== undefined
        ? `${title} · ${baseTitle}`
        : (title ?? baseTitle);
    if (full !== undefined) document.title = full;
  };

  const reportError = (error: NavigationError, message: string) => {
    if (!options.onNavigationError) {
      // The redirect-loop error only repeats the message.
      if (error.reason === "redirect-loop") console.error(message);
      else console.error(message, error.error);
      return;
    }
    try {
      options.onNavigationError(error);
    } catch (handlerError) {
      // A failing handler must not break routing.
      console.error(message, error.error, handlerError);
    }
  };

  /** Builds the router `enter` callback: guards → load → title → commit. */
  const enter =
    (page: PageDef | undefined) =>
    async (params: Params): Promise<boolean> => {
      params = decodeParams(params);
      const id = ++navId;
      const nav = intent ?? DEFAULT_INTENT;
      intent = undefined;
      const path = location.pathname;
      const stale = () => id !== navId;
      // Keep the URL in sync with the page that stays visible (link clicks push before `enter`).
      const cancel = () => {
        if (committedUrl !== undefined && currentUrl() !== committedUrl) {
          history.replaceState(history.state, "", committedUrl);
        }
        return false;
      };

      if (page) {
        for (const guard of page.guards ?? []) {
          let result;
          try {
            result = await guard({ params, path, container });
          } catch (err) {
            if (stale()) return false;
            reportError(
              { reason: "guard", page: page.path, path, error: err },
              errors.guardFailed(page.path),
            );
            return cancel();
          }
          if (stale()) return false;
          if (isRedirect(result)) {
            if (nav.redirects >= MAX_REDIRECTS) {
              const message = errors.redirectLoop(result.to, MAX_REDIRECTS);
              const error = new Error(message);
              reportError({ reason: "redirect-loop", page: page.path, path, error }, message);
              return cancel();
            }
            const to = result.to;
            const target = new URL(to, location.href);
            // Never start a navigation from inside `enter`; schedule it after this one is cancelled.
            redirectTask = new Promise((resolve) =>
              queueMicrotask(() => {
                if (stale() || !root) return resolve();
                history.replaceState(null, "", target.href);
                intent = { ...nav, redirects: nav.redirects + 1 };
                resolve(root.router.goto(target.pathname));
              }),
            );
            return false;
          }
          if (result !== true) return cancel();
        }
        try {
          // Start data early even without hover, but keep data errors and latency in the page.
          const ctx = { params, path, url: new URL(location.href), container };
          void Promise.resolve()
            .then(() => page.prefetch?.(ctx))
            .catch(() => {});
          await load(page);
        } catch (err) {
          if (stale()) return false;
          reportError(
            { reason: "load", page: page.path, path, error: err },
            errors.loadFailed(page.path),
          );
          return cancel();
        }
        if (stale()) return false;
      }

      const title = page?.title;
      setTitle(typeof title === "function" ? title({ params }) : title);
      committedUrl = currentUrl();
      scrollPending = nav.scroll;
      anchorPending = nav.anchor && location.hash.length > 1;
      return true;
    };

  const routes = features.flatMap((feature) =>
    feature.pages.map((page) => ({
      path: page.path,
      enter: enter(page),
      render: (params: Params) =>
        feature.layout
          ? feature.layout(page.render(decodeParams(params)))
          : page.render(decodeParams(params)),
    })),
  );
  const fallback = {
    enter: enter(undefined),
    render: options.notFound ?? (() => html``),
  };

  const onPopState = () => {
    intent = NO_SCROLL;
  };

  class RootElement extends LitElement {
    readonly router = new Router(this, routes, { fallback });

    constructor() {
      super();
      new IntentPrefetchController(this, prefetch);
      for (const [context, initialValue] of values) {
        new ContextProvider(this, { context: context as Context<unknown, unknown>, initialValue });
      }
    }

    // Light DOM, so the app's global styles reach pages and layouts.
    protected override createRenderRoot() {
      return this;
    }

    override connectedCallback() {
      // Registered before the router's own listener, so it runs first.
      window.addEventListener("popstate", onPopState);
      intent = INITIAL;
      super.connectedCallback();
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      window.removeEventListener("popstate", onPopState);
    }

    protected override render() {
      return this.router.outlet();
    }

    protected override updated() {
      const top = scrollPending;
      const hash = anchorPending ? location.hash : "";
      scrollPending = anchorPending = false;
      if (!hash) {
        if (top) window.scrollTo(0, 0);
        return;
      }
      const id = navId;
      // Wait a frame, so the page has rendered its own (shadow DOM) content.
      requestAnimationFrame(() => {
        if (id !== navId) return;
        const target = findAnchor(this, hash);
        if (target) target.scrollIntoView();
        else if (top) window.scrollTo(0, 0);
      });
    }
  }
  customElements.define(rootTagName, RootElement);

  return {
    container,
    prefetch,
    start() {
      if (root) return;
      root = document.createElement(rootTagName) as RootElement;
      options.root.append(root);
    },
    async navigate(path) {
      if (!root) throw errors.notStarted();
      const target = new URL(path, location.href);
      history.pushState({}, "", target.href);
      intent = DEFAULT_INTENT;
      await root.router.goto(target.pathname);
      while (redirectTask) {
        const task = redirectTask;
        redirectTask = undefined;
        await task;
      }
      await root.updateComplete;
    },
  };
}

function collectProviders(options: AppOptions): OwnedProvider[] {
  return [
    ...(options.providers ?? []).map((def) => ({ def, owner: "the app providers" })),
    ...options.features.flatMap((f) =>
      (f.providers ?? []).map((def) => ({ def, owner: `feature "${f.name}"` })),
    ),
  ];
}

function validate(options: AppOptions, providers: OwnedProvider[], rootTagName: string) {
  const names = new Set<string>();
  const paths = new Map<string, string>();
  for (const feature of options.features) {
    if (names.has(feature.name)) throw errors.duplicateFeature(feature.name);
    names.add(feature.name);
    for (const { path } of feature.pages) {
      const first = paths.get(path);
      if (first !== undefined) throw errors.duplicatePath(path, first, feature.name);
      paths.set(path, feature.name);
    }
  }
  const owners = new Map<unknown, string>();
  for (const { def, owner } of providers) {
    const first = owners.get(def.context);
    if (first !== undefined) throw errors.duplicateContext(def.context, first, owner);
    owners.set(def.context, owner);
  }
  if (customElements.get(rootTagName)) throw errors.tagTaken(rootTagName);
}
