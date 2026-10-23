import assert from "node:assert/strict";
import { test } from "node:test";
import { ApiError, createApiFetch } from "../dist/index.js";

test("serializes query, JSON and multipart requests and forwards overrides", async () => {
  const requests: Array<{ url: RequestInfo | URL; init: RequestInit }> = [];
  const request = createApiFetch({
    baseUrl: "https://example.test/",
    credentials: "same-origin",
    headers: { "x-default": "default" },
    fetch: async (url, init) => {
      requests.push({ url, init: init ?? {} });
      return new Response('{"ok":true}', { headers: { "content-type": "application/json" } });
    },
  });
  const signal = new AbortController().signal;
  assert.deepEqual(
    await request("/items?sort=id#top", {
      method: "POST",
      body: { name: "item" },
      query: { tag: ["a", null, "b", undefined], absent: undefined, nullable: null },
      headers: { "x-default": "override" },
      credentials: "omit",
      signal,
    }),
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
  await request("https://uploads.test/file", { method: "POST", body });
  assert.equal(requests[1].url, "https://uploads.test/file");
  assert.equal(requests[1].init.body, body);
  assert.equal(new Headers(requests[1].init.headers).get("content-type"), null);
});

test("handles empty responses, text and problem details, including invalid error bodies", async () => {
  const respond = (response: Response) => createApiFetch({ fetch: async () => response });
  assert.equal(await respond(new Response(null, { status: 204 }))("/empty"), undefined);
  assert.equal(await respond(new Response("plain"))("/text"), "plain");
  const problem = { type: "about:blank", title: "Forbidden", status: 403, detail: "No access" };
  await assert.rejects(
    respond(
      new Response(JSON.stringify(problem), {
        status: 403,
        headers: { "content-type": "application/problem+json" },
      }),
    )("/forbidden"),
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
    )("/failure"),
    (error: unknown) => error instanceof ApiError && error.status === 500 && error.problem === null,
  );
});

test("calls a header function per request with the client path and method", async () => {
  const calls: Array<{ url: string; method: string }> = [];
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
      return request.url.startsWith("/admin")
        ? { "x-admin-token": "secret", "x-shared": "config" }
        : {};
    },
  });
  await sync("/admin/users", { method: "delete", query: { page: 2 } });
  await sync("/items");
  await sync("/admin/users", { headers: { "x-shared": "request" } });
  assert.deepEqual(calls, [
    { url: "/admin/users", method: "DELETE" },
    { url: "/items", method: "GET" },
    { url: "/admin/users", method: "GET" },
  ]);
  assert.equal(sent[0].get("x-admin-token"), "secret");
  assert.equal(sent[1].get("x-admin-token"), null);
  assert.equal(sent[2].get("x-shared"), "request");

  let token = 0;
  const async = createApiFetch({
    fetch: respond,
    headers: async () => ({ authorization: `Bearer ${++token}` }),
  });
  await async("/one");
  await async("/two", { headers: { authorization: "Bearer override" } });
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
  await request("/search", { query: { q: null, page: undefined } });
  await request("/search", { query: { ids: [null, undefined], empty: "" } });
  await request("/search", { query: { ids: [1, null, 0, undefined, false] } });
  assert.deepEqual(urls, ["/search", "/search?empty=", "/search?ids=1&ids=0&ids=false"]);
});
