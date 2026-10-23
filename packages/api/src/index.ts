import type { CodegenConfig } from "./config.js";

export type {
  CodegenConfig,
  FeatureImport,
  FeatureOptions,
  GenerateOptions,
  GenerateResult,
} from "./config.js";
export { generate } from "./generate.js";

export function defineConfig<T extends CodegenConfig>(config: T): T {
  return config;
}
