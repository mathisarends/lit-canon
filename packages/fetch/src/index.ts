/** RFC 9457 problem details returned by an API. */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string | null;
  instance?: string | null;
  [key: string]: unknown;
}

/** Request and response details attached to an {@link ApiError}. */
export interface ApiErrorDetails {
  /** The requested URL, including base URL and query string. */
  url?: string;
  /** The upper-case HTTP method. */
  method?: string;
  /** The response headers, e.g. for `Retry-After` or `WWW-Authenticate`. */
  headers?: Headers;
  /** The raw response body text. */
  body?: string;
  /** Overrides the message derived from the problem or status. */
  message?: string;
  cause?: unknown;
}

export class ApiError<
  P extends Partial<Pick<ApiProblem, "type" | "title" | "status" | "detail" | "instance">> =
    ApiProblem,
> extends Error {
  readonly status: number;
  readonly problem: P | null;
  /** The requested URL, including base URL and query string. */
  readonly url: string | undefined;
  /** The upper-case HTTP method. */
  readonly method: string | undefined;
  /** The response headers; empty when the error was created without a response. */
  readonly headers: Headers;
  /** The raw response body text; empty for HEAD, 204 and bodiless responses. */
  readonly body: string;

  constructor(status: number, problem: P | null, details: ApiErrorDetails = {}) {
    super(
      details.message ?? (problem?.detail || problem?.title || `HTTP ${status}`),
      details.cause === undefined ? undefined : { cause: details.cause },
    );
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
    this.url = details.url;
    this.method = details.method;
    this.headers = details.headers ?? new Headers();
    this.body = details.body ?? "";
  }
}

export type ApiRequestOptions = Omit<RequestInit, "body"> & {
  body?: unknown;
  query?: object;
};

export interface ApiFetchConfig {
  baseUrl?: string;
  credentials?: RequestCredentials;
  /**
   * Static headers, or a function called before every request with the path from the
   * generated client (before `baseUrl` and the query string) and the upper-case method.
   * Per-request headers override these.
   */
  headers?:
    | HeadersInit
    | ((request: { url: string; method: string }) => HeadersInit | Promise<HeadersInit>);
  fetch?: typeof globalThis.fetch;
}

const ABSOLUTE_URL = /^(?:[a-z][a-z\d+.-]*:)?\/\//i;

/** Appends query parameters before the fragment. Arrays repeat the key; dates use ISO 8601. */
function withQuery(url: string, query: object = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    for (const item of Array.isArray(value) ? value : [value]) {
      // null and undefined mean "not set" and are left out of the URL.
      if (item !== null && item !== undefined) {
        params.append(key, item instanceof Date ? item.toISOString() : String(item));
      }
    }
  }
  // URLSearchParams.size is missing in Safari < 17 and older Chromium and Firefox.
  const search = params.toString();
  if (!search) {
    return url;
  }
  const hashIndex = url.indexOf("#");
  const path = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const hash = hashIndex === -1 ? "" : url.slice(hashIndex);
  return `${path}${path.includes("?") ? "&" : "?"}${search}${hash}`;
}

function isJsonBody(body: unknown): boolean {
  if (body === null || Array.isArray(body)) {
    return true;
  }
  if (typeof body !== "object") {
    return false;
  }
  const prototype: unknown = Object.getPrototypeOf(body);
  return prototype === Object.prototype || prototype === null;
}

function mediaType(contentType: string | null): string {
  return contentType?.split(";", 1)[0].trim().toLowerCase() ?? "";
}

function isJson(contentType: string | null): boolean {
  const type = mediaType(contentType);
  return type === "application/json" || type.endsWith("+json");
}

/** Text formats are returned as strings; everything else with a media type is binary. */
function isText(contentType: string | null): boolean {
  const type = mediaType(contentType);
  return (
    type === "" ||
    type.startsWith("text/") ||
    type === "application/xml" ||
    type.endsWith("+xml") ||
    type === "application/javascript" ||
    type === "application/x-www-form-urlencoded"
  );
}

function toProblem(value: unknown): ApiProblem | null {
  if (value === null || typeof value !== "object") {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  if (
    typeof candidate.type !== "string" ||
    typeof candidate.title !== "string" ||
    typeof candidate.status !== "number"
  ) {
    return null;
  }
  return candidate as ApiProblem;
}

/** Config headers first, then per-request headers on top. */
async function resolveHeaders(
  defaults: ApiFetchConfig["headers"],
  request: { url: string; method: string },
  overrides: HeadersInit | undefined,
): Promise<Headers> {
  const headers = new Headers(typeof defaults === "function" ? await defaults(request) : defaults);
  new Headers(overrides).forEach((value, key) => headers.set(key, value));
  return headers;
}

/** Serializes plain objects and arrays as JSON; FormData, Blob and strings pass through. */
function encodeBody(body: unknown, headers: Headers): BodyInit | null | undefined {
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // fetch sets multipart/form-data with the boundary; a configured type would hide it.
    headers.delete("content-type");
    return body;
  }
  if (body === undefined || !isJsonBody(body)) {
    return body as BodyInit | null | undefined;
  }
  if (!headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  return JSON.stringify(body);
}

function parseProblem(text: string): ApiProblem | null {
  try {
    return toProblem(JSON.parse(text));
  } catch {
    // Keep the HTTP status when the API returns an invalid error body.
    return null;
  }
}

/** Returns parsed JSON, text, a Blob or undefined; throws ApiError for non-2xx responses. */
async function readResponse<T>(response: Response, method: string, url: string): Promise<T> {
  const hasBody = method !== "HEAD" && response.status !== 204 && response.status !== 205;
  const contentType = response.headers.get("content-type");
  const json = isJson(contentType);
  if (response.ok && hasBody && !json && !isText(contentType)) {
    // Files such as PDFs and images: reading them as text would corrupt the bytes.
    return (await response.blob()) as T;
  }
  const text = hasBody ? await response.text() : "";
  if (!response.ok) {
    throw new ApiError(response.status, json && text ? parseProblem(text) : null, {
      url,
      method,
      headers: response.headers,
      body: text,
    });
  }
  if (!text) {
    return undefined as T;
  }
  return (json ? JSON.parse(text) : text) as T;
}

export function createApiFetch(config: ApiFetchConfig = {}) {
  const baseUrl = config.baseUrl?.replace(/\/+$/, "") ?? "";

  return async function apiFetch<T>(url: string, options: ApiRequestOptions = {}): Promise<T> {
    const { body, query, headers: requestHeaders, ...init } = options;
    const method = (init.method ?? "GET").toUpperCase();
    const headers = await resolveHeaders(config.headers, { url, method }, requestHeaders);
    const encodedBody = encodeBody(body, headers);
    const target = ABSOLUTE_URL.test(url) ? url : baseUrl + url;
    const send = config.fetch ?? globalThis.fetch;
    const requestUrl = withQuery(target, query);
    const response = await send(requestUrl, {
      ...init,
      credentials: init.credentials ?? config.credentials ?? "include",
      headers,
      body: encodedBody,
    });
    return readResponse<T>(response, method, requestUrl);
  };
}

let defaultFetch = createApiFetch();

/** Set defaults for generated clients; call once during application startup. */
export function configureApiFetch(config: ApiFetchConfig): void {
  defaultFetch = createApiFetch(config);
}

export function apiFetch<T>(url: string, options?: ApiRequestOptions): Promise<T> {
  return defaultFetch<T>(url, options);
}
