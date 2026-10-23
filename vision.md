# Canon — Vision

## The problem

Coding agents are fast, but they are not consistent. Ask an agent to build two apps for two different domains and you get two different architectures: different routers, different folder layouts, data fetched in components here and in services there, loading states drawn three different ways, forms validated by hand in one place and by a schema library in another.

None of these choices is wrong on its own. The problem is that the agent did not _choose_ them. It sampled them from its training data. Every open decision in a codebase is a place where the output varies from run to run, from feature to feature, and from app to app.

That variance has a cost. Every app has to be learned again, by people and by agents. Reviews turn into arguments about style instead of behavior. Fixes and improvements don't transfer, because no two apps share a shape.

## The idea

**Canon is a set of libraries, tools and rules that close those open decisions.**

An app built with Canon has one way to register a page, one way to inject a service, one way to load server data, one way to name a query key, one way to show a loading state. The domain changes from app to app. The form does not.

The goal is that an agent, or a developer, opening any Canon app knows where everything is before reading a line of it, and that an agent adding a feature produces the same code it would have produced in any other Canon app.

## Principles

**Close decisions, don't add options.** Canon is opinionated by design. Every configuration option is a new decision point, and decision points are what Canon exists to remove. When in doubt, pick one way and document why.

**Build on the platform and on proven building blocks.** Canon is a thin layer over Lit, Web Components, TanStack Query and OpenAPI. It wires them together in one fixed way. It does not reinvent them.

**Explicit over magic.** Features are listed, not discovered. Generated code is readable and committed. There is no hidden runtime behavior that an agent has to guess at.

**Enforce, don't just document.** A rule that only lives in a README will eventually be ignored. Where possible, the canon is enforced by types, generators, lint rules and CI checks, so the wrong way fails loudly.

**One source of truth across the stack.** The backend's OpenAPI contract is where frontend types, clients, query keys and, eventually, validation schemas come from. Nothing is written twice.

**Small and boring.** Each library should be small enough to read in one sitting. If a piece grows large, the scope is wrong.

**Extract, don't speculate.** A pattern becomes a library only after it has appeared in real apps. Until then, it is a documented decision.

## The pieces

```
Backend (FastAPI)                         Frontend (Lit)
─────────────────                         ──────────────
fastapi-canon  ──►  OpenAPI contract  ──►  lit-canon-api    (codegen)
                                               │
                                               ▼
                                          lit-canon-fetch   (runtime)
                                               │
                                               ▼
                                          lit-canon-composition   (app composition)
                                               │
                                               ▼
                                          scaffold · lint rules · reference app · AGENTS.md
```

### Available or in progress

| Piece                     | Responsibility                                                                                                               |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| **lit-canon-composition** | App composition: pages, features, layouts, guards, titles, lazy loading, dependency injection over Lit context.              |
| **lit-canon-api**         | Generates a typed API client, query/mutation options and query-key factories for TanStack Lit Query from an OpenAPI spec.    |
| **lit-canon-fetch**       | The small browser runtime behind generated clients: requests, auth headers, typed problem details.                           |
| **fastapi-canon**         | The backend counterpart: the canonical shape of a FastAPI service, including the OpenAPI conventions the frontend relies on. |

### The contract

The two halves of the stack meet in the OpenAPI document. A Canon backend guarantees, and a Canon frontend relies on:

- exactly one tag per operation, used as the resource name
- an explicit `operationId` for every operation
- errors as RFC 9457 problem details
- request and response bodies described by named schemas

This contract is what turns "add an endpoint, use it in the UI" into a mechanical step: write the endpoint, export the spec, regenerate, use the generated query.

### Next

These are the decision points where agents vary most after routing and data loading. They are listed in the order we expect to address them:

1. **Async UI states.** One way to render pending, error, empty and success for any query result.
2. **Forms and validation.** One form controller, with validation schemas generated from the same OpenAPI request schemas as the client types.
3. **Scaffold and generators.** `create-lit-canon` for new projects, and commands like `add feature` and `add page`, so agents generate structure instead of inventing it.
4. **Lint rules.** Enforcement of the canon: no `fetch` in components, no hand-written query keys, no imports across feature boundaries.
5. **Shared tooling config.** One Vite, TypeScript, ESLint and Prettier setup.
6. **Testing conventions.** One test runner, one pattern for page tests, one for end-to-end tests.
7. **Decisions without libraries:** client-side state, the component library, styling and design tokens, authentication flow. These get written down and enforced, not necessarily packaged.
8. **Realtime.** One channel abstraction for WebSockets or server-sent events that feeds the query cache.

### How agents learn the canon

Libraries alone don't make agents consistent. Every Canon project ships with:

- **an `AGENTS.md`** from the scaffold: the hard rules and a "where does X go?" table, short enough to be read in full every time;
- **a reference app** that shows each pattern exactly once, done right;
- **generators**, so the agent calls a command instead of writing boilerplate;
- **checks in CI**: typecheck, lint, and `lit-canon-api check` for contract drift.

## Non-goals

- **Canon is not a framework.** There is no compiler, no custom file format, no runtime beyond small, separable libraries. Every piece can be adopted, or dropped, on its own.
- **No server-side rendering, no meta-framework features** such as route-level data loaders, file-based routing or edge rendering.
- **Not for every app.** Canon targets authenticated, data-driven single-page applications backed by an API: dashboards, admin tools, internal products. Content sites and marketing pages are better served elsewhere.
- **No configuration for taste.** If two teams want different styles, Canon is not the place to reconcile them.

## What success looks like

- Two Canon apps for unrelated domains are structurally indistinguishable. A diff of their `src/` trees shows different feature names and nothing else.
- An agent asked to add a page, an endpoint-backed list or a form produces code that passes review without style comments.
- Changing a backend endpoint breaks the frontend build in exactly the places that use it, and nowhere else.
- A new person or agent can make a correct change in an unfamiliar Canon app after reading only its `AGENTS.md`.
- Each library stays small enough that reading its source is a reasonable way to understand it.

## Roadmap

| Phase              | Outcome                                                                                                                                                          |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **1. Foundations** | `lit-canon-composition` v1 and `lit-canon-api` / `lit-canon-fetch` v1 released. The OpenAPI contract is written down and shared with fastapi-canon.              |
| **2. Proof**       | One real app built end to end on Canon. Every place where agents still vary is recorded.                                                                         |
| **3. Enforcement** | Scaffold, generators, lint rules, shared config and a reference app.                                                                                             |
| **4. Coverage**    | Async UI states and forms, then whatever phase 2 showed to vary most.                                                                                            |
| **5. Second app**  | A second app in a different domain. Anything duplicated between the two is a candidate for extraction; anything that differs structurally is a gap in the canon. |
