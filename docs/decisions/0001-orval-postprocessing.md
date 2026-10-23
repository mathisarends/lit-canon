# 0001: Generate with Orval and post-process its output

- Status: accepted
- Date: 2026-10-23

## Context

`lit-canon-api` turns an OpenAPI document into typed request functions, models,
query and mutation options and query-key factories for TanStack Lit Query.

Orval already solves the hard part of that job: reading OpenAPI 3, resolving
references, naming types and writing TypeScript models and fetch functions. It has
TanStack Query clients for React, Vue, Svelte, Solid and Angular, but none for Lit.
Its fetch output also follows Orval's own conventions (request shape, response
wrapper, parameter names) instead of the ones the canon prescribes.

The options were:

1. Write a generator from scratch on top of an OpenAPI parser.
2. Use Orval's output as it is and write the Lit Query layer by hand.
3. Let Orval generate a plain fetch client and transform that output.

## Decision

Option 3. For each OpenAPI tag, Orval writes a split fetch client into a temporary
directory next to the output. `lit-canon-api` then:

- rewrites the generated request functions with the TypeScript compiler API, so
  they call `apiFetch` from `lit-canon-fetch` with encoded paths, a `query` object
  and an unserialized `body`;
- renders the query-key factory, query options, mutation options and optional
  problem types itself, from the transformed functions and the OpenAPI operations;
- validates names and unsupported inputs, formats with Prettier and replaces the
  output directory only when every step has succeeded.

The Orval version is pinned exactly. The transformation expects a specific shape of
Orval's TypeScript output and fails with an explicit error ("Unexpected generated
API declaration", "Unexpected Orval request option") when that shape changes.

## Consequences

- Model naming, reference resolution and schema coverage come from a mature tool
  that is maintained by others.
- The Lit-specific layer stays small and readable, which matches the canon's
  "small and boring" principle.
- Upgrading Orval is a generator change: bump the pinned version, run the generator
  tests and review the catalog output diff. A silent change in output is not
  possible, because the transformation rejects shapes it does not know.
- Inputs Orval accepts but the transformation does not support, such as header
  parameters or non-`form` query serialization, are rejected before any file is
  replaced. See [OpenAPI requirements](../openapi.md).
- The browser runtime, `lit-canon-fetch`, has no dependency on Orval or Node.js.

[All documentation](../README.md)
