import type { Options as PrettierOptions } from "prettier";

export type OperationKind = "query" | "mutation";

export interface CodegenConfig {
  /**
   * OpenAPI 3 document in JSON or YAML: a file relative to the configuration file, or an
   * http(s) URL.
   */
  input: string;
  /** Directory owned by the generator, relative to the configuration file. */
  output: string;
  /** Defaults to the directory containing the config. */
  workspace?: string;
  /**
   * The module generated clients import apiFetch, ApiRequestOptions and ApiError from:
   * a package name, or a file relative to the configuration file such as
   * "./src/api/request.ts". Defaults to lit-canon-fetch.
   */
  runtime?: string;
  tags?: {
    /** OpenAPI tags, or their resource names, to leave out. */
    exclude?: string[];
    /** Resource for operations without an OpenAPI tag; without it, such operations fail. */
    fallback?: string;
  };
  /**
   * Overrides how operations are generated, keyed by camelCase function name. GET
   * operations default to queries, every other method to mutations.
   */
  operations?: Record<string, OperationKind>;
  /** Top-level output directories owned by another generator, e.g. ["rpc"]. */
  preserve?: string[];
  /**
   * "auto" (default) emits problem types for resources with problem responses, true for
   * every resource, false for none.
   */
  problems?: "auto" | boolean;
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

/** Options from earlier versions, with what happened to them. */
const removedOptions: Record<string, string> = {
  features: "removed in lit-canon-api 1.0",
  queryAliases: "removed in lit-canon-api 1.0",
  request: 'replaced by "runtime" in lit-canon-api 2.0',
  excludeTags: 'replaced by "tags.exclude" in lit-canon-api 2.0',
  defaultTag: 'replaced by "tags.fallback" in lit-canon-api 2.0',
  preserveDirectories: 'replaced by "preserve" in lit-canon-api 2.0',
  mutationOperations: 'replaced by "operations" in lit-canon-api 2.0',
};

const knownOptions: ReadonlyArray<keyof CodegenConfig> = [
  "input",
  "output",
  "workspace",
  "runtime",
  "tags",
  "operations",
  "preserve",
  "problems",
  "prettier",
];

/** Edit distance, to suggest the intended option for a typo. */
function distance(a: string, b: string): number {
  let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    for (let j = 1; j <= b.length; j++) {
      current[j] = Math.min(
        previous[j] + 1,
        current[j - 1] + 1,
        previous[j - 1] + (a[i - 1].toLowerCase() === b[j - 1].toLowerCase() ? 0 : 1),
      );
    }
    previous = current;
  }
  return previous[b.length];
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export function validateConfig(config: CodegenConfig): void {
  if (!config || typeof config.input !== "string" || typeof config.output !== "string") {
    throw new Error("Configuration requires input and output paths");
  }
  for (const [option, change] of Object.entries(removedOptions)) {
    if (Object.hasOwn(config, option)) {
      throw new Error(`"${option}" was ${change}. See docs/migration.md.`);
    }
  }
  // Configs written in JavaScript skip the type check, so check unknown keys at runtime.
  for (const option of Object.keys(config)) {
    if ((knownOptions as readonly string[]).includes(option)) {
      continue;
    }
    const [closest] = [...knownOptions].sort((a, b) => distance(option, a) - distance(option, b));
    const hint = distance(option, closest) <= 3 ? ` Did you mean "${closest}"?` : "";
    throw new Error(`Unknown configuration option "${option}".${hint}`);
  }
  if (config.runtime !== undefined && (typeof config.runtime !== "string" || !config.runtime)) {
    throw new Error("runtime must be a package name or a file path");
  }
  const tags = config.tags ?? {};
  for (const option of Object.keys(tags)) {
    if (option !== "exclude" && option !== "fallback") {
      throw new Error(`Unknown configuration option "tags.${option}"`);
    }
  }
  if (tags.exclude !== undefined && !isStringArray(tags.exclude)) {
    throw new Error("tags.exclude must be a list of tags");
  }
  if (tags.fallback !== undefined && typeof tags.fallback !== "string") {
    throw new Error("tags.fallback must be a string");
  }
  if (config.preserve !== undefined && !isStringArray(config.preserve)) {
    throw new Error("preserve must be a list of directory names");
  }
  for (const [name, kind] of Object.entries(config.operations ?? {})) {
    if (kind !== "query" && kind !== "mutation") {
      throw new Error(`operations.${name} must be "query" or "mutation"`);
    }
  }
  if (
    config.problems !== undefined &&
    config.problems !== "auto" &&
    typeof config.problems !== "boolean"
  ) {
    throw new Error('problems must be "auto", true or false');
  }
}
