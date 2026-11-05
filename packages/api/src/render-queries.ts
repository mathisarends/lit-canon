import type { Operations } from "./operation.js";
import type { OperationInput, OperationInputs } from "./render-api.js";

interface RenderQueryOptions {
  /** Module that exports ApiRequestOptions, e.g. "lit-canon-fetch". */
  requestImport: string;
}

/** `input: GetProductInput`, `input: ListProductsInput = {}` or nothing. */
function inputParameter(input: OperationInput | null): string[] {
  if (!input) {
    return [];
  }
  return [`input: ${input.type}${input.optional ? " = {}" : ""}`];
}

/**
 * One key function per operation. Without an input, a query key is the prefix of every
 * query of that operation, so it can invalidate them all.
 */
function renderKeys(
  tag: string,
  queryNames: string[],
  mutationNames: string[],
  inputs: OperationInputs,
): string {
  const key = (name: string, input = false) =>
    `[${[JSON.stringify(tag), JSON.stringify(name), ...(input ? ["input"] : [])].join(", ")}] as const`;
  const members = [
    ...queryNames.map((name) => {
      const input = inputs.get(name)!;
      if (!input) {
        return `${name}: () => ${key(name)},`;
      }
      return `${name}: (input?: ${input.type}) =>
        input === undefined ? ${key(name)} : (${key(name, true)}),`;
    }),
    ...mutationNames.map((name) => `${name}: () => ${key(name)},`),
  ];
  return `export const keys = {
    all: [${JSON.stringify(tag)}] as const,
    ${members.join("\n")}
  };`;
}

function renderQuery(name: string, input: OperationInput | null): string {
  const args = input ? ["input"] : [];
  // Request options are not part of the query key.
  return `export const ${name}Query = (${[...inputParameter(input), "options?: ApiRequestOptions"].join(", ")}) =>
    queryOptions({
      queryKey: keys.${name}(${args.join("")}),
      queryFn: ({ signal }) => ${name}(${[...args, "{ ...options, signal }"].join(", ")}),
    });`;
}

function renderMutation(name: string, input: OperationInput | null): string {
  const variables = input ? `input${input.optional ? "?" : ""}: ${input.type}` : "";
  const args = [...(input ? ["input"] : []), "options"];
  return `export const ${name}Mutation = (options?: ApiRequestOptions) =>
    mutationOptions({
      mutationKey: keys.${name}(),
      mutationFn: (${variables}) => ${name}(${args.join(", ")}),
    });`;
}

/** The input types of the named operations, e.g. `["GetProductInput"]`. */
function inputTypes(names: string[], inputs: OperationInputs): string[] {
  return names.flatMap((name) => {
    const input = inputs.get(name);
    return input ? [input.type] : [];
  });
}

/** `import { getProduct, type GetProductInput } from "./api";` */
function apiImport(names: string[], inputs: OperationInputs): string {
  const types = inputTypes(names, inputs).map((type) => `type ${type}`);
  return `import { ${[...names, ...types].join(", ")} } from "./api";`;
}

export function renderQueryFiles(
  tag: string,
  operations: Operations,
  inputs: OperationInputs,
  header: string,
  config: RenderQueryOptions,
): { keys: string; queries: string | null; mutations: string | null } {
  const queryNames: string[] = [];
  const mutationNames: string[] = [];

  for (const [name, operation] of operations) {
    if (!inputs.has(name)) {
      throw new Error(`Missing generated API operation: ${name}`);
    }
    if (operation.kind === "query") {
      queryNames.push(name);
    } else {
      mutationNames.push(name);
    }
  }
  if (inputs.size !== operations.size) {
    throw new Error(`Unexpected generated operation for ${tag}`);
  }
  if (operations.has("all")) {
    throw new Error(`Operation "all" conflicts with keys.all`);
  }

  const bindings = new Set(operations.keys());
  for (const name of [
    "keys",
    ...queryNames.map((name) => `${name}Query`),
    ...mutationNames.map((name) => `${name}Mutation`),
  ]) {
    if (bindings.has(name)) {
      throw new Error(`Duplicate generated resource export: ${name}`);
    }
    bindings.add(name);
  }

  const keyTypes = inputTypes(queryNames, inputs);
  const keys = [
    header,
    ...(keyTypes.length ? [`import type { ${keyTypes.join(", ")} } from "./api";`] : []),
    renderKeys(tag, queryNames, mutationNames, inputs),
    "",
  ].join("\n\n");

  const requestImport = `import type { ApiRequestOptions } from ${JSON.stringify(config.requestImport)};`;
  const keysImport = 'import { keys } from "./keys";';
  const queries = queryNames.length
    ? [
        header,
        ['import { queryOptions } from "@tanstack/lit-query";', requestImport].join("\n"),
        [apiImport(queryNames, inputs), keysImport].join("\n"),
        ...queryNames.map((name) => renderQuery(name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  const mutations = mutationNames.length
    ? [
        header,
        ['import { mutationOptions } from "@tanstack/lit-query";', requestImport].join("\n"),
        [apiImport(mutationNames, inputs), keysImport].join("\n"),
        ...mutationNames.map((name) => renderMutation(name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  return { keys, queries, mutations };
}
