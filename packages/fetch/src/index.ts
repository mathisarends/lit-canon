/** RFC 9457 problem details returned by an API. */
export interface ApiProblem {
  type: string;
  title: string;
  status: number;
  detail?: string | null;
  instance?: string | null;
  [key: string]: unknown;
}

export class ApiError<
  P extends Partial<Pick<ApiProblem, "type" | "title" | "status" | "detail" | "instance">> =
    ApiProblem,
> extends Error {
  readonly status: number;
  readonly problem: P | null;

  constructor(status: number, problem: P | null) {
    super(problem?.detail || problem?.title || `HTTP ${status}`);
    this.name = "ApiError";
    this.status = status;
    this.problem = problem;
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

function withQuery(url: string, query: object | undefined): string {
  if (!query) {
    return url;
  }
  const [path, fragment] = url.split("#", 2);
  const params = new URLSearchParams();
  for (const [key, rawValue] of Object.entries(query)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      // null and undefined mean "not set" and are left out of the URL.
      if (value !== undefined && value !== null) {
        params.append(key, String(value));
      }
    }
  }
  const result = params.size ? `${path}${path.includes("?") ? "&" : "?"}${params}` : path;
  return fragment === undefined ? result : `${result}#${fragment}`;
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

function isJson(contentType: string | null): boolean {
  const mediaType = contentType?.split(";", 1)[0].trim().toLowerCase();
  return mediaType === "application/json" || mediaType?.endsWith("+json") === true;
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

export function createApiFetch(config: ApiFetchConfig = {}) {
  return async function apiFetch<T>(url: string, options?: ApiRequestOptions): Promise<T> {
    const { body: requestBody, query, headers: inputHeaders, ...requestOptions } = options ?? {};
    const method = (requestOptions.method ?? "GET").toUpperCase();
    const headers = new Headers(
      typeof config.headers === "function" ? await config.headers({ url, method }) : config.headers,
    );
    new Headers(inputHeaders).forEach((value, key) => headers.set(key, value));
    const jsonBody = requestBody !== undefined && isJsonBody(requestBody);
    if (jsonBody && !headers.has("content-type")) {
      headers.set("content-type", "application/json");
    }
    const baseUrl = config.baseUrl?.replace(/\/+$/, "") ?? "";
    const target = /^(?:[a-z][a-z\d+.-]*:)?\/\//i.test(url) ? url : `${baseUrl}${url}`;
    const response = await (config.fetch ?? globalThis.fetch)(withQuery(target, query), {
      ...requestOptions,
      credentials: requestOptions.credentials ?? config.credentials ?? "include",
      headers,
      body: jsonBody ? JSON.stringify(requestBody) : (requestBody as BodyInit | null | undefined),
    });
    const responseBody =
      response.status === 204 || response.status === 205 || requestOptions.method === "HEAD"
        ? ""
        : await response.text();
    const json = isJson(response.headers.get("content-type"));
    if (!response.ok) {
      let problem: ApiProblem | null = null;
      if (json && responseBody) {
        try {
          problem = toProblem(JSON.parse(responseBody));
        } catch {
          // Preserve the HTTP status when the API returns an invalid error body.
        }
      }
      throw new ApiError(response.status, problem);
    }
    if (!responseBody) {
      return undefined as T;
    }
    return (json ? JSON.parse(responseBody) : responseBody) as T;
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
