# 0002: Shared query options and speculative page prefetch

Status: accepted.

## Context

Pages already observe generated options through the app's context-provided
QueryClient. Hovering a link can start both its lazy chunk and its initial queries,
but repeating the queries in route handlers would let arguments and freshness
policies drift. OpenAPI describes operations, not which frontend page needs them.

## Decision

- Keep API generation independent of application routes. A separate one-time
  `add-page` scaffold accepts explicit query selection and API-to-route bindings.
- Scaffold a shared named query-options factory, a lazy page, a route descriptor
  and an explicit feature registration. These are editable application files.
- Give composition a generic speculative `prefetch` hook and one intent controller
  per app root. An optional `/query` adapter uses the existing QueryClient.
- Start chunk and data together. Real navigation waits for its chunk and leaves
  data loading/errors to page controllers. No second cache or blocking data loader.
- Never run navigation guards on hover. Guarded routes need a separate read-only
  `canPrefetch` check to opt into speculation.
- Infer required string params for simple `/:name` segments; keep complex
  URLPattern segments conservatively typed.

## Consequences

Route, intent and page share query identities and freshness policy. Links stay
ordinary anchors. App registration remains explicit. Regeneration can run safely
without replacing UI work. The first scaffold supports string route bindings and
optional API inputs; more complex mapping remains visible application code.

The [reference app](../../examples/catalog/prefetch/README.md) demonstrates the
scaffolded shape and the [guide](../prefetching.md) documents its contract.
