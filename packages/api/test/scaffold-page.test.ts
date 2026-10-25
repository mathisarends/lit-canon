import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve, sep } from "node:path";
import { promisify } from "node:util";
import { after, before, test } from "node:test";
import ts from "typescript";
import { generate, scaffoldPage, type PageScaffoldOptions } from "../dist/index.js";
import { openapi } from "./fixtures.ts";

const run = promisify(execFile);
let root: string;
const config = {
  input: "openapi.json",
  output: "generated",
  excludeTags: ["system"],
  mutationOperations: ["start_login"],
};
before(async () => {
  await mkdir(resolve(".test-output"), { recursive: true });
  root = await mkdtemp(resolve(".test-output/scaffold-"));
  await writeFile(join(root, "openapi.json"), JSON.stringify(openapi()));
  await generate(config, { cwd: root });
});
after(async () => {
  assert.ok(root.startsWith(resolve(".test-output") + sep));
  await rm(root, { recursive: true, force: true });
});
const options = (feature: string): PageScaffoldOptions => ({
  cwd: root,
  feature: `src/features/${feature}`,
  name: "detail",
  path: "/items/:id",
  queries: ["item=get_item"],
  bindings: ["item.itemId=id"],
});

function diagnostics(files: string[]) {
  const program = ts.createProgram(files, {
    strict: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    skipLibCheck: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
  });
  return ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));
}

test("scaffolds shared options, lazy page, controllers and explicit registration that typecheck", async () => {
  const result = await scaffoldPage(config, {
    ...options("items"),
    queries: ["item=get_item", "catalog=list_items"],
  });
  assert.equal(result.files.length, 4);
  assert.deepEqual(diagnostics(result.files), []);
  const queries = await readFile(join(result.feature, "pages/detail.queries.ts"), "utf8");
  assert.match(queries, /items\.getItemQuery\(params\.id\)/);
  assert.match(queries, /items\.listItemsQuery\(\)/);
  assert.match(queries, /staleTime: 30_000/);
  const route = await readFile(join(result.feature, "detail.route.ts"), "utf8");
  assert.match(route, /prefetchQueries\(\(\{ params \}\) => itemsDetailQueries\(params\)\)/);
  assert.match(route, /load: \(\) => import\("\.\/pages\/detail-page.js"\)/);
  const page = await readFile(join(result.feature, "pages/detail-page.ts"), "utf8");
  assert.match(page, /itemsDetailQueries\(this.params\).item/);
  assert.doesNotMatch(page, /new QueryClient|fetch\(/);

  // API regeneration has no ownership of application files, even after edits.
  const component = join(result.feature, "pages/detail-page.ts");
  await writeFile(component, page + "\n// Application edit.\n");
  await generate(config, { cwd: root });
  assert.match(await readFile(component, "utf8"), /Application edit/);
  await generate(config, { cwd: root, check: true });
});

test("adds a page to an existing feature while preserving layout and providers", async () => {
  const opts = options("existing");
  const directory = resolve(root, opts.feature);
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "index.ts"),
    `import { defineFeature } from "lit-canon-composition";
export const existingFeature = defineFeature({ name: "existing", pages: [], providers: [], layout: (content) => content });`,
  );
  const result = await scaffoldPage(config, opts);
  const index = await readFile(join(directory, "index.ts"), "utf8");
  assert.match(index, /providers: \[\]/);
  assert.match(index, /layout: \(content\) => content/);
  assert.match(index, /pages: \[existingDetail\]/);
  assert.deepEqual(diagnostics(result.files), []);
  // Add a second page, exercising commas and stable explicit imports.
  const second = await scaffoldPage(config, {
    ...opts,
    name: "list",
    path: "/items",
    queries: ["items=list_items"],
    bindings: [],
  });
  assert.deepEqual(diagnostics(second.files), []);
  assert.match(
    await readFile(join(directory, "index.ts"), "utf8"),
    /pages: \[existingDetail, existingList\]/,
  );
});

test("fails before writing on missing bindings, writes and unsupported paths", async () => {
  await assert.rejects(
    scaffoldPage(config, { ...options("missing"), bindings: [] }),
    /Missing --bind item.itemId/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("badparam"), bindings: ["item.itemId=other"] }),
    /Unknown route parameter/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("unused"), bindings: ["item.itemId=id", "item.extra=id"] }),
    /Unused binding/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("write"), queries: ["item=create_item"] }),
    /read operation/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("login"), queries: ["login=start_login"] }),
    /read operation/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("pattern"), path: "/items/:id?" }),
    /simple paths/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("outside"), feature: "../outside" }),
    /inside the project/,
  );
  await assert.rejects(
    scaffoldPage(config, { ...options("generated"), feature: "generated/items" }),
    /outside the generated/,
  );
  await assert.rejects(readFile(resolve(root, "src/features/missing/index.ts")), {
    code: "ENOENT",
  });
});

test("refuses application overwrites and dynamic registration without changing existing files", async () => {
  const opts = options("collision");
  const directory = resolve(root, opts.feature);
  await mkdir(join(directory, "pages"), { recursive: true });
  await writeFile(join(directory, "pages/detail-page.ts"), "// keep me");
  await assert.rejects(scaffoldPage(config, opts), /Refusing to overwrite/);
  assert.equal(await readFile(join(directory, "pages/detail-page.ts"), "utf8"), "// keep me");
  await assert.rejects(readFile(join(directory, "detail.route.ts")), { code: "ENOENT" });
  const dynamic = options("dynamic");
  const index = resolve(root, dynamic.feature, "index.ts");
  await mkdir(resolve(root, dynamic.feature), { recursive: true });
  const source =
    'export const dynamicFeature = defineFeature({ name: "dynamic", pages: getPages() });';
  await writeFile(index, source);
  await assert.rejects(scaffoldPage(config, dynamic), /explicit pages array/);
  assert.equal(await readFile(index, "utf8"), source);
  const collisionSource =
    'export const dynamicDetail = {}; export const dynamicFeature = defineFeature({ name: "dynamic", pages: [] });';
  await writeFile(index, collisionSource);
  await assert.rejects(scaffoldPage(config, dynamic), /already declares dynamicDetail/);
  assert.equal(await readFile(index, "utf8"), collisionSource);
});

test("CLI resolves paths against the config and requires explicit query bindings", async () => {
  await writeFile(
    join(root, "lit-canon-api.config.ts"),
    `export default ${JSON.stringify(config)};`,
  );
  const { stdout } = await run(process.execPath, [
    resolve("dist/cli.js"),
    "add-page",
    "--config",
    join(root, "lit-canon-api.config.ts"),
    "--feature",
    "src/features/cli",
    "--name",
    "detail",
    "--path",
    "/items/:id",
    "--query",
    "item=get_item",
    "--bind",
    "item.itemId=id",
  ]);
  assert.match(stdout, /4 editable files/);
  assert.match(
    await readFile(join(root, "src/features/cli/pages/detail.queries.ts"), "utf8"),
    /getItemQuery\(params.id\)/,
  );
});
