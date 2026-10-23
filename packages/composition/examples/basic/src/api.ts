import { createContext } from "@lit/context";

export interface Browser {
  id: string;
  name: string;
  engine: string;
  version: string;
}

export interface ApiClient {
  get<T>(path: string, signal?: AbortSignal): Promise<T>;
}

export const apiCtx = createContext<ApiClient>("api-client");

const BROWSERS: Browser[] = [
  { id: "1", name: "Chrome", engine: "Blink", version: "142" },
  { id: "2", name: "Firefox", engine: "Gecko", version: "145" },
  { id: "3", name: "Safari", engine: "WebKit", version: "26" },
];

/** In-memory stand-in for an HTTP client, with a little latency. */
export class FakeApiClient implements ApiClient {
  async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    signal?.throwIfAborted();
    if (path === "/browsers") return BROWSERS as T;
    const browser = BROWSERS.find((b) => path === `/browsers/${b.id}`);
    if (browser) return browser as T;
    throw new Error(`404: ${path}`);
  }
}
