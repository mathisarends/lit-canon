import { resolve } from "node:path";
import { generate } from "../dist/index.js";
import config from "../examples/maximus-trading.config.ts";

if (!process.argv[2]) {
  console.error("Usage: node test/maximus-parity.ts <path/to/maximus-trading/frontend>");
  process.exitCode = 1;
} else {
  const result = await generate(config, { cwd: resolve(process.argv[2]), check: true });
  console.log(
    `Maximus parity verified: ${result.files.length} files in ${result.tags.length} features match exactly.`,
  );
}
