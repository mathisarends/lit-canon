#!/usr/bin/env node
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { generate } from "./index.js";
import type { CodegenConfig } from "./config.js";

try {
  const { values } = parseArgs({
    options: {
      config: { type: "string", short: "c", default: "lit-query-codegen.config.ts" },
      check: { type: "boolean", default: false },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  if (values.help) {
    console.log(`Usage: lit-query-codegen [--config <file.ts>] [--check]

Generate an Orval client and TanStack Lit Query options.
Paths are resolved relative to the config file.
--check compares generated files without modifying the existing client.`);
  } else {
    const configPath = resolve(values.config);
    const jiti = createJiti(import.meta.url);
    const config = await jiti.import<CodegenConfig>(configPath, { default: true });
    const result = await generate(config, { cwd: dirname(configPath), check: values.check });
    console.log(
      `${values.check ? "Client is current" : "Generated client"}: ${result.output} (${result.tags.length} features)`,
    );
  }
} catch (error) {
  console.error(`lit-query-codegen: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
