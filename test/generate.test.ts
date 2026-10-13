import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import ts from "typescript";
import { generate } from "../dist/index.js";
import { ApiError, configureApiFetch } from "../dist/runtime.js";
import { openapi } from "./fixtures.ts";

let root: string;
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

test("generates and executes clients, queries and mutations; detects drift without writes", async () => {
  const input = join(root, "openapi.json");
  const output = join(root, "generated");
  await writeFile(input, JSON.stringify(openapi()));
  const config = { input, output, excludeTags: ["system"], mutationOperations: ["start_login"] };
  const result = await generate(config);
  assert.deepEqual(result.tags, ["admin", "auth", "files", "items"]);
  assert.ok(!result.files.includes("auth/queries.ts"));
  assert.ok(result.files.includes("auth/mutations.ts"));
  const api = await readFile(join(output, "items/api.ts"), "utf8");
  assert.match(api, /encodeURIComponent\(itemId\)/);
  assert.match(api, /query: params/);
  assert.match(api, /body: request/);
  assert.doesNotMatch(api, /getListItemsUrl|JSON.stringify|getHeaders/);
  const queries = await readFile(join(output, "items/queries.ts"), "utf8");
  assert.match(queries, /params \?\? null/);
  assert.match(queries, /signal/);
  const admin = await readFile(join(output, "admin/queries.ts"), "utf8");
  assert.doesNotMatch(admin, /admin-auth|adminHeaders|hasAdminAccess/);
  const mutations = await readFile(join(output, "items/mutations.ts"), "utf8");
  assert.match(mutations, /Parameters<typeof deleteItem>\[1\]/);

  // Typecheck generated output, including optional mutation tuples and Lit Query inference.
  const program = ts.createProgram(
    result.files.map((file) => join(output, file)),
    {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    ts.formatDiagnosticsWithColorAndContext(diagnostics, {
      getCurrentDirectory: () => process.cwd(),
      getCanonicalFileName: (name) => name,
      getNewLine: () => "\n",
    }),
  );

  for (const file of result.files.filter((file) =>
    /items\/(?:api|queries|mutations)\.ts$/.test(file),
  )) {
    const source = await readFile(join(output, file), "utf8");
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(/from "\.\/api"/g, 'from "./api.js"');
    await writeFile(join(output, file.replace(/\.ts$/, ".js")), compiled);
  }
  const requests: Array<{ url: RequestInfo | URL; init: RequestInit }> = [];
  configureApiFetch({
    fetch: async (url, init) => {
      requests.push({ url, init: init ?? {} });
      return new Response(JSON.stringify({ id: "1", name: "Saved" }), {
        headers: { "content-type": "application/json" },
      });
    },
  });
  const { getItemQuery } = await import(pathToFileURL(join(output, "items/queries.js")).href);
  const { createItemMutation, deleteItemMutation } = await import(
    pathToFileURL(join(output, "items/mutations.js")).href
  );
  const signal = new AbortController().signal;
  await getItemQuery("a/b").queryFn({ signal });
  assert.equal(requests[0].url, "/items/a%2Fb");
  assert.equal(requests[0].init.signal, signal);
  await createItemMutation().mutationFn({ id: "2", name: "New" });
  assert.equal(requests[1].init.body, '{"id":"2","name":"New"}');
  await deleteItemMutation().mutationFn(["2", undefined]);
  assert.equal(requests[2].init.method, "DELETE");
  for (const file of ["api", "queries", "mutations"]) {
    await rm(join(output, "items", `${file}.js`));
  }
  await generate(config, { check: true });
  const stale = api.replace("Do not edit manually.", "Do not edit manually. Old version.");
  await writeFile(join(output, "items/api.ts"), stale);
  await assert.rejects(generate(config, { check: true }), /out of date/);
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

test("CLI resolves config paths from the config location and applies feature rules", async () => {
  const directory = join(root, "cli");
  await mkdir(directory);
  await writeFile(join(directory, "openapi.json"), JSON.stringify(openapi()));
  await writeFile(
    join(directory, "auth.ts"),
    `
export const authHeaders = () => new Headers();
export const authScope = () => 1;
export const hasAccess = () => true;
`,
  );
  await writeFile(
    join(directory, "client.config.ts"),
    `
import { defineConfig } from "lit-query-codegen";
export default defineConfig({
  input: "openapi.json", output: "src/deep/client", excludeTags: ["system"],
  features: { admin: {
    imports: [{ from: "./auth.ts", names: ["authHeaders", "authScope", "hasAccess"] }],
    requestOptions: "{ headers: authHeaders() }", queryKey: ["authScope()"], enabled: "hasAccess()",
  } },
  queryAliases: { admin: { administrators: { list: "list_admin" } } },
});`,
  );
  const cli = resolve("dist/cli.js");
  await promisify(execFile)(
    process.execPath,
    [cli, "--config", join(directory, "client.config.ts")],
    { cwd: root },
  );
  const query = await readFile(join(directory, "src/deep/client/admin/queries.ts"), "utf8");
  assert.match(query, /from "\.\.\/\.\.\/\.\.\/\.\.\/auth"/);
  assert.match(query, /enabled: hasAccess\(\)/);
  assert.match(query, /authScope\(\)/);
  assert.match(query, /headers: authHeaders\(\)/);
  assert.match(query, /administrators/);
  await promisify(execFile)(process.execPath, [
    cli,
    "--config",
    join(directory, "client.config.ts"),
    "--check",
  ]);
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
  await assert.rejects(
    generate({ input, output, queryAliases: { items: { invalid: { list: "missing" } } } }),
    /no generated operation/,
  );
  assert.equal(await readFile(join(output, "index.ts"), "utf8"), existing);
  await writeFile(join(output, "manual.ts"), "export const manual = true;");
  await assert.rejects(generate({ input, output }), /not owned by the generator/);
  assert.equal(await readFile(join(output, "manual.ts"), "utf8"), "export const manual = true;");
  assert.ok(
    !(await readdir(directory)).some((name) => name.startsWith(".generated.lit-query-codegen-")),
  );
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
  assert.match(source, /ListItemsProblem = NotFound \| ProblemDetails/);
  assert.match(source, /GetItemProblem = NotFound/);
  assert.match(source, /CreateItemProblem = never/);
  assert.match(source, /Extract<ItemsProblem/);
  assert.match(
    await readFile(join(output, "admin/problems.ts"), "utf8"),
    /ListAdminProblem = never/,
  );
  assert.match(await readFile(join(output, "items/index.ts"), "utf8"), /\.\/problems/);
  const program = ts.createProgram(
    result.files.map((file) => join(output, file)),
    {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.deepEqual(
    diagnostics.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );
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

test("keeps TanStack's abort signal even with feature overrides and path inputs named signal", async () => {
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
  const result = await generate({
    input,
    output,
    features: {
      items: {
        requestOptions: '{ ...{ signal: AbortSignal.abort() }, ["signal"]: AbortSignal.abort() }',
      },
    },
  });
  const program = ts.createProgram(
    result.files.map((file) => join(output, file)),
    {
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
    },
  );
  assert.deepEqual(
    ts
      .getPreEmitDiagnostics(program)
      .map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n")),
    [],
  );
  for (const file of ["api", "queries"]) {
    const source = await readFile(join(output, `items/${file}.ts`), "utf8");
    const compiled = ts
      .transpileModule(source, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
      })
      .outputText.replace(/from "\.\/api"/g, 'from "./api.js"');
    await writeFile(join(output, `items/${file}.js`), compiled);
  }
  const requests: Array<{ url: RequestInfo | URL; signal: AbortSignal | null | undefined }> = [];
  configureApiFetch({
    fetch: async (url, init) => {
      requests.push({ url, signal: init?.signal });
      return new Response('"ok"', { headers: { "content-type": "application/json" } });
    },
  });
  const { listItemsQuery, readSignalQuery, readEscapedPathQuery } = await import(
    pathToFileURL(join(output, "items/queries.js")).href
  );
  const signal = new AbortController().signal;
  await listItemsQuery().queryFn({ signal });
  await readSignalQuery("a/b", "c/d").queryFn({ signal });
  await readEscapedPathQuery("a/b", "c/d", "e/f").queryFn({ signal });
  assert.equal(requests[0].signal, signal);
  assert.equal(requests[1].signal, signal);
  assert.equal(requests[1].url, "/signals/a%2Fb/c%2Fd");
  assert.equal(requests[2].url, "/escaped/`/$literal/\\/a%2Fb/c%2Fd/e%2Ff");
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
  await assert.rejects(generate({ input, output }), /Duplicate generated feature export/);
  spec.paths["/items/{itemId}"]!.get!.operationId = "query_options";
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /conflicts with a generated import/);
  await writeFile(input, JSON.stringify(openapi()));
  await assert.rejects(
    generate({ input, output, queryAliases: { items: { listItems: { list: "list_items" } } } }),
    /Duplicate generated feature export/,
  );
  await assert.rejects(
    generate({
      input,
      output,
      queryAliases: {
        items: {
          Item: { list: "list_items" },
        },
      },
    }),
    /Duplicate generated feature export: Item/,
  );
  await assert.rejects(
    generate({ input, output, queryAliases: { items: { items: { allKey: "list_items" } } } }),
    /Reserved query alias member/,
  );
  await assert.rejects(
    generate({
      input,
      output,
      features: {
        items: {
          imports: [{ from: "./custom.ts", names: ["listItems"] }],
          requestOptions: "listItems()",
        },
      },
    }),
    /Feature import conflicts with a generated binding/,
  );
  spec.paths["/items/{itemId}"]!.get!.operationId = "get_item";
  spec.paths["/items"]!.get!.parameters = [
    { name: "token", in: "header", schema: { type: "string" } },
  ];
  await writeFile(input, JSON.stringify(spec));
  await assert.rejects(generate({ input, output }), /Unsupported header parameter/);
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
