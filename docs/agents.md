# Agent guide

Use this page when changing this repository as a coding agent, or when writing app
code that uses the generated client. Human contributors can use the same workflow.

## Canonical usage in apps

Apps that use `lit-canon-api` follow these rules. Do not invent alternatives.

- **Generate, never hand-write.** Run `lit-canon-api generate` after the OpenAPI
  document changes. Never edit files under the generated directory. Run
  `lit-canon-api check` in CI.
- **One QueryClient, provided through context.** In lit-canon apps:
  `provide(queryClientContext, () => new QueryClient())` in `createApp`. Elsewhere:
  `QueryClientProvider`. Components and services never create a client.
- **Controllers without a client argument.** Pass the generated options:
  `createQueryController(this, () => products.getProductQuery(id))`.
- **No `fetch` in components.** Server data comes from generated query and mutation
  options, or from generated API functions when no cache is involved.
- **Query keys come from the key factory.** Invalidate with `<resource>Keys.all` or
  `<resource>Keys.<operation>(...)`; never write key arrays by hand.
- **Invalidate in mutation callbacks with the client TanStack passes:**
  `onSuccess: (_data, _variables, _result, { client }) => client.invalidateQueries({ queryKey: products.productsKeys.all })`.
- **Mutations take one object**, named after the API function's parameters:
  `mutate({ productId, request })`.
- **Request defaults live in `configureApiFetch`**, called once at startup: base URL,
  credentials and headers. Auth headers use a (possibly async) header function.
- **Call-site options stay at the call site**: spread `enabled`, `staleTime` or
  `select` next to the generated options.
- **Errors are `ApiError`** with `status` and RFC 9457 `problem`; use the generated
  `is<Resource>Error` guard when problem types are generated.

The full example is in [Using the client in a lit-canon app](lit-canon.md).

## Before changing this repository

1. Read the task and inspect `git status --short` so you can preserve unrelated work.
2. Read [architecture](architecture.md) and the relevant source files. Generator
   configuration types live in
   [packages/api/src/config.ts](../packages/api/src/config.ts); commands live in the
   root [package.json](../package.json) and each package's `package.json`.
3. Find related tests and examples before choosing an implementation. Prefer the
   existing patterns and keep the change within the requested scope.

## Behaviors to preserve

- Generated files belong to the generator. Change the input, config or renderer,
  then regenerate; keep handwritten code outside generated output.
- Generation stages output before replacement. Validation failures must leave the
  existing client intact. Keep ownership checks and symlink rejection in place.
- `check` compares without replacing the client. Preserved output directories are
  excluded from comparison and kept during `generate`.
- Each resource exports `<resource>Keys` with `all` plus one function per query.
  Query keys are `[tag, operation, ...inputs]`, with `null` for omitted optional
  inputs. Query factories forward TanStack's `AbortSignal`.
- Mutation options take no variables for zero inputs and one object otherwise.
- `features` and `queryAliases` stay removed and fail with a pointer to
  [migration](migration.md). Generated code contains no application code.
- `lit-canon-fetch` omits `null` and `undefined` query values and has no
  dependencies. It stays independent of Orval and Node.js tooling.
- No package depends on `lit-canon-composition`, and the composition package does
  not depend on the API packages.
- Unsupported OpenAPI serialization and generated name collisions fail explicitly.
  See [OpenAPI requirements](openapi.md).
- Orval is pinned because the renderers depend on its generated AST. Treat an
  upgrade as a generator change and review the resulting output.
- Out of scope for 1.0: infinite queries, runtime schema validation (such as Zod)
  and controller wrappers.

## Verify the change

Use the check table in [development](development.md#choose-the-right-check). For
generator changes, the usual commands are:

```bash
pnpm test
pnpm typecheck
pnpm example:check
pnpm format:check
```

Add `pnpm test:package` when changing packaging, exports or CLI loading. If the
catalog output intentionally changes, run `pnpm example:generate`, review the
generated diff, then repeat `example:check` and `typecheck`.

For documentation-only changes, check formatting, local links and consistency with
the implementation. Format the changed files without reformatting unrelated work.

## Hand off the result

Review `git diff` and `git status --short`. Update the relevant documentation when
changing public behavior. Describe what changed, which checks ran and any remaining
limitations. Do not claim verification that was not performed.

[All documentation](README.md)
