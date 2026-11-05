# 0003: One input object per operation and grouped configuration

Status: accepted.

## Context

In 1.x, generated API functions took Orval's positional parameters
(`updateProduct(productId, request, headers, options)`), while mutation options took
one object with the same values under parameter names (`{ productId, request }`).
Calls, query options and mutations used three different shapes for the same
operation, and the property names came from Orval's internals (`params`, `request`).

Query keys came from `<resource>Keys`, defined inside `queries.ts`, and only existed
for queries. A key without inputs ended in `null`, so it could not invalidate every
query of one operation. Mutations had keys written inline.

The configuration had grown flat options that belonged together (`excludeTags` and
`defaultTag`), a request module option with re-export lists, and
`mutationOperations` that could only turn a GET into a mutation.

## Decision

- Every operation takes one `<Operation>Input` object: path parameters under their
  camelCase name, query parameters under their own name, `body` for the request body
  and `headers` for header parameters. API functions, query options and mutations
  share it. A field collision fails at generation time.
- `apiFetch` receives one request descriptor plus per-call `ApiRequestOptions`:
  `{ method, path, query, headers, body, contentType }`. Header parameters are
  layered between configured headers and per-call headers.
- Each resource writes `keys.ts` with `keys`. Called without input, a query key is
  the `[tag, operation]` prefix; with input it is `[tag, operation, input]`.
  Mutations get `[tag, operation]` keys.
- Configuration groups options: `runtime`, `tags: { exclude, fallback }`,
  `operations: { name: "query" | "mutation" }`, `preserve` and
  `problems: "auto" | boolean`. Renamed options fail with their replacement.
  `defineConfig` is not generic, so typos fail the type check.
- Resource barrels no longer re-export runtime symbols; apps import them from the
  runtime package.
- `lit-canon-fetch` defaults to `credentials: "same-origin"`, the `fetch` default.

## Consequences

This is a breaking 2.0 release for both API packages; the
[migration guide](../migration.md#from-lit-canon-api-1x-to-20) lists every change.
Call sites read the same everywhere, and TypeScript finds each one that needs
updating. Query keys changed shape, so persisted caches from 1.x do not match.
Generated code no longer depends on Orval's parameter names, which narrows the
surface an Orval upgrade can change.

[All documentation](../README.md)
