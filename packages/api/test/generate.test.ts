import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import ts from "typescript";
import { stringify as stringifyYaml } from "yaml";
import { generate } from "../dist/index.js";
import { ApiError, configureApiFetch } from "lit-canon-fetch";
import { openapi } from "./fixtures.ts";

const run = promisify(execFile);
const cli = resolve("dist/cli.js");

let root: string;

test("generates and executes multipart requests with optional fields", async () => {
  const directory = join(root, "optional-multipart");
  await mkdir(directory);
  const spec = openapi();
  const upload = spec.paths["/upload"]!.post!;
  upload.requestBody = {
    required: true,
    content: {
      "multipart/form-data": {
        schema: {
          type: "object",
          required: ["file"],
          properties: {
            file: { type: "string", format: "binary" },
            description: { type: "string" },
            count: { type: "integer" },
            active: { type: "boolean" },
          },
        },
      },
    },
  };
  spec.paths = { "/upload": { post: upload } };
  const input = join(directory, "openapi.json");
  await writeFile(input, JSON.stringify(spec));
  const output = join(directory, "generated");
  const result = await generate({ input, output });
  assert.deepEqual(typecheck(output, result.files), []);
  await compile(join(output, "files"), ["api"]);
  const bodies: FormData[] = [];
  configureApiFetch({
    fetch: async (_url, init) => {
      bodies.push(init!.body as FormData);
      assert.equal(new Headers(init?.headers).has("content-type"), false);
      return new Response(null, { status: 204 });
    },
  });
  const { uploadFile } = await import(pathToFileURL(join(output, "files/api.js")).href);
  const file = new Blob(["hello"]);
  await uploadFile({ file });
  assert.deepEqual([...bodies[0].keys()], ["file"]);
  await uploadFile({ file, description: "", count: 0, active: false });
  assert.equal(bodies[1].get("description"), "");
  assert.equal(bodies[1].get("count"), "0");
  assert.equal(bodies[1].get("active"), "false");
});

test("sends scalar JSON request bodies with the declared media type", async () => {
  const directory = join(root, "scalar-json");
  await mkdir(directory);
  const spec = openapi();
  spec.paths = {};
  for (const type of ["string", "number", "boolean"] as const) {
    spec.paths[`/${type}`] = {
      post: {
        tags: ["values"],
        operationId: `send_${type}`,
        requestBody: { required: true, content: { "application/json": { schema: { type } } } },
        responses: { 204: { description: "OK" } },
      },
    };
  }
  const input = join(directory, "openapi.json");
  await writeFile(input, JSON.stringify(spec));
  const output = join(directory, "generated");
  await generate({ input, output });
  await compile(join(output, "values"), ["api"]);
  const sent: Request[] = [];
  configureApiFetch({
    fetch: async (url, init) => {
      sent.push(new Request(`https://example.test${url}`, init));
      return new Response(null, { status: 204 });
    },
  });
  const api = await import(pathToFileURL(join(output, "values/api.js")).href);
  for (const [name, value] of [
    ["sendString", "hello"],
    ["sendNumber", 42],
    ["sendBoolean", false],
  ] as const) {
    await api[name](value);
    const request = sent.at(-1)!;
    assert.equal(request.headers.get("content-type"), "application/json");
    assert.equal(await request.text(), JSON.stringify(value));
  }
});
before(async () => {
  const base = resolve(".test-output");
  await mkdir(base, { recursive: true });
  root = await mkdtemp(join(base, "generate-"));
});
after(async () => {
  assert.ok(
    root.startsWith(resolve(".test-output") + "/") ||
      root.startsWith(resolve(".test-output") + "\\"),
  );
  await rm(root, { recursive: true, force: true });
});

function typecheck(output: string, files: string[]): string[] {
  const program = ts.createProgram(
    files.map((file) => join(output, file)),
    {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  return ts
    .getPreEmitDiagnostics(program)
    .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"));
}

/** Compile generated TypeScript next to the sources so tests can import and run it. */
async function compile(directory: string, names: string[]): Promise<void> {
  for (const name of names) {
    const source = await readFile(join(directory, `${name}.ts`), "utf8");
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(/from "\.\/api"/g, 'from "./api.js"');
    await writeFile(join(directory, `${name}.js`), compiled);
  }
}

async function removeCompiled(directory: string, names: string[]): Promise<void> {
  for (const name of names) {
    await rm(join(directory, `${name}.js`));
  }
}

test("generates and executes clients, key factories, queries and mutations; detects drift without writes", async () => {
  const input = join(root, "openapi.json");
  const output = join(root, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  const config = { input, output, excludeTags: ["system"], mutationOperations: ["start_login"] };
  const result = await generate(config);
  assert.deepEqual(result.tags, ["admin", "auth", "files", "items"]);
  assert.ok(!result.files.includes("auth/queries.ts"));
  assert.ok(result.files.includes("auth/mutations.ts"));
  const api = await readFile(join(output, "items/api.ts"), "utf8");
  assert.match(api, /^\/\*\*\n \* Generated by lit-canon-api\. Do not edit manually\.\n/);
  assert.match(api, /from "lit-canon-fetch"/);
  assert.match(api, /encodeURIComponent\(itemId\)/);
  assert.match(api, /query: params/);
  assert.match(api, /body: request/);
  assert.doesNotMatch(api, /getListItemsUrl|JSON.stringify|getHeaders|orval/);
  // Only the root index names the spec version.
  assert.doesNotMatch(api, /spec version/);
  assert.match(await readFile(join(output, "index.ts"), "utf8"), / \* OpenAPI spec version: /);
  assert.match(
    await readFile(join(output, "items/index.ts"), "utf8"),
    /export \{ ApiError \} from "lit-canon-fetch";/,
  );

  const queries = await readFile(join(output, "items/queries.ts"), "utf8");
  assert.match(queries, /export const itemsKeys = \{\n {2}all: \["items"\] as const,/);
  assert.match(queries, /params \?\? null/);
  assert.match(queries, /queryKey: itemsKeys\.listItems\(params\)/);
  assert.match(queries, /queryKey: itemsKeys\.getItem\(itemId\)/);
  assert.match(
    queries,
    /queryFn: \(\{ signal \}\) => getItem\(itemId, \{ \.\.\.options, signal \}\)/,
  );
  assert.doesNotMatch(queries, /queryKey: \[/);

  const mutations = await readFile(join(output, "items/mutations.ts"), "utf8");
  assert.match(mutations, /import type \{ DeleteItemParams, Item \} from "\.\/models";/);
  assert.match(mutations, /export type CreateItemVariables = \{ request: Item \};/);
  assert.match(
    mutations,
    /export type DeleteItemVariables = \{ itemId: string; params\?: DeleteItemParams \};/,
  );
  assert.match(mutations, /mutationFn: \(variables: DeleteItemVariables\) =>/);
  assert.doesNotMatch(`${queries}${mutations}`, /Parameters</);
  assert.match(mutations, /deleteItem\(variables\.itemId, variables\.params, options\)/);
  const login = await readFile(join(output, "auth/mutations.ts"), "utf8");
  assert.match(login, /mutationFn: \(\) => startLogin\(options\)/);

  // Typecheck generated output, including optional mutation variables and Lit Query inference.
  assert.deepEqual(typecheck(output, result.files), []);

  const items = join(output, "items");
  await compile(items, ["api", "queries", "mutations"]);
  const requests: Array<{ url: RequestInfo | URL; init: RequestInit }> = [];
  configureApiFetch({
    fetch: async (url, init) => {
      requests.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ id: "1", name: "Saved" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const { itemsKeys, getItemQuery, listItemsQuery } = await import(
    pathToFileURL(join(items, "queries.js")).href
  );
  const { createItemMutation, deleteItemMutation } = await import(
    pathToFileURL(join(items, "mutations.js")).href
  );
  assert.deepEqual(itemsKeys.all, ["items"]);
  assert.deepEqual(itemsKeys.listItems(), ["items", "listItems", null]);
  assert.deepEqual(itemsKeys.listItems({ limit: 2 }), ["items", "listItems", { limit: 2 }]);
  assert.deepEqual(listItemsQuery().queryKey, ["items", "listItems", null]);
  assert.deepEqual(getItemQuery("a/b").queryKey, itemsKeys.getItem("a/b"));
  const signal = new AbortController().signal;
  await getItemQuery("a/b").queryFn({ signal });
  assert.equal(requests[0].url, "/items/a%2Fb");
  assert.equal(requests[0].init.signal, signal);
  await createItemMutation().mutationFn({ request: { id: "2", name: "New" } });
  assert.equal(requests[1].init.body, '{"id":"2","name":"New"}');
  await deleteItemMutation().mutationFn({ itemId: "2" });
  assert.equal(requests[2].init.method, "DELETE");
  assert.equal(requests[2].url, "/items/2");
  await deleteItemMutation().mutationFn({ itemId: "3", params: { force: true } });
  assert.equal(requests[3].url, "/items/3?force=true");
  // Request options reach the request but not the query key; TanStack's signal wins.
  const traced = getItemQuery("a/b", {
    headers: { "x-trace": "1" },
    signal: AbortSignal.abort(),
  });
  assert.deepEqual(traced.queryKey, itemsKeys.getItem("a/b"));
  await traced.queryFn({ signal });
  assert.equal(new Headers(requests[4].init.headers).get("x-trace"), "1");
  assert.equal(requests[4].init.signal, signal);
  await deleteItemMutation({ headers: { "x-trace": "2" } }).mutationFn({ itemId: "4" });
  assert.equal(new Headers(requests[5].init.headers).get("x-trace"), "2");
  await removeCompiled(items, ["api", "queries", "mutations"]);

  await generate(config, { check: true });
  const stale = api.replace("Do not edit manually.", "Do not edit manually. Old version.");
  await writeFile(join(output, "items/api.ts"), stale);
  await assert.rejects(
    generate(config, { check: true }),
    /out of date[\s\S]*lit-canon-api generate/,
  );
  assert.equal(await readFile(join(output, "items/api.ts"), "utf8"), stale);
  await generate(config);
  assert.equal(await readFile(join(output, "items/api.ts"), "utf8"), api);

  const changed = openapi();
  delete changed.paths["/upload"];
  delete changed.paths["/items"]!.post;
  delete changed.paths["/items/{itemId}"]!.delete;
  await writeFile(input, JSON.stringify(changed));
  await generate(config);
  assert.ok(!(await readdir(output)).includes("files"));
  assert.ok(!(await readdir(join(output, "items"))).includes("mutations.ts"));
});

test("generates key factories only for resources with queries and names them after the resource", async () => {
  const directory = join(root, "keys");
  await mkdir(directory);
  const spec = openapi();
  spec.paths["/user-settings"] = {
    get: {
      tags: ["user-settings"],
      operationId: "get_settings",
      responses: { 200: { description: "OK" } },
    },
  };
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  const result = await generate({ input, output, mutationOperations: ["start_login"] });
  assert.ok(!result.files.some((file) => file.startsWith("files/queries")));
  assert.ok(!result.files.some((file) => file.startsWith("auth/queries")));
  for (const file of ["files/mutations.ts", "auth/mutations.ts"]) {
    assert.doesNotMatch(await readFile(join(output, file), "utf8"), /Keys\b/);
  }
  const settings = await readFile(join(output, "user-settings/queries.ts"), "utf8");
  assert.match(settings, /export const userSettingsKeys = \{/);
  assert.match(settings, /all: \["user-settings"\] as const/);
  assert.match(settings, /getSettings: \(\) => \["user-settings", "getSettings"\] as const/);
  assert.match(settings, /queryKey: userSettingsKeys\.getSettings\(\)/);
  assert.match(await readFile(join(output, "index.ts"), "utf8"), /export \* as userSettings/);
  assert.deepEqual(typecheck(output, result.files), []);
});

test("rejects removed and unknown configuration options", async () => {
  const directory = join(root, "removed");
  await mkdir(directory);
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  const legacy = (extra: object) => ({ input, output, ...extra }) as Parameters<typeof generate>[0];
  await assert.rejects(
    generate(legacy({ features: {} })),
    /^Error: "features" was removed in lit-canon-api 1\.0\. See docs\/migration\.md\.$/,
  );
  await assert.rejects(
    generate(legacy({ queryAliases: { items: {} } })),
    /"queryAliases" was removed in lit-canon-api 1\.0\. See docs\/migration\.md\./,
  );
  await assert.rejects(
    generate(legacy({ excludeTag: ["system"] })),
    /^Error: Unknown configuration option "excludeTag"\. Did you mean "excludeTags"\?$/,
  );
  await assert.rejects(
    generate(legacy({ somethingElse: true })),
    /^Error: Unknown configuration option "somethingElse"\.$/,
  );
  assert.deepEqual(await readdir(directory), ["openapi.json"]);
});

test("CLI uses generate and check commands, the default config file name and paths relative to it", async () => {
  const directory = join(root, "cli");
  await mkdir(directory);
  await writeFile(join(directory, "openapi.json"), JSON.stringify(openapi()));
  await writeFile(
    join(directory, "lit-canon-api.config.ts"),
    `
import { defineConfig } from "lit-canon-api";
export default defineConfig({
  input: "openapi.json", output: "src/deep/client", excludeTags: ["system"],
});`,
  );
  const generated = await run(process.execPath, [cli, "generate"], { cwd: directory });
  assert.match(generated.stdout, /Generated client: .*client \(4 resources\)/);
  const checked = await run(process.execPath, [cli, "check"], { cwd: directory });
  assert.match(checked.stdout, /Client is current: .*client \(4 resources\)/);
  assert.match(
    await readFile(join(directory, "src/deep/client/items/queries.ts"), "utf8"),
    /itemsKeys/,
  );

  // Paths resolve against the config file, not the working directory.
  await run(
    process.execPath,
    [cli, "check", "--config", join(directory, "lit-canon-api.config.ts")],
    {
      cwd: root,
    },
  );

  const help = await run(process.execPath, [cli, "--help"]);
  assert.match(help.stdout, /^Usage: lit-canon-api <command>/);
  assert.match(help.stdout, /lit-canon-api\.config\.ts/);
  for (const [args, message] of [
    [[], /Missing command\./],
    [["--check"], /Unknown option '--check'/],
    [["regenerate"], /Unknown command "regenerate"\./],
    [["generate", "extra"], /Unexpected argument "extra"\./],
    [["check", "--watch"], /--watch only works with generate\./],
    [["check", "--config", "missing.config.ts"], /Config file not found: .*missing\.config\.ts/],
  ] as const) {
    await assert.rejects(run(process.execPath, [cli, ...args], { cwd: directory }), (error) => {
      const { stderr } = error as { stderr: string };
      assert.match(stderr, /^lit-canon-api: /);
      assert.match(stderr, message);
      assert.doesNotMatch(stderr, /Require stack/);
      return true;
    });
  }

  await writeFile(
    join(directory, "legacy.config.ts"),
    `export default { input: "openapi.json", output: "src/deep/client", features: {} };`,
  );
  await assert.rejects(
    run(process.execPath, [cli, "generate", "--config", "legacy.config.ts"], { cwd: directory }),
    (error) => {
      assert.match(
        (error as { stderr: string }).stderr,
        /^lit-canon-api: "features" was removed in lit-canon-api 1\.0\. See docs\/migration\.md\./,
      );
      return true;
    },
  );
});

test("CLI watch mode regenerates after input and config changes and survives errors", async () => {
  const directory = join(root, "cli-watch");
  await mkdir(directory);
  const input = join(directory, "openapi.json");
  await writeFile(input, JSON.stringify(openapi()));
  const config = (exclude: string[]) =>
    `export default { input: "openapi.json", output: "generated", excludeTags: ${JSON.stringify(exclude)} };`;
  await writeFile(join(directory, "lit-canon-api.config.ts"), config(["system"]));

  const child = spawn(process.execPath, [cli, "generate", "--watch"], { cwd: directory });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => (stdout += chunk));
  child.stderr.on("data", (chunk) => (stderr += chunk));
  const waitFor = async (read: () => string, pattern: RegExp, count: number) => {
    const deadline = Date.now() + 30_000;
    while ((read().match(new RegExp(pattern, "g")) ?? []).length < count) {
      assert.ok(Date.now() < deadline, `Timed out waiting for ${pattern}:\n${stdout}${stderr}`);
      await new Promise((done) => setTimeout(done, 50));
    }
  };
  try {
    await waitFor(() => stdout, /Watching for changes/, 1);
    assert.match(stdout, /Generated client: .*\(4 resources\)/);

    // A broken input reports the error and keeps watching.
    await writeFile(input, "{");
    await waitFor(() => stderr, /Could not parse the OpenAPI input/, 1);
    await waitFor(() => stdout, /Watching for changes/, 2);

    await writeFile(input, JSON.stringify(openapi()));
    await waitFor(() => stdout, /Generated client/, 2);
    await waitFor(() => stdout, /Watching for changes/, 3);

    // A changed config is loaded again instead of being served from the module cache.
    await writeFile(join(directory, "lit-canon-api.config.ts"), config([]));
    await waitFor(() => stdout, /\(5 resources\)/, 1);
  } finally {
    child.kill();
  }
});

test("imports a custom request module relative to each resource and keeps it outside the output", async () => {
  const directory = join(root, "custom-request");
  await mkdir(join(directory, "src/api"), { recursive: true });
  const input = join(directory, "openapi.json");
  await writeFile(input, JSON.stringify(openapi()));
  await writeFile(
    join(directory, "src/api/request.ts"),
    `export type ApiRequestOptions = Omit<RequestInit, "body"> & { body?: unknown; query?: object };
export class ApiError<P = unknown> extends Error {
  constructor(readonly status: number, readonly problem: P | null) { super(String(status)); }
}
export function apiFetch<T>(url: string, options?: ApiRequestOptions): Promise<T> {
  return fetch(url, options as RequestInit).then((response) => response.json() as Promise<T>);
}
`,
  );
  const output = join(directory, "src/api/generated");
  const config = {
    input,
    output,
    request: { path: "src/api/request.ts", typeExports: ["ApiRequestOptions"] },
  };
  const result = await generate(config, { cwd: directory });
  const api = await readFile(join(output, "items/api.ts"), "utf8");
  assert.match(api, /from "\.\.\/\.\.\/request"/);
  assert.doesNotMatch(api, /lit-canon-fetch/);
  const barrel = await readFile(join(output, "items/index.ts"), "utf8");
  assert.match(barrel, /export \{ ApiError \} from "\.\.\/\.\.\/request";/);
  assert.match(barrel, /export type \{ ApiRequestOptions \} from "\.\.\/\.\.\/request";/);
  assert.deepEqual(typecheck(output, result.files), []);
  await assert.rejects(
    generate({ ...config, output: "src/api" }, { cwd: directory }),
    /dedicated generated directory/,
  );
});

test("matches the committed catalog example output", async () => {
  const catalog = resolve("../../examples/catalog");
  const directory = join(root, "catalog");
  await mkdir(directory);
  await cp(join(catalog, "openapi.json"), join(directory, "openapi.json"));
  const output = join(directory, "generated");
  const result = await generate({ input: "openapi.json", output: "generated" }, { cwd: directory });
  for (const file of result.files) {
    assert.equal(
      await readFile(join(output, file), "utf8"),
      (await readFile(join(catalog, "generated", file), "utf8")).replace(/\r\n/g, "\n"),
      `${file} differs from examples/catalog/generated; run pnpm example:generate`,
    );
  }
  assert.deepEqual(
    result.files,
    (await readdir(join(catalog, "generated"), { recursive: true }))
      .map((file) => file.split("\\").join("/"))
      .filter((file) => file.endsWith(".ts"))
      .sort(),
  );
});

test("refuses unsafe output and preserves the old client after transformation failures", async () => {
  const directory = join(root, "safety");
  await mkdir(directory);
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  await generate({ input, output });
  const existing = await readFile(join(output, "index.ts"), "utf8");
  await assert.rejects(generate({ input, output: directory }), /dedicated generated directory/);
  const changed = openapi();
  changed.paths["/items"]!.get!.operationId = "create_item";
  await writeFile(input, JSON.stringify(changed));
  await assert.rejects(generate({ input, output }), /Duplicate/);
  assert.equal(await readFile(join(output, "index.ts"), "utf8"), existing);
  await writeFile(input, JSON.stringify(openapi()));
  await writeFile(join(output, "manual.ts"), "export const manual = true;");
  await assert.rejects(generate({ input, output }), /not owned by the generator/);
  assert.equal(await readFile(join(output, "manual.ts"), "utf8"), "export const manual = true;");
  assert.ok(
    !(await readdir(directory)).some((name) => name.startsWith(".generated.lit-canon-api-")),
  );
});

test("replaces clients written by earlier versions with an Orval header", async () => {
  const directory = join(root, "upgrade");
  await mkdir(join(directory, "generated/items"), { recursive: true });
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  await writeFile(
    join(output, "items/api.ts"),
    "/**\n * Generated by orval\n * Do not edit manually.\n */\nexport {};\n",
  );
  await generate({ input, output });
  assert.match(await readFile(join(output, "items/api.ts"), "utf8"), /Generated by lit-canon-api/);
});

test("generates problem unions from referenced responses, oneOf and anyOf, with optional codes", async () => {
  const directory = join(root, "problems");
  await mkdir(directory);
  const spec = openapi();
  const properties = {
    type: { type: "string" as const },
    title: { type: "string" as const },
    status: { type: "integer" as const },
  };
  spec.components!.schemas!.ProblemDetails = {
    type: "object",
    properties,
  };
  spec.components!.schemas!.not_found = {
    type: "object",
    required: ["type", "title", "status", "code"],
    properties: { ...properties, code: { type: "integer", enum: [404] } },
  };
  const details = { $ref: "#/components/schemas/ProblemDetails" };
  const notFound = { $ref: "#/components/schemas/not_found" };
  spec.components!.responses = {
    Failed: {
      description: "Failed",
      content: { "application/problem+json": { schema: { oneOf: [notFound, details] } } },
    },
  };
  spec.paths["/items"]!.get!.responses![400] = { $ref: "#/components/responses/Failed" };
  spec.paths["/items/{itemId}"]!.get!.responses![404] = {
    description: "Not found",
    content: { "application/problem+json": { schema: { anyOf: [notFound] } } },
  };
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  const result = await generate({ input, output, problems: true });
  const source = await readFile(join(output, "items/problems.ts"), "utf8");
  assert.match(source, /from "lit-canon-fetch"/);
  assert.match(source, /ListItemsProblem = NotFound \| ProblemDetails/);
  assert.match(source, /GetItemProblem = NotFound/);
  assert.match(source, /CreateItemProblem = never/);
  assert.match(source, /Extract<ItemsProblem/);
  assert.match(
    await readFile(join(output, "admin/problems.ts"), "utf8"),
    /ListAdminProblem = never/,
  );
  assert.match(await readFile(join(output, "items/index.ts"), "utf8"), /\.\/problems/);
  assert.deepEqual(typecheck(output, result.files), []);
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
  }).outputText;
  const compiledPath = join(directory, "problems.js");
  await writeFile(compiledPath, compiled);
  const { isItemsError } = await import(pathToFileURL(compiledPath).href);
  assert.equal(
    isItemsError(new ApiError(404, { type: "missing", title: "Missing", status: 404 })),
    true,
  );
  assert.equal(isItemsError(new Error("Offline")), false);
  // Only documented statuses with a problem body belong to the resource.
  assert.equal(isItemsError(new ApiError(404, null)), false);
  assert.equal(
    isItemsError(new ApiError(502, { type: "gateway", title: "Bad gateway", status: 502 })),
    false,
  );
  assert.match(
    source,
    /error\.problem !== null &&\s+\(error\.status === 400 \|\| error\.status === 404\)/,
  );
  assert.match(source, /error is ApiError<ItemsProblem> & \{ problem: ItemsProblem \}/);
  const failed = spec.paths["/items"]!.get!.responses![400];
  delete spec.paths["/items"]!.get!.responses![400];
  spec.paths["/items"]!.get!.responses!["5XX"] = failed;
  await writeFile(input, JSON.stringify(spec));
  await generate({ input, output });
  assert.match(
    await readFile(join(output, "items/problems.ts"), "utf8"),
    /\(error\.status === 404 \|\|\s+Math\.floor\(error\.status \/ 100\) === 5\)/,
  );
  spec.paths["/items"]!.get!.responses!.default = failed;
  await writeFile(input, JSON.stringify(spec));
  await generate({ input, output });
  assert.match(
    await readFile(join(output, "items/problems.ts"), "utf8"),
    /return error instanceof ApiError && error\.problem !== null;\s+\}/,
  );
  const disabled = await generate({ input, output, problems: false });
  assert.ok(!disabled.files.some((file) => file.endsWith("problems.ts")));
  spec.paths["/items"]!.get!.responses![400] = {
    description: "Inline problem",
    content: { "application/problem+json": { schema: { type: "object" } } },
  };
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /Problem responses require named local schemas/,
  );
  await generate({ input, output, problems: false });
});

test("preserves separately generated directories, binary files and empty directories during regeneration", async () => {
  const directory = join(root, "preserved");
  await mkdir(directory);
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  const config = { input, output, preserveDirectories: ["rpc"] };
  await writeFile(input, JSON.stringify(openapi()));
  const initial = await generate(config);
  const rpc = join(output, "rpc");
  await mkdir(join(rpc, "empty"), { recursive: true });
  const bytes = Buffer.from([0, 255, 128, 10]);
  await writeFile(join(rpc, "manifest.json"), '{"generator":"rpc"}');
  await writeFile(join(rpc, "asset.bin"), bytes);
  const checked = await generate(config, { check: true });
  assert.deepEqual(checked.files, initial.files);
  await writeFile(join(rpc, "manifest.json"), '{"generator":"rpc","revision":2}');
  const spec = openapi();
  delete spec.paths["/upload"];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate(config, { check: true }), /out of date/);
  assert.ok((await readdir(output)).includes("files"));
  await generate(config);
  assert.ok(!(await readdir(output)).includes("files"));
  assert.deepEqual(await readFile(join(rpc, "asset.bin")), bytes);
  assert.equal(
    await readFile(join(rpc, "manifest.json"), "utf8"),
    '{"generator":"rpc","revision":2}',
  );
  assert.deepEqual(await readdir(join(rpc, "empty")), []);
  await generate(config, { check: true });
  await assert.rejects(
    generate({ ...config, preserveDirectories: ["rpc", "items"] }),
    /conflicts with a preserved directory/,
  );
  await assert.rejects(
    generate({ ...config, preserveDirectories: ["../rpc"] }),
    /top-level directory names/,
  );
  await assert.rejects(
    generate({ ...config, preserveDirectories: ["rpc", "index.ts"] }),
    /top-level directory names/,
  );
  const other = join(directory, "manual");
  await mkdir(other);
  await symlink(other, join(rpc, "link"), "junction");
  await assert.rejects(generate(config), /containing a symlink/);
});

test("keeps TanStack's abort signal when path inputs are named signal", async () => {
  const directory = join(root, "signals");
  await mkdir(directory);
  const spec = openapi();
  spec.paths["/signals/{signal}/{querySignal}"] = {
    get: {
      operationId: "read_signal",
      tags: ["items"],
      parameters: ["signal", "querySignal"].map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        200: { description: "OK", content: { "application/json": { schema: { type: "string" } } } },
      },
    },
  };
  const escapedPath = "/escaped/`/$literal/\\/{item_id}/{scope.id}/{class}";
  spec.paths[escapedPath] = {
    get: {
      operationId: "read_escaped_path",
      tags: ["items"],
      parameters: ["item_id", "scope.id", "class"].map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string" },
      })),
      responses: {
        200: { description: "OK", content: { "application/json": { schema: { type: "string" } } } },
      },
    },
  };
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  const result = await generate({ input, output });
  assert.deepEqual(typecheck(output, result.files), []);
  const items = join(output, "items");
  await compile(items, ["api", "queries"]);
  const requests: Array<{ url: RequestInfo | URL; signal: AbortSignal | null | undefined }> = [];
  configureApiFetch({
    fetch: async (url, init) => {
      requests.push({ url, signal: init?.signal });
      return new Response('"ok"', { headers: { "content-type": "application/json" } });
    },
  });
  const { listItemsQuery, readSignalQuery, readEscapedPathQuery } = await import(
    pathToFileURL(join(items, "queries.js")).href
  );
  const signal = new AbortController().signal;
  await listItemsQuery().queryFn({ signal });
  await readSignalQuery("a/b", "c/d").queryFn({ signal });
  await readEscapedPathQuery("a/b", "c/d", "e/f").queryFn({ signal });
  assert.equal(requests[0].signal, signal);
  assert.equal(requests[1].signal, signal);
  assert.equal(requests[1].url, "/signals/a%2Fb/c%2Fd");
  assert.equal(requests[2].url, "/escaped/`/$literal/\\/a%2Fb/c%2Fd/e%2Ff");
  assert.deepEqual(readSignalQuery("a", "b").queryKey, ["items", "readSignal", "a", "b"]);
});

test("rejects generated name collisions and unsupported parameter serialization without replacing the client", async () => {
  const directory = join(root, "invalid");
  await mkdir(directory);
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  await generate({ input, output });
  const existing = await readFile(join(output, "index.ts"), "utf8");
  const spec = openapi();
  spec.paths["/items/{itemId}"]!.get!.operationId = "list_items_query";
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /Duplicate generated resource export/);
  spec.paths["/items/{itemId}"]!.get!.operationId = "items_keys";
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /Duplicate generated resource export: itemsKeys/,
  );
  spec.paths["/items/{itemId}"]!.get!.operationId = "all";
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /"all" conflicts with itemsKeys\.all/);
  spec.paths["/items/{itemId}"]!.get!.operationId = "query_options";
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /conflicts with a generated import/);
  spec.paths["/items/{itemId}"]!.get!.operationId = "get_item";
  spec.paths["/items"]!.get!.parameters = [
    { name: "session", in: "cookie", schema: { type: "string" } },
  ];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /Unsupported cookie parameter/);
  spec.paths["/items"]!.get!.parameters = [
    { name: "Authorization", in: "header", schema: { type: "string" } },
  ];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /Header parameter Authorization in GET \/items is ignored by OpenAPI/,
  );
  spec.paths["/items"]!.get!.parameters = [
    { name: "filters", in: "query", style: "deepObject", schema: { type: "object" } },
  ];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /Unsupported serialization/);
  spec.paths["/items"]!.get!.parameters = [
    { name: "filters", in: "query", schema: { $ref: "#/components/schemas/Item" } },
  ];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /Unsupported object or array parameter/);
  assert.equal(await readFile(join(output, "index.ts"), "utf8"), existing);
});

test("converts tags such as Title Case or PascalCase to resource directories", async () => {
  const directory = join(root, "tag-names");
  await mkdir(directory);
  const spec = openapi();
  for (const pathItem of Object.values(spec.paths)) {
    for (const operation of Object.values(pathItem!)) {
      const tags = (operation as { tags?: string[] }).tags;
      if (tags?.[0] === "items") tags[0] = "Item Store";
      if (tags?.[0] === "admin") tags[0] = "AdminPanel";
      if (tags?.[0] === "system") tags[0] = "System";
    }
  }
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  const result = await generate({ input, output, excludeTags: ["System"] });
  assert.deepEqual(result.tags, ["admin-panel", "auth", "files", "item-store"]);
  const index = await readFile(join(output, "index.ts"), "utf8");
  assert.match(index, /export \* as itemStore from "\.\/item-store";/);
  assert.match(index, /export \* as adminPanel from "\.\/admin-panel";/);
  const queries = await readFile(join(output, "item-store/queries.ts"), "utf8");
  assert.match(queries, /export const itemStoreKeys = \{\s+all: \["item-store"\] as const,/);
  assert.match(await readFile(join(output, "item-store/api.ts"), "utf8"), /export const getItem/);
  assert.deepEqual(typecheck(output, result.files), []);

  spec.paths["/admin"]!.get!.tags = ["admin-panel"];
  spec.paths["/admin"]!.post = {
    tags: ["AdminPanel"],
    operationId: "reset_admin",
    responses: { 204: { description: "Reset" } },
  };
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /OpenAPI tag "admin-panel" and OpenAPI tag "AdminPanel" both map to the resource admin-panel/,
  );
  spec.paths["/admin"]!.get!.tags = ["Über Admin"];
  delete spec.paths["/admin"]!.post;
  await writeFile(input, JSON.stringify(spec));
  assert.ok((await generate({ input, output })).tags.includes("uber-admin"));
  spec.paths["/admin"]!.get!.tags = ["管理"];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /tag cannot be used as a resource directory: 管理/,
  );
});

test("collects operations without a tag in the defaultTag resource", async () => {
  const directory = join(root, "default-tag");
  await mkdir(directory);
  const spec = openapi();
  delete spec.paths["/admin"]!.get!.tags;
  spec.paths["/health"] = {
    get: {
      operationId: "get_health",
      responses: {
        200: { description: "OK", content: { "application/json": { schema: { type: "string" } } } },
      },
    },
  };
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(
    generate({ input, output }),
    /GET \/admin needs exactly one OpenAPI tag \(or set defaultTag\)/,
  );
  const result = await generate({ input, output, defaultTag: "General", excludeTags: ["system"] });
  assert.deepEqual(result.tags, ["auth", "files", "general", "items"]);
  const api = await readFile(join(output, "general/api.ts"), "utf8");
  assert.match(api, /export const listAdmin/);
  assert.match(api, /export const getHealth/);
  assert.doesNotMatch(api, /listItems|ping/);
  assert.match(
    await readFile(join(output, "general/queries.ts"), "utf8"),
    /all: \["general"\] as const/,
  );
  assert.deepEqual(typecheck(output, result.files), []);
  await assert.rejects(
    generate({ input, output, defaultTag: "Items" }),
    /OpenAPI tag "items" and defaultTag "Items" both map to the resource items|defaultTag "Items" and OpenAPI tag "items" both map to the resource items/,
  );
  const excluded = await generate({
    input,
    output,
    defaultTag: "general",
    excludeTags: ["general", "system"],
  });
  assert.deepEqual(excluded.tags, ["auth", "files", "items"]);
});

test("generates typed header parameters that call-site headers can override", async () => {
  const directory = join(root, "header-parameters");
  await mkdir(directory);
  const spec = openapi();
  spec.paths["/items/{itemId}"]!.get!.parameters = [
    { name: "X-Tenant-Id", in: "header", required: true, schema: { type: "string" } },
    { name: "If-None-Match", in: "header", schema: { type: "string" } },
  ];
  const input = join(directory, "openapi.json");
  const output = join(directory, "generated");
  await writeFile(input, JSON.stringify(spec));
  const result = await generate({ input, output });
  assert.deepEqual(typecheck(output, result.files), []);
  const items = join(output, "items");
  const api = await readFile(join(items, "api.ts"), "utf8");
  assert.match(api, /headers: GetItemHeaders/);
  assert.match(await readFile(join(items, "models.ts"), "utf8"), /"X-Tenant-Id": string;/);
  await compile(items, ["api", "queries"]);
  const sent: Headers[] = [];
  configureApiFetch({
    headers: { "x-tenant-id": "from-config" },
    fetch: async (_url, init) => {
      sent.push(new Headers(init?.headers));
      return new Response('{"id":"1"}', { headers: { "content-type": "application/json" } });
    },
  });
  const { getItem } = await import(pathToFileURL(join(items, "api.js")).href);
  const { getItemQuery } = await import(pathToFileURL(join(items, "queries.js")).href);
  await getItem("1", { "X-Tenant-Id": "t1", "If-None-Match": undefined });
  await getItem(
    "1",
    { "X-Tenant-Id": "t1", "If-None-Match": '"v1"' },
    { headers: { "x-tenant-id": "call" } },
  );
  await getItemQuery("1", { "X-Tenant-Id": "t2" }).queryFn({
    signal: new AbortController().signal,
  });
  assert.equal(sent[0].get("x-tenant-id"), "t1");
  assert.equal(sent[0].has("if-none-match"), false);
  assert.equal(sent[1].get("x-tenant-id"), "call");
  assert.equal(sent[1].get("if-none-match"), '"v1"');
  assert.equal(sent[2].get("x-tenant-id"), "t2");
  assert.deepEqual(getItemQuery("1", { "X-Tenant-Id": "t2" }).queryKey, [
    "items",
    "getItem",
    "1",
    { "X-Tenant-Id": "t2" },
  ]);
});

test("reads YAML files and http(s) URLs like JSON files", async () => {
  const directory = join(root, "input-formats");
  await mkdir(directory);
  const spec = openapi();
  const jsonInput = join(directory, "openapi.json");
  const yamlInput = join(directory, "openapi.yaml");
  await writeFile(jsonInput, JSON.stringify(spec));
  await writeFile(yamlInput, stringifyYaml(spec));
  const fromJson = await generate({ input: jsonInput, output: join(directory, "json") });
  const fromYaml = await generate({ input: yamlInput, output: join(directory, "yaml") });
  assert.deepEqual(fromYaml.files, fromJson.files);
  for (const file of fromJson.files) {
    assert.equal(
      await readFile(join(directory, "yaml", file), "utf8"),
      await readFile(join(directory, "json", file), "utf8"),
    );
  }

  let requests = 0;
  const server = createServer((request, response) => {
    requests += 1;
    if (request.url === "/openapi.yaml") {
      response.setHeader("content-type", "application/yaml");
      response.end(stringifyYaml(spec));
    } else {
      response.statusCode = 404;
      response.end();
    }
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  try {
    const { port } = server.address() as AddressInfo;
    const fromUrl = await generate({
      input: `http://127.0.0.1:${port}/openapi.yaml`,
      output: join(directory, "url"),
    });
    // Orval reads the downloaded copy, so the document is fetched once.
    assert.equal(requests, 1);
    for (const file of fromJson.files) {
      assert.equal(
        await readFile(join(directory, "url", file), "utf8"),
        await readFile(join(directory, "json", file), "utf8"),
      );
    }
    assert.deepEqual(fromUrl.tags, fromJson.tags);
    await assert.rejects(
      generate({ input: `http://127.0.0.1:${port}/missing.json`, output: join(directory, "url") }),
      /Could not fetch the OpenAPI input http:\/\/127\.0\.0\.1:\d+\/missing\.json: HTTP 404/,
    );
  } finally {
    server.close();
  }

  await writeFile(yamlInput, "openapi: [");
  await assert.rejects(
    generate({ input: yamlInput, output: join(directory, "yaml") }),
    /Could not parse the OpenAPI input/,
  );
});
