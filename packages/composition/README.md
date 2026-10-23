# lit-canon-composition

A thin, opinionated layer over [Lit](https://lit.dev) that gives single-page apps one canonical shape: **register pages, bundle them into features, compose features into an app.**

## Motivation

Lit gives you components, but not an answer to "where does routing, dependency injection and page registration go?". `lit-canon-composition` borrows the feature-slice pattern from FastAPI projects: every feature exports exactly one object, and the app holds an **explicit list** of those objects. There is no auto-discovery and no magic. It invents nothing either. It wires together [`@lit-labs/router`](https://www.npmjs.com/package/@lit-labs/router) (URL → template, lazy loading, link interception), [`@lit/context`](https://lit.dev/docs/data/context/) (dependency injection) and `lit` itself, in a few hundred lines.

## Installation

```sh
pnpm add lit-canon-composition lit @lit-labs/router @lit/context
```

`lit`, `@lit-labs/router` and `@lit/context` are peer dependencies. The package is ESM only, and the library itself uses no decorators, so it works with `experimentalDecorators` and with standard decorators.

### URLPattern polyfill

The router matches paths with [`URLPattern`](https://developer.mozilla.org/en-US/docs/Web/API/URLPattern). If you support browsers without it, load [`urlpattern-polyfill`](https://www.npmjs.com/package/urlpattern-polyfill) before your app starts:

```ts
import "urlpattern-polyfill";
```

## Example

```ts
// main.ts
import { html } from "lit";
import { createApp, provide } from "lit-canon-composition";
import { apiCtx, FakeApiClient } from "./api.js";
import { authFeature } from "./features/auth/index.js";
import { browsersFeature } from "./features/browsers/index.js";

const FEATURES = [authFeature, browsersFeature];

createApp({
  root: document.querySelector("#app")!,
  features: FEATURES,
  providers: [provide(apiCtx, () => new FakeApiClient())],
  notFound: () => html`<not-found-page></not-found-page>`,
  baseTitle: "Example",
}).start();
```

```ts
// features/browsers/index.ts
export const browserDetail = definePage({
  path: "/browsers/:id",
  load: () => import("./pages/browser-detail-page.js"),
  render: ({ id }) => html`<browser-detail-page .params=${{ id }}></browser-detail-page>`,
  title: ({ params }) => `Browser ${params.id}`,
  guards: [requireAuth],
});

export const browsersFeature = defineFeature({
  name: "browsers",
  pages: [browserList, browserDetail],
  layout: shellLayout,
  providers: [provide(browserServiceCtx, (c) => new BrowserService(c.get(apiCtx)))],
});
```

Pages are plain `LitElement`s. They consume services with `@consume` (or `ContextConsumer`) from `@lit/context` and load their own data, for example with `@lit/task`.

The full app (login, guarded lazy detail page, shell layout) lives in [`examples/basic`](examples/basic). Run it from the repository root with:

```sh
pnpm install
pnpm --filter lit-canon-composition example
```

## API reference

### `definePage(def: PageDef): PageDef`

```ts
interface PageDef {
  path: string; // URLPattern pathname syntax, e.g. '/browsers/:id'
  render: (params: Params) => TemplateResult;
  load?: () => Promise<unknown>; // lazy import, run before rendering
  title?: string | ((ctx: { params: Params }) => string);
  guards?: Guard[];
}
type Params = Record<string, string | undefined>;
```

An identity function, for type inference and readability. It returns `def` (frozen). Validation happens in `createApp`.

### `defineFeature(def: FeatureDef): FeatureDef`

```ts
interface FeatureDef {
  name: string;
  pages: PageDef[];
  layout?: Layout;
  providers?: ProviderDef[];
}
type Layout = (content: TemplateResult) => TemplateResult;
```

Also an identity function. A `layout` wraps **every** page of the feature:

```ts
const shellLayout: Layout = (content) => html`<app-shell>${content}</app-shell>`;
```

### `provide(context, factory): ProviderDef`

```ts
function provide<T>(context: Context<unknown, T>, factory: (c: Container) => T): ProviderDef<T>;

interface Container {
  get<T>(context: Context<unknown, T>): T;
}
```

`context` is created with `createContext` from `@lit/context`. Providers are created **eagerly** when `createApp` runs, in this order: `options.providers`, then the providers of each feature in the order of `options.features`, each in declaration order. A factory can `c.get()` any context created before it. Asking for a later or unknown context throws an error that names the context and the asking provider. Every provider is a singleton for the app's lifetime.

All values are provided on the root element, so **every** page can consume them, no matter which feature declared the provider. Feature providers are for organisation, not encapsulation.

### `redirect(to: string)` and `Guard`

```ts
type Guard = (ctx: {
  params: Params;
  path: string; // pathname being navigated to, e.g. '/browsers/42'
  container: Container;
}) => GuardResult | Promise<GuardResult>;

type GuardResult = boolean | Redirect; // Redirect = ReturnType<typeof redirect>
```

Guards run sequentially, in declaration order, before `load`:

- `true`: continue with the next guard.
- `false`: cancel. The current page stays. If the URL was already changed (e.g. by a link click), it is put back.
- `redirect('/login')`: cancel and navigate to the target, **replacing** the history entry. Redirects are scheduled after the cancelled navigation, never started from inside it. After 10 consecutive redirects the navigation is aborted and an error is logged.

A guard that throws is logged with `console.error` and cancels the navigation.

```ts
export const requireAuth: Guard = ({ container, path }) =>
  container.get(authCtx).user ? true : redirect(`/login?next=${encodeURIComponent(path)}`);
```

### `createApp(options: AppOptions): App`

```ts
interface AppOptions {
  root: Element; // the root element is appended here
  features: FeatureDef[];
  providers?: ProviderDef[]; // app-wide providers
  notFound?: () => TemplateResult; // default: empty template
  rootTagName?: string; // default: 'lit-canon-root'
  baseTitle?: string; // 'Browser 42' → 'Browser 42 · Example'
}

interface App {
  start(): void;
  navigate(path: string): Promise<void>;
  container: Container;
}
```

`createApp` throws right away on a duplicate `path` (naming both features), a duplicate feature name, a context provided twice, or a `rootTagName` that is already a registered custom element.

- **Routes** are `features.flatMap(f => f.pages)`, matched in that order. `notFound` is the router's fallback.
- **Entering a route:** guards → `load()` → title → render. If `load` rejects, the error is logged with the page path and the navigation is cancelled. When several navigations overlap (say a slow async guard and a second click), the latest one wins.
- **Titles:** set after `load`. With `baseTitle`: `"{title} · {baseTitle}"`. Without `title`: just `baseTitle`. Without both, `document.title` is left alone.
- **Scrolling:** after a new route renders, the window scrolls to the top. Back/forward (`popstate`) and the initial load do not scroll.
- **Links:** `<a href>` clicks are handled by `@lit-labs/router`. lit-canon-composition adds no click handler.
- `start()` appends the root element and routes the current URL. The root element renders into light DOM, so global styles reach layouts and pages.
- `navigate(path)` does `history.pushState` and routes. It resolves once the navigation, including any redirects, has rendered. `path` may include a query string and hash.

## Not included (v1)

Route-level data loaders, nested routes or layouts, typed params and `href()` helpers, a query-param API, transitions, prefetching, breadcrumbs, meta tags, SSR, i18n, a page base class, and lazy or cyclic provider resolution are all left out on purpose.

## Development

From the repository root:

```sh
pnpm --filter lit-canon-composition test        # Vitest browser mode, headless Chromium
pnpm --filter lit-canon-composition typecheck
pnpm --filter lit-canon-composition build       # emits dist/
```

See [development](../../docs/development.md) for the workspace setup.
