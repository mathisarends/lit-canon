import { LitElement, html, type TemplateResult } from 'lit';
import { Router } from '@lit-labs/router';
import { ContextProvider, type Context } from '@lit/context';
import { resolveProviders, type Container, type OwnedProvider, type ProviderDef } from './container.js';
import * as errors from './errors.js';
import type { FeatureDef } from './feature.js';
import { isRedirect } from './guard.js';
import type { PageDef, Params } from './page.js';

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
}

export interface App {
  start(): void;
  /** `history.pushState` + routing. Resolves once the navigation (and any redirects) settled. */
  navigate(path: string): Promise<void>;
  container: Container;
}

/** How the navigation that is about to enter a route was started. */
interface Intent {
  scroll: boolean;
  redirects: number;
}

const MAX_REDIRECTS = 10;
const DEFAULT_INTENT: Intent = { scroll: true, redirects: 0 };
const NO_SCROLL: Intent = { scroll: false, redirects: 0 };

export function createApp(options: AppOptions): App {
  const { features, baseTitle, rootTagName = 'lit-canon-root' } = options;
  const providers = collectProviders(options);
  validate(options, providers, rootTagName);
  const { container, values } = resolveProviders(providers);

  let root: RootElement | undefined;
  // Set right before the router calls `enter`; link clicks leave it unset (= DEFAULT_INTENT).
  let intent: Intent | undefined;
  let navId = 0;
  let committedUrl: string | undefined;
  let scrollPending = false;
  let redirectTask: Promise<void> | undefined;

  const currentUrl = () => location.pathname + location.search + location.hash;
  const pathnameOf = (path: string) => new URL(path, location.href).pathname;

  const setTitle = (title: string | undefined) => {
    const full = title !== undefined && baseTitle !== undefined ? `${title} · ${baseTitle}` : (title ?? baseTitle);
    if (full !== undefined) document.title = full;
  };

  /** Builds the router `enter` callback: guards → load → title → commit. */
  const enter = (page: PageDef | undefined) => async (params: Params): Promise<boolean> => {
    const id = ++navId;
    const nav = intent ?? DEFAULT_INTENT;
    intent = undefined;
    const path = location.pathname;
    const stale = () => id !== navId;
    // Keep the URL in sync with the page that stays visible (link clicks push before `enter`).
    const cancel = () => {
      if (committedUrl !== undefined && currentUrl() !== committedUrl) {
        history.replaceState(history.state, '', committedUrl);
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
          console.error(errors.guardFailed(page.path), err);
          return cancel();
        }
        if (stale()) return false;
        if (isRedirect(result)) {
          if (nav.redirects >= MAX_REDIRECTS) {
            console.error(errors.redirectLoop(result.to, MAX_REDIRECTS));
            return cancel();
          }
          const to = result.to;
          // Never start a navigation from inside `enter`; schedule it after this one is cancelled.
          redirectTask = new Promise((resolve) =>
            queueMicrotask(() => {
              if (stale() || !root) return resolve();
              history.replaceState(null, '', to);
              intent = { scroll: nav.scroll, redirects: nav.redirects + 1 };
              resolve(root.router.goto(pathnameOf(to)));
            }),
          );
          return false;
        }
        if (result !== true) return cancel();
      }
      try {
        await page.load?.();
      } catch (err) {
        if (stale()) return false;
        console.error(errors.loadFailed(page.path), err);
        return cancel();
      }
      if (stale()) return false;
    }

    const title = page?.title;
    setTitle(typeof title === 'function' ? title({ params }) : title);
    committedUrl = currentUrl();
    scrollPending = nav.scroll;
    return true;
  };

  const routes = features.flatMap((feature) =>
    feature.pages.map((page) => ({
      path: page.path,
      enter: enter(page),
      render: (params: Params) =>
        feature.layout ? feature.layout(page.render(params)) : page.render(params),
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
      window.addEventListener('popstate', onPopState);
      intent = NO_SCROLL; // initial navigation
      super.connectedCallback();
    }

    override disconnectedCallback() {
      super.disconnectedCallback();
      window.removeEventListener('popstate', onPopState);
    }

    protected override render() {
      return this.router.outlet();
    }

    protected override updated() {
      if (scrollPending) {
        scrollPending = false;
        window.scrollTo(0, 0);
      }
    }
  }
  customElements.define(rootTagName, RootElement);

  return {
    container,
    start() {
      if (root) return;
      root = document.createElement(rootTagName) as RootElement;
      options.root.append(root);
    },
    async navigate(path) {
      if (!root) throw errors.notStarted();
      history.pushState({}, '', path);
      intent = DEFAULT_INTENT;
      await root.router.goto(pathnameOf(path));
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
    ...(options.providers ?? []).map((def) => ({ def, owner: 'the app providers' })),
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
