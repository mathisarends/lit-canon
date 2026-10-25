import type { CodegenConfig } from "./config.js";

export type { CodegenConfig, GenerateOptions, GenerateResult } from "./config.js";
export { generate } from "./generate.js";
export { scaffoldPage, type PageScaffoldOptions } from "./scaffold-page.js";

export function defineConfig<T extends CodegenConfig>(config: T): T {
  return config;
}
