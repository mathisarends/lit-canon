#!/usr/bin/env node
import { parseArgs } from "node:util";
import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { generate } from "./index.js";
import type { CodegenConfig } from "./config.js";

const usage = `Usage: lit-canon-api <command> [--config <file.ts>]

Commands:
  generate  Generate the API client, query keys and query/mutation options.
  check     Compare a fresh generation with the existing client without changing it.
            Exits with code 1 when files are missing, changed or obsolete.

Options:
  -c, --config  Config file (default: lit-canon-api.config.ts).
                Paths in the config are resolved relative to it.
  -h, --help    Show this help.`;

try {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      config: { type: "string", short: "c", default: "lit-canon-api.config.ts" },
      help: { type: "boolean", short: "h", default: false },
    },
  });
  const [command, ...rest] = positionals;
  if (values.help) {
    console.log(usage);
  } else if ((command !== "generate" && command !== "check") || rest.length) {
    console.error(usage);
    process.exitCode = 1;
  } else {
    const check = command === "check";
    const configPath = resolve(values.config);
    const jiti = createJiti(import.meta.url);
    const config = await jiti.import<CodegenConfig>(configPath, { default: true });
    const result = await generate(config, { cwd: dirname(configPath), check });
    const count = result.tags.length;
    console.log(
      `${check ? "Client is current" : "Generated client"}: ${result.output} (${count} ${count === 1 ? "resource" : "resources"})`,
    );
  }
} catch (error) {
  console.error(`lit-canon-api: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
}
