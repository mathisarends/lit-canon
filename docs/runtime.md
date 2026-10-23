# Fetch runtime

`lit-canon-fetch` is the small browser runtime behind generated clients. It has no
dependencies. Configure it once during application startup, then use the generated
API functions or query and mutation options.

## Configure requests

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({ baseUrl: "https://api.example.com" });
```

Without configuration, requests use relative API paths and send cookies with
`credentials: "include"`. `ApiFetchConfig` accepts:

| Option        | Purpose                                                               |
| ------------- | --------------------------------------------------------------------- |
| `baseUrl`     | Prefix for relative paths. A trailing slash is removed.               |
| `credentials` | Default `RequestInit.credentials`; defaults to `"include"`.           |
| `headers`     | Static `HeadersInit`, or a function that returns headers per request. |
| `fetch`       | A custom `fetch` implementation, for example in tests.                |

`createApiFetch(config)` returns an independent `apiFetch` function with its own
configuration, for a second API or for tests.

## Dynamic headers

`headers` can be a function. It runs before every request, may be sync or async,
and receives the path from the generated client (before `baseUrl` and the query
string) and the upper-case HTTP method:

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({
  headers: async ({ url, method }): Promise<HeadersInit> => {
    const token = await getToken();
    return url.startsWith("/admin")
      ? { authorization: `Bearer ${token}`, "x-request-method": method }
      : { authorization: `Bearer ${token}` };
  },
});
```

The `Promise<HeadersInit>` return annotation helps TypeScript when the branches
return objects with different keys. Per-request headers override configured
headers, and per-request credentials override the configured credentials.

## Requests and responses

- **Query parameters** come from the `query` object. Arrays become repeated
  parameters. `null` and `undefined` are omitted, also inside arrays, so
  `{ tag: ["a", null], page: undefined }` becomes `?tag=a`.
- **Bodies**: plain objects, arrays and `null` are sent as JSON with
  `content-type: application/json`, unless a content type is set. `FormData`, `Blob`
  and other native bodies are passed through.
- **Responses**: `application/json` and `+json` bodies are parsed. Other non-empty
  bodies return text. Empty bodies, 204 and 205 responses and HEAD requests return
  `undefined`.
- **Cancellation**: query factories forward TanStack's `AbortSignal`, so leaving a
  page cancels its pending requests.

Generated types describe the API contract. Response bodies are not validated at
runtime.

## Handle HTTP errors

Responses with a non-2xx status throw `ApiError`:

```ts
import { ApiError } from "lit-canon-fetch";
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

`ApiError.problem` holds RFC 9457 problem details (`ApiProblem`), or `null` when the
error body is not a recognized problem object. The runtime recognizes a problem by
string `type` and `title` fields and a numeric `status`. It keeps the HTTP status
even when the error body is malformed. Network failures and aborts propagate from
`fetch`.

Each generated resource re-exports `ApiError`, `ApiProblem` and `ApiRequestOptions`.
For typed problem details per resource, see
[configuration](configuration.md#project-specific-options).

## Custom request module

To route generated requests through your own module, configure its path:

```ts
import { defineConfig } from "lit-canon-api";

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
and fetch options. `exports` and `typeExports` list what each resource re-exports;
set them to `[]` if your module exposes different symbols. With a custom module,
`lit-canon-fetch` is not needed at runtime.

## Exports

| Export              | Kind     | Purpose                                                  |
| ------------------- | -------- | -------------------------------------------------------- |
| `apiFetch`          | function | The request function generated code calls.               |
| `configureApiFetch` | function | Sets the defaults used by `apiFetch`.                    |
| `createApiFetch`    | function | Creates an independent `apiFetch` with its own defaults. |
| `ApiError`          | class    | Thrown for non-2xx responses; `status` and `problem`.    |
| `ApiProblem`        | type     | RFC 9457 problem details.                                |
| `ApiRequestOptions` | type     | `RequestInit` plus `body` and `query`.                   |
| `ApiFetchConfig`    | type     | The options of `configureApiFetch` and `createApiFetch`. |

[All documentation](README.md)
