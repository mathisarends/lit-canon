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
      query: { tag: ["a", "b"], absent: undefined, nullable: null },
      headers: { "x-default": "override" },
      credentials: "omit",
      signal,
    }),
    { ok: true },
  );
  assert.equal(requests[0].url, "https://example.test/items?sort=id&tag=a&tag=b&nullable=null#top");
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
