import type { Options as PrettierOptions } from "prettier";

export interface CodegenConfig {
  /** Local OpenAPI 3 JSON file, relative to the configuration file. */
  input: string;
  /** Directory owned by the generator, relative to the configuration file. */
  output: string;
  /** Defaults to the directory containing the config. */
  workspace?: string;
  /** Defaults to lit-canon-fetch. Custom files export apiFetch and ApiRequestOptions. */
  request?: {
    path: string;
    exports?: string[];
    typeExports?: string[];
  };
  excludeTags?: string[];
  /** Top-level output directories owned by another generator, e.g. ["rpc"]. */
  preserveDirectories?: string[];
  /** Defaults to resources with problem responses. true also emits empty problem types. */
  problems?: boolean;
  /** OpenAPI operation IDs (snake_case) or generated function names (camelCase). */
  mutationOperations?: string[];
  /** Overrides the detected project Prettier configuration. */
  prettier?: PrettierOptions;
}

export interface GenerateOptions {
  /** Paths in config are resolved against this directory. */
  cwd?: string;
  /** Generate and compare without changing the output directory. */
  check?: boolean;
}

export interface GenerateResult {
  output: string;
  /** OpenAPI tags, one generated resource directory each. */
  tags: string[];
  files: string[];
}

const removedOptions = ["features", "queryAliases"] as const;

export function validateConfig(config: CodegenConfig): void {
  if (!config || typeof config.input !== "string" || typeof config.output !== "string") {
    throw new Error("Configuration requires input and output paths");
  }
  for (const option of removedOptions) {
    if (Object.hasOwn(config, option)) {
      throw new Error(`"${option}" was removed in lit-canon-api 1.0. See docs/migration.md.`);
    }
  }
}
