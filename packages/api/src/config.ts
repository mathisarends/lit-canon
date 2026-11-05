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
  /** Resource for operations without an OpenAPI tag; without it, such operations fail. */
  defaultTag?: string;
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

const knownOptions: ReadonlyArray<keyof CodegenConfig> = [
  "input",
  "output",
  "workspace",
  "request",
  "excludeTags",
  "defaultTag",
  "preserveDirectories",
  "problems",
  "mutationOperations",
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

export function validateConfig(config: CodegenConfig): void {
  if (!config || typeof config.input !== "string" || typeof config.output !== "string") {
    throw new Error("Configuration requires input and output paths");
  }
  for (const option of removedOptions) {
    if (Object.hasOwn(config, option)) {
      throw new Error(`"${option}" was removed in lit-canon-api 1.0. See docs/migration.md.`);
    }
  }
  if (config.defaultTag !== undefined && typeof config.defaultTag !== "string") {
    throw new Error("defaultTag must be a string");
  }
  // defineConfig's generic signature does not reject unknown keys, so check at runtime.
  for (const option of Object.keys(config)) {
    if ((knownOptions as readonly string[]).includes(option)) {
      continue;
    }
    const [closest] = [...knownOptions].sort((a, b) => distance(option, a) - distance(option, b));
    const hint = distance(option, closest) <= 3 ? ` Did you mean "${closest}"?` : "";
    throw new Error(`Unknown configuration option "${option}".${hint}`);
  }
}
