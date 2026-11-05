import type { CodegenConfig } from "./config.js";

export type { CodegenConfig, GenerateOptions, GenerateResult, OperationKind } from "./config.js";
export { generate } from "./generate.js";
export { scaffoldPage, type PageScaffoldOptions } from "./scaffold-page.js";

/** Types a configuration file, so misspelled options fail the type check. */
export function defineConfig(config: CodegenConfig): CodegenConfig {
  return config;
}
