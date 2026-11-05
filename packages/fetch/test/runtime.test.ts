import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiFetch } from "../dist/index.js";

test("serializes JSON primitives while preserving native text bodies", async () => {
  const bodies: unknown[] = [];
  const request = createApiFetch({
    fetch: async (_url, init) => {
      bodies.push(init?.body);
      return new Response(null, { status: 204 });
    },
  });
  for (const body of ["hello", 42, false, null]) {
    await request({
      method: "POST",
      path: "/json",
      body,
      contentType: "application/merge-patch+json",
    });
    assert.equal(bodies.at(-1), JSON.stringify(body));
  }
  await request({ method: "POST", path: "/text", body: "hello" });
  assert.equal(bodies.at(-1), "hello");
});

test("serializes query, JSON and multipart requests and forwards overrides", async () => {
  const requests: Array<{ url: RequestInfo | URL; init: RequestInit }> = [];
  const request = createApiFetch({
    baseUrl: "https://example.test/",
    credentials: "include",
    headers: { "x-default": "default" },
    fetch: async (url, init) => {
      requests.push({ url, init: init ?? {} });
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await request(
      {
        method: "POST",
        path: "/items?sort=id#top",
        body: { name: "item" },
        query: { tag: ["a", null, "b", undefined], absent: undefined, nullable: null },
      },
      { headers: { "x-default": "override" }, credentials: "omit", signal },
    ),
    { ok: true },
  );
  assert.equal(requests[0].url, "https://example.test/items?sort=id&tag=a&tag=b#top");
  assert.equal(requests[0].init.body, '{"name":"item"}');
  assert.equal(new Headers(requests[0].init.headers).get("content-type"), "application/json");
  assert.equal(new Headers(requests[0].init.headers).get("x-default"), "override");
  assert.equal(requests[0].init.credentials, "omit");
  assert.equal(requests[0].init.signal, signal);
  const body = new FormData();
  body.append("file", new Blob(["hello"]), "hello.txt");
  await request({ method: "POST", path: "https://uploads.test/file", body });
  assert.equal(requests[1].url, "https://uploads.test/file");
  assert.equal(requests[1].init.credentials, "include");
  assert.equal(requests[1].init.body, body);
  assert.equal(new Headers(requests[1].init.headers).get("content-type"), null);
});

test("handles empty responses, text and problem details, including invalid error bodies", async () => {
  const respond = (response: Response) => createApiFetch({ fetch: async () => response });
  assert.equal(
    await respond(new Response(null, { status: 204 }))({ method: "GET", path: "/empty" }),
    undefined,
  );
  assert.equal(await respond(new Response("plain"))({ method: "GET", path: "/text" }), "plain");
  // Not read for HEAD in any letter case.
  assert.equal(
    await respond(new Response("ignored"))({ method: "head", path: "/head" }),
    undefined,
  );
  const problem = { type: "about:blank", title: "Forbidden", status: 403, detail: "No access" };
  await assert.rejects(
    respond(
      new Response(JSON.stringify(problem), {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      }),
    )({ method: "GET", path: "/forbidden" }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 403);
      assert.deepEqual(error.problem, problem);
      assert.equal(error.message, "No access");
      return true;
    },
  );
  await assert.rejects(
    respond(
      new Response("invalid JSON", {
        status: 500,
        headers: { "content-type": "application/json" },
      }),
    )({ method: "GET", path: "/failure" }),
    (error: unknown) => error instanceof ApiError && error.status === 500 && error.problem === null,
  );
});

test("calls a header function per request with the path and method", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const sent: Headers[] = [];
  const respond = async (_url: RequestInfo | URL, init?: RequestInit) => {
    sent.push(new Headers(init?.headers));
    return new Response(null, { status: 204 });
  };
  const sync = createApiFetch({
    baseUrl: "https://example.test",
    fetch: respond,
    headers: (request): HeadersInit => {
      calls.push(request);
      return request.path.startsWith("/admin")
        ? { "x-admin-token": "secret", "x-shared": "config" }
        : {};
    },
  });
  await sync({ method: "delete", path: "/admin/users", query: { page: 2 } });
  await sync({ method: "GET", path: "/items" });
  await sync({ method: "GET", path: "/admin/users" }, { headers: { "x-shared": "request" } });
  assert.deepEqual(calls, [
    { path: "/admin/users", method: "DELETE" },
    { path: "/items", method: "GET" },
    { path: "/admin/users", method: "GET" },
  ]);
  assert.equal(sent[0].get("x-admin-token"), "secret");
  assert.equal(sent[1].get("x-admin-token"), null);
  assert.equal(sent[2].get("x-shared"), "request");

  let token = 0;
  const async = createApiFetch({
    fetch: respond,
    headers: async () => ({ authorization: `Bearer ${++token}` }),
  });
  await async({ method: "GET", path: "/one" });
  await async({ method: "GET", path: "/two" }, { headers: { authorization: "Bearer override" } });
  assert.equal(sent[3].get("authorization"), "Bearer 1");
  assert.equal(sent[4].get("authorization"), "Bearer override");
  assert.equal(token, 2);
});

test("omits null and undefined query values, including array elements", async () => {
  const urls: string[] = [];
  const request = createApiFetch({
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(null, { status: 204 });
    },
  });
  const search = (query: object) => request({ method: "GET", path: "/search", query });
  await search({ q: null, page: undefined });
  await search({ ids: [null, undefined], empty: "" });
  await search({ ids: [1, null, 0, undefined, false] });
  assert.deepEqual(urls, ["/search", "/search?empty=", "/search?ids=1&ids=0&ids=false"]);
});

test("returns binary responses as Blob and text formats as strings", async () => {
  const respond = (response: Response) => createApiFetch({ fetch: async () => response });
  const bytes = new Uint8Array([0xff, 0x00, 0x80]);
  const file = await respond(
    new Response(bytes, { headers: { "content-type": "application/pdf" } }),
  )<Blob>({ method: "GET", path: "/file" });
  assert.ok(file instanceof Blob);
  assert.equal(file.type, "application/pdf");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), bytes);
  assert.ok(
    (await respond(new Response(bytes, { headers: { "content-type": "image/png" } }))({
      method: "GET",
      path: "/i",
    })) instanceof Blob,
  );
  for (const type of ["text/csv", "application/xml", "application/atom+xml", null]) {
    const headers = new Headers();
    if (type) headers.set("content-type", type);
    const response = new Response(new TextEncoder().encode("a,b"), { headers });
    assert.equal(await respond(response)({ method: "GET", path: "/text" }), "a,b", String(type));
  }
});

test("lets fetch set the multipart content type for FormData bodies", async () => {
  const sent: Headers[] = [];
  const request = createApiFetch({
    headers: { "content-type": "application/json" },
    fetch: async (_url, init) => {
      sent.push(new Headers(init?.headers));
      return new Response(null, { status: 204 });
    },
  });
  const body = new FormData();
  body.append("name", "value");
  await request({ method: "POST", path: "/upload", body });
  await request(
    { method: "POST", path: "/upload", body },
    { headers: { "content-type": "text/plain" } },
  );
  await request({ method: "POST", path: "/json", body: { a: 1 } });
  assert.equal(sent[0].get("content-type"), null);
  assert.equal(sent[1].get("content-type"), null);
  assert.equal(sent[2].get("content-type"), "application/json");
});

test("builds query strings without URLSearchParams.size", async (t) => {
  // Older browsers do not implement size; the query must not be dropped there.
  const descriptor = Object.getOwnPropertyDescriptor(URLSearchParams.prototype, "size");
  Object.defineProperty(URLSearchParams.prototype, "size", {
    configurable: true,
    get: () => undefined,
  });
  t.after(() => {
    if (descriptor) Object.defineProperty(URLSearchParams.prototype, "size", descriptor);
  });
  const urls: string[] = [];
  const request = createApiFetch({
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(null, { status: 204 });
    },
  });
  await request({ method: "GET", path: "/search", query: { q: "lit" } });
  assert.deepEqual(urls, ["/search?q=lit"]);
});

test("serializes Date query values as ISO 8601", async () => {
  const urls: string[] = [];
  const request = createApiFetch({
    fetch: async (url) => {
      urls.push(String(url));
      return new Response(null, { status: 204 });
    },
  });
  await request({
    method: "GET",
    path: "/events",
    query: { since: new Date(Date.UTC(2026, 0, 2, 3, 4, 5)) },
  });
  assert.deepEqual(urls, ["/events?since=2026-01-02T03%3A04%3A05.000Z"]);
});

test("attaches the URL, method, headers and raw body to ApiError", async () => {
  const request = createApiFetch({
    baseUrl: "https://example.test",
    fetch: async () =>
      new Response("Token expired", {
        status: 401,
        headers: { "content-type": "text/plain", "www-authenticate": "Bearer" },
      }),
  });
  await assert.rejects(
    request({ method: "patch", path: "/me", query: { full: true } }),
    (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.status, 401);
      assert.equal(error.problem, null);
      assert.equal(error.message, "HTTP 401");
      assert.equal(error.url, "https://example.test/me?full=true");
      assert.equal(error.method, "PATCH");
      assert.equal(error.headers.get("www-authenticate"), "Bearer");
      assert.equal(error.body, "Token expired");
      return true;
    },
  );
  const manual = new ApiError(404, null);
  assert.equal(manual.url, undefined);
  assert.equal(manual.body, "");
  assert.equal(manual.headers.get("x"), null);
});

test("throws ApiError for invalid JSON in a successful response", async () => {
  const request = createApiFetch({
    fetch: async () => new Response("{oops", { headers: { "content-type": "application/json" } }),
  });
  await assert.rejects(request({ method: "GET", path: "/broken" }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.equal(error.problem, null);
    assert.equal(error.body, "{oops");
    assert.equal(error.message, "Invalid JSON in GET response");
    assert.ok(error.cause instanceof SyntaxError);
    return true;
  });
});

test("runs middleware in order and lets it retry or answer requests", async () => {
  const log: string[] = [];
  let token = "old";
  const sent: Array<{ url: string; authorization: string | null; body: unknown }> = [];
  const request = createApiFetch({
    baseUrl: "https://example.test",
    headers: () => ({ authorization: `Bearer ${token}` }),
    fetch: async (url, init) => {
      const authorization = new Headers(init?.headers).get("authorization");
      sent.push({ url: String(url), authorization, body: init?.body });
      return authorization === "Bearer new"
        ? new Response('{"ok":true}', { headers: { "content-type": "application/json" } })
        : new Response(null, { status: 401 });
    },
    middleware: [
      async (request, next) => {
        log.push(`outer ${request.init.method} ${request.url}`);
        const response = await next(request);
        log.push(`outer ${response.status}`);
        return response;
      },
      async (request, next) => {
        const response = await next(request);
        if (response.status !== 401) return response;
        token = "new";
        request.init.headers.set("authorization", `Bearer ${token}`);
        return next(request);
      },
    ],
  });
  assert.deepEqual(await request({ method: "patch", path: "/me", body: { a: 1 } }), { ok: true });
  assert.deepEqual(sent, [
    { url: "https://example.test/me", authorization: "Bearer old", body: '{"a":1}' },
    { url: "https://example.test/me", authorization: "Bearer new", body: '{"a":1}' },
  ]);
  assert.deepEqual(log, ["outer PATCH https://example.test/me", "outer 200"]);

  const cached = createApiFetch({
    fetch: async () => assert.fail("fetch must not run"),
    middleware: [async () => new Response("cached")],
  });
  assert.equal(await cached({ method: "GET", path: "/cached" }), "cached");

  const failing = createApiFetch({
    fetch: async () => new Response(null, { status: 503 }),
    middleware: [async (request, next) => next({ ...request, url: `${request.url}?retry=1` })],
  });
  await assert.rejects(
    failing({ method: "GET", path: "/x" }),
    (error) => error instanceof ApiError && error.status === 503 && error.url === "/x",
  );
});

test("layers config headers, content type, header parameters and per-call headers", async () => {
  const sent: Headers[] = [];
  const request = createApiFetch({
    headers: { "content-type": "text/plain", "x-trace": "config", "x-config": "1" },
    fetch: async (_url, init) => {
      sent.push(new Headers(init?.headers));
      return new Response(null, { status: 204 });
    },
  });
  const note = {
    method: "POST",
    path: "/notes",
    body: { text: "hi" },
    contentType: "application/merge-patch+json",
    headers: { "x-trace": "param", "x-list": ["a", "b"], "x-absent": undefined, "x-null": null },
  };
  await request(note);
  await request(note, { headers: { "x-trace": "call", "content-type": "application/json" } });
  assert.equal(sent[0].get("content-type"), "application/merge-patch+json");
  assert.equal(sent[0].get("x-trace"), "param");
  assert.equal(sent[0].get("x-config"), "1");
  assert.equal(sent[0].get("x-list"), "a,b");
  assert.equal(sent[0].has("x-absent"), false);
  assert.equal(sent[0].has("x-null"), false);
  assert.equal(sent[1].get("x-trace"), "call");
  assert.equal(sent[1].get("content-type"), "application/json");
});

test("sends cookies only to the same origin by default", async () => {
  let credentials: RequestCredentials | undefined;
  const request = createApiFetch({
    fetch: async (_url, init) => {
      credentials = init?.credentials;
      return new Response(null, { status: 204 });
    },
  });
  await request({ method: "GET", path: "/items" });
  assert.equal(credentials, "same-origin");
});
