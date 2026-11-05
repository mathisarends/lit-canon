import type { Operations } from "./operation.js";
import type { OperationInput, OperationInputs } from "./render-api.js";

interface RenderQueryOptions {
  /** camelCase resource name, e.g. "userSettings" for the tag "user-settings". */
  namespace: string;
  mutationOperations?: string[];
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

function renderKeys(
  keysName: string,
  tag: string,
  queryNames: string[],
  inputs: OperationInputs,
): string {
  const members = queryNames.map((name) => {
    const input = inputs.get(name)!;
    const key = [JSON.stringify(tag), JSON.stringify(name), ...(input ? ["input"] : [])];
    return `${name}: (${inputParameter(input).join("")}) => [${key.join(", ")}] as const,`;
  });
  return `export const ${keysName} = {
    all: [${JSON.stringify(tag)}] as const,
    ${members.join("\n")}
  };`;
}

function renderQuery(keysName: string, name: string, input: OperationInput | null): string {
  const args = input ? ["input"] : [];
  // Request options are not part of the query key.
  return `export const ${name}Query = (${[...inputParameter(input), "options?: ApiRequestOptions"].join(", ")}) =>
    queryOptions({
      queryKey: ${keysName}.${name}(${args.join("")}),
      queryFn: ({ signal }) => ${name}(${[...args, "{ ...options, signal }"].join(", ")}),
    });`;
}

function renderMutation(tag: string, name: string, input: OperationInput | null): string {
  const variables = input ? `input${input.optional ? "?" : ""}: ${input.type}` : "";
  const args = [...(input ? ["input"] : []), "options"];
  return `export const ${name}Mutation = (options?: ApiRequestOptions) =>
    mutationOptions({
      mutationKey: [${JSON.stringify(tag)}, ${JSON.stringify(name)}] as const,
      mutationFn: (${variables}) => ${name}(${args.join(", ")}),
    });`;
}

/** `import { getProduct, type GetProductInput } from "./api";` */
function apiImport(names: string[], inputs: OperationInputs): string {
  const types = names.flatMap((name) => {
    const input = inputs.get(name);
    return input ? [`type ${input.type}`] : [];
  });
  return `import { ${[...names, ...types].join(", ")} } from "./api";`;
}

export function renderQueryFiles(
  tag: string,
  operations: Operations,
  inputs: OperationInputs,
  header: string,
  config: RenderQueryOptions,
): { queries: string | null; mutations: string | null } {
  const mutationOperations = new Set(config.mutationOperations ?? []);
  const keysName = `${config.namespace}Keys`;
  const queryNames: string[] = [];
  const mutationNames: string[] = [];

  for (const [name, operation] of operations) {
    if (!inputs.has(name)) {
      throw new Error(`Missing generated API operation: ${name}`);
    }
    if (operation.method === "get" && !mutationOperations.has(name)) {
      queryNames.push(name);
    } else {
      mutationNames.push(name);
    }
  }
  if (inputs.size !== operations.size) {
    throw new Error(`Unexpected generated operation for ${tag}`);
  }
  if (queryNames.includes("all")) {
    throw new Error(`Query operation "all" conflicts with ${keysName}.all`);
  }

  const bindings = new Set(operations.keys());
  for (const name of [
    ...(queryNames.length ? [keysName] : []),
    ...queryNames.map((name) => `${name}Query`),
    ...mutationNames.map((name) => `${name}Mutation`),
  ]) {
    if (bindings.has(name)) {
      throw new Error(`Duplicate generated resource export: ${name}`);
    }
    bindings.add(name);
  }

  const requestImport = `import type { ApiRequestOptions } from ${JSON.stringify(config.requestImport)};`;
  const queries = queryNames.length
    ? [
        header,
        ['import { queryOptions } from "@tanstack/lit-query";', requestImport].join("\n"),
        apiImport(queryNames, inputs),
        renderKeys(keysName, tag, queryNames, inputs),
        ...queryNames.map((name) => renderQuery(keysName, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  const mutations = mutationNames.length
    ? [
        header,
        ['import { mutationOptions } from "@tanstack/lit-query";', requestImport].join("\n"),
        apiImport(mutationNames, inputs),
        ...mutationNames.map((name) => renderMutation(tag, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  return { queries, mutations };
}
