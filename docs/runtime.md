# Fetch runtime

`lit-canon-fetch` is the small browser runtime behind generated clients. It has no
dependencies. Configure it once during application startup, then use the generated
API functions or query and mutation options.

## Configure requests

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({ baseUrl: "https://api.example.com" });
```

Without configuration, requests use relative API paths and send cookies only to the
same origin. `ApiFetchConfig` accepts:

| Option        | Purpose                                                               |
| ------------- | --------------------------------------------------------------------- |
| `baseUrl`     | Prefix for relative paths. A trailing slash is removed.               |
| `credentials` | Default `RequestInit.credentials`; defaults to `"same-origin"`.       |
| `headers`     | Static `HeadersInit`, or a function that returns headers per request. |
| `fetch`       | A custom `fetch` implementation, for example in tests.                |
| `middleware`  | Functions that wrap every request; see [middleware](#middleware).     |

The `"same-origin"` default matches `fetch`. If the API runs on another origin and
uses cookie sessions, set `credentials: "include"`; the server must then allow
credentials in its CORS response.

`createApiFetch(config)` returns an independent `apiFetch` function with its own
configuration, for a second API or for tests.

## Dynamic headers

`headers` can be a function. It runs before every request, may be sync or async,
and receives the path from the generated client (before `baseUrl` and the query
string) and the upper-case HTTP method:

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({
  headers: async ({ path, method }): Promise<HeadersInit> => {
    const token = await getToken();
    return path.startsWith("/admin")
      ? { authorization: `Bearer ${token}`, "x-request-method": method }
      : { authorization: `Bearer ${token}` };
  },
});
```

The `Promise<HeadersInit>` return annotation helps TypeScript when the branches
return objects with different keys. Headers are applied in this order, later ones
winning: configured headers, the request content type, header parameters from the
operation input, and the `headers` option of the call. Per-request credentials
override the configured credentials.

## Middleware

Middleware wraps every request, with the first entry outermost. Each one receives the
request (the full URL and the fetch options, with `method` upper-case and `headers`
as a `Headers` object) and a `next` function. It can change the request, call `next`
several times to retry, or return a `Response` without calling `next`. Responses are
turned into data or `ApiError` after the middleware has finished.

```ts
import { configureApiFetch } from "lit-canon-fetch";

configureApiFetch({
  headers: async () => ({ authorization: `Bearer ${await getToken()}` }),
  middleware: [
    // Refresh an expired token once and repeat the request.
    async (request, next) => {
      const response = await next(request);
      if (response.status !== 401) return response;
      request.init.headers.set("authorization", `Bearer ${await refreshToken()}`);
      return next(request);
    },
    async (request, next) => {
      const started = performance.now();
      const response = await next(request);
      console.debug(request.init.method, request.url, response.status, performance.now() - started);
      return response;
    },
  ],
});
```

JSON, text, `Blob` and `FormData` bodies can be sent again on a retry; a
`ReadableStream` body cannot.

## Requests and responses

- **Requests**: generated functions describe each request as one object,
  `{ method, path, query, headers, body, contentType }`, and pass it to `apiFetch`
  with the call's `ApiRequestOptions`.
- **Query parameters** come from the `query` object. Arrays become repeated
  parameters. `null` and `undefined` are omitted, also inside arrays, so
  `{ tag: ["a", null], page: undefined }` becomes `?tag=a`. `Date` values are sent
  as ISO 8601 strings.
- **Bodies**: plain objects, arrays and `null` are sent as JSON with
  `content-type: application/json`, unless a content type is set. JSON scalar bodies
  (strings, numbers and booleans) are serialized when the content type is JSON;
  generated JSON operations supply that content type. `FormData`, `Blob`
  and other native bodies are passed through. For `FormData`, any configured or
  per-request content type is removed so `fetch` can set `multipart/form-data` with
  its boundary.
- **Responses**: `application/json` and `+json` bodies are parsed. Text formats
  (`text/*`, XML, form data and bodies without a content type) return a string. Other
  media types, such as `application/pdf`, `application/octet-stream` or images,
  return a `Blob`, matching the `Blob` type generated for binary responses. Empty
  bodies, 204 and 205 responses and HEAD requests return `undefined`.
- **Cancellation**: query factories forward TanStack's `AbortSignal`, so leaving a
  page cancels its pending requests.

Generated types describe the API contract. Response bodies are not validated at
runtime.

## Handle HTTP errors

Responses with a non-2xx status throw `ApiError`. A successful response that claims
JSON but cannot be parsed also throws `ApiError`, with its status, a `SyntaxError` as
`cause` and the raw text in `body`, so callers handle a single error type:

```ts
import { ApiError } from "lit-canon-fetch";
import { products } from "./api/generated";

try {
  await products.getProduct({ productId: "p-1" });
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

Every `ApiError` from the runtime also carries the request and response details:

| Property  | Content                                                                |
| --------- | ---------------------------------------------------------------------- |
| `url`     | The final response URL after redirects, otherwise the requested URL.   |
| `method`  | The upper-case HTTP method.                                            |
| `headers` | The response headers, for example `Retry-After` or `WWW-Authenticate`. |
| `body`    | The raw response body text, also when it is not a problem object.      |

Import `ApiError`, `ApiProblem` and `ApiRequestOptions` from `lit-canon-fetch`; the
generated resources do not re-export them. For typed problem details per resource, see
[configuration](configuration.md#project-specific-options).

## Custom request module

To route generated requests through your own module, name it as the runtime:

```ts
import { defineConfig } from "lit-canon-api";

export default defineConfig({
  input: "./openapi.json",
  output: "./src/api/generated",
  runtime: "./src/api/request.ts",
});
```

A value starting with `.` or `/` is a file relative to the config; anything else, such
as `@acme/api-runtime`, is imported as a package. The module must export:

- `apiFetch<T>(request: ApiRequest, options?: ApiRequestOptions): Promise<T>`, where
  `request` is `{ method, path, query?, headers?, body?, contentType? }` with an
  unserialized `body`;
- the type `ApiRequestOptions`, the per-call options generated functions accept;
- a generic `ApiError<P>` class when problem helpers are generated.

The simplest module wraps `createApiFetch` from `lit-canon-fetch` and re-exports its
types. With a module that does not use it, `lit-canon-fetch` is not needed at runtime.

## Exports

| Export              | Kind     | Purpose                                                     |
| ------------------- | -------- | ----------------------------------------------------------- |
| `apiFetch`          | function | The request function generated code calls.                  |
| `configureApiFetch` | function | Sets the defaults used by `apiFetch`.                       |
| `createApiFetch`    | function | Creates an independent `apiFetch` with its own defaults.    |
| `ApiError`          | class    | Thrown for non-2xx responses; `status`, `problem`, details. |
| `ApiErrorDetails`   | type     | The optional third `ApiError` constructor argument.         |
| `ApiFetch`          | type     | The signature of `apiFetch`.                                |
| `ApiRequest`        | type     | The request object generated functions pass to `apiFetch`.  |
| `ApiProblem`        | type     | RFC 9457 problem details.                                   |
| `ApiRequestOptions` | type     | Per-call `RequestInit` options without `body` and `method`. |
| `ApiFetchConfig`    | type     | The options of `configureApiFetch` and `createApiFetch`.    |
| `ApiFetchRequest`   | type     | The request as middleware sees it.                          |
| `ApiMiddleware`     | type     | A middleware function.                                      |

[All documentation](README.md)
