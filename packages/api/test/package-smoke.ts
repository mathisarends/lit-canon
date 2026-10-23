import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { openapi } from "./fixtures.ts";

const run = promisify(execFile);
const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("Run this test with npm run test:package");
}

const { stdout } = await run(process.execPath, [npmCli, "pack", "--json"], {
  cwd: process.cwd(),
});
const [{ filename }] = JSON.parse(stdout) as Array<{ filename: string }>;
const tarball = resolve(filename);
const root = await mkdtemp(join(tmpdir(), "lit-query-codegen-consumer-"));
const npm = (args: string[]) => run(process.execPath, [npmCli, ...args], { cwd: root });

try {
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: "independent-codegen-consumer",
      private: true,
      type: "module",
      scripts: { "api:generate": "lit-query-codegen", "api:check": "lit-query-codegen --check" },
    }),
  );
  await npm([
    "install",
    tarball,
    "@tanstack/lit-query@0.2.25",
    "--ignore-scripts",
    "--no-audit",
    "--no-fund",
  ]);
  await writeFile(join(root, "openapi.json"), JSON.stringify(openapi()));
  await writeFile(
    join(root, "lit-query-codegen.config.ts"),
    `
import { defineConfig, type CodegenConfig } from "lit-query-codegen";
const config: CodegenConfig = {
  input: "./openapi.json", output: "./src/api/generated",
  excludeTags: ["system"], mutationOperations: ["start_login"],
};
export default defineConfig(config);
`,
  );
  await writeFile(
    join(root, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: true,
      },
      include: ["src", "lit-query-codegen.config.ts"],
    }),
  );
  await npm(["run", "api:generate"]);
  await npm(["run", "api:check"]);
  await npm(["exec", "--", "tsc", "--noEmit"]);
  const api = await readFile(join(root, "src/api/generated/items/api.ts"), "utf8");
  assert.match(api, /lit-query-codegen\/runtime/);
  const runtime = await import(
    pathToFileURL(join(root, "node_modules/lit-query-codegen/dist/runtime.js")).href
  );
  assert.equal(typeof runtime.createApiFetch, "function");
  console.log(
    "Packed npm package verified in an independent project: CLI, TS config, client, drift check and typecheck.",
  );
} finally {
  assert.equal(dirname(root), resolve(tmpdir()));
  assert.ok(basename(root).startsWith("lit-query-codegen-consumer-"));
  await rm(root, { recursive: true, force: true });
}
