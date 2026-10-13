import type { Options as PrettierOptions } from "prettier";

export interface FeatureImport {
  /** File path relative to the config, or a bare module specifier. */
  from: string;
  names: string[];
}

export interface FeatureOptions {
  imports?: FeatureImport[];
  /** TypeScript expression returning ApiRequestOptions, e.g. "{ headers: authHeaders() }". */
  requestOptions?: string;
  /** Additional TypeScript expressions appended to each query key. */
  queryKey?: string[];
  /** TypeScript expression for the generated query's enabled option. */
  enabled?: string;
}

export interface CodegenConfig {
  /** Local OpenAPI 3 JSON file, relative to the configuration file. */
  input: string;
  /** Directory owned by the generator, relative to the configuration file. */
  output: string;
  /** Defaults to the directory containing the config. */
  workspace?: string;
  /** Defaults to lit-query-codegen/runtime. Custom files export apiFetch and ApiRequestOptions. */
  request?: {
    path: string;
    exports?: string[];
    typeExports?: string[];
  };
  excludeTags?: string[];
  /** Top-level output directories owned by another generator, e.g. ["rpc"]. */
  preserveDirectories?: string[];
  /** Defaults to features with problem responses. true also emits empty problem types. */
  problems?: boolean;
  /** OpenAPI operation IDs (snake_case) or generated function names (camelCase). */
  mutationOperations?: string[];
  features?: Record<string, FeatureOptions>;
  queryAliases?: Record<string, Record<string, Record<string, string>>>;
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
  tags: string[];
  files: string[];
}
