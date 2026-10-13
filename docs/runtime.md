# Fetch runtime

Configure request defaults once during application startup, then use the generated
API functions or query/mutation options.

## Configure requests

Generated clients use `lit-query-codegen/runtime` by default. This module has no
Orval, Node.js or Vite dependencies.

```ts
import { configureApiFetch } from "lit-query-codegen/runtime";

configureApiFetch({ baseUrl: "https://api.example.com" });
```

Without configuration, requests use relative API paths and send cookies with
`credentials: "include"`. You can configure default `headers`, `credentials` and
a custom `fetch` implementation. `createApiFetch(config)` creates an independent
fetch mutator for separate API clients or server-side use.

The mutator serializes plain objects, arrays and `null` as JSON. `FormData` and
other native request bodies are passed through. Query arrays use repeated
parameters; `undefined` values are omitted and `null` is sent as the string
`"null"`. Successful responses return the body, or `undefined` for an empty
response. HTTP failures throw `ApiError` with a `status` and optional RFC 9457
problem details.

To use an existing fetch mutator, configure its path:

```ts
import { defineConfig } from "lit-query-codegen";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
  request: {
    path: "./src/api/request.ts",
    exports: ["ApiError"],
    typeExports: ["ApiProblem", "ApiRequestOptions"],
  },
});
```

The module must export `apiFetch<T>(url, options): Promise<T>` and
`ApiRequestOptions`. The options contain an unserialized `body`, a `query` object
and fetch options. Feature entry points also export `ApiError`, `ApiProblem` and
`ApiRequestOptions` by default. Adjust `exports` and `typeExports`, or set them to
`[]`, if your mutator exposes different symbols.

## Handle HTTP errors

```ts
import { ApiError } from "lit-query-codegen/runtime";
import { products } from "./api/generated";

try {
  await products.getProduct("p-1");
} catch (error) {
  if (error instanceof ApiError) {
    console.error(error.status, error.problem?.detail ?? error.message);
  } else {
    throw error;
  }
}
```

`ApiError.problem` is `null` when the error body is not a recognized problem object.
The runtime recognizes a problem by string `type` and `title` fields and a numeric
`status`. It preserves the HTTP status even when the error body is malformed.
Network failures and aborts propagate from `fetch`.

Successful JSON responses are parsed for `application/json` and `+json` content
types. Other non-empty responses return text. Empty bodies, 204/205 responses and
HEAD responses return `undefined`.

Per-request headers override configured headers. Per-request credentials override
the configured credentials. Query factories forward TanStack's `AbortSignal`, even
when feature request options include a different signal.

For generated problem types and feature error helpers, see
[configuration](configuration.md#project-specific-rules).

[All documentation](README.md)
