import { dirname, resolve } from "node:path";
import { createJiti } from "jiti";
import { generate, type CodegenConfig } from "../dist/index.js";

if (!process.argv[2]) {
  console.error("Usage: node test/client-parity.ts <path/to/lit-query-codegen.config.ts>");
  process.exitCode = 1;
} else {
  const configPath = resolve(process.argv[2]);
  const jiti = createJiti(import.meta.url);
  const config = await jiti.import<CodegenConfig>(configPath, { default: true });
  const result = await generate(config, { cwd: dirname(configPath), check: true });
  console.log(
    `Client parity verified: ${result.files.length} files in ${result.tags.length} features match exactly.`,
  );
}
