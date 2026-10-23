import ts from "typescript";
import type { Operations } from "./operation.js";

interface OperationInput {
  name: string;
  optional: boolean;
  type: string;
}

interface RenderQueryOptions {
  /** camelCase resource name, e.g. "userSettings" for the tag "user-settings". */
  namespace: string;
  mutationOperations?: string[];
}

function operationInputs(source: string): Map<string, OperationInput[]> {
  const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const inputs = new Map<string, OperationInput[]>();

  for (const statement of sourceFile.statements) {
    if (!ts.isVariableStatement(statement)) {
      continue;
    }
    if (statement.declarationList.declarations.length !== 1) {
      throw new Error("Unexpected generated API declaration");
    }

    const declaration = statement.declarationList.declarations[0];
    const name = declaration.name.getText(sourceFile);
    const arrow = declaration.initializer;
    if (!arrow || !ts.isArrowFunction(arrow)) {
      throw new Error(`Unexpected generated API operation: ${name}`);
    }

    const parameters = arrow.parameters;
    const options = parameters.at(-1);
    if (!options || options.name.getText(sourceFile) !== "options" || !options.questionToken) {
      throw new Error(`Missing request options in generated API operation: ${name}`);
    }

    inputs.set(
      name,
      parameters.slice(0, -1).map((parameter, index) => ({
        name: parameter.name.getText(sourceFile),
        optional: Boolean(parameter.questionToken),
        type: `Parameters<typeof ${name}>[${index}]`,
      })),
    );
  }

  return inputs;
}

function functionParameters(inputs: OperationInput[]): string {
  return inputs
    .map(({ name, optional, type }) => `${name}${optional ? "?" : ""}: ${type}`)
    .join(", ");
}

function renderKeys(
  keysName: string,
  tag: string,
  queryNames: string[],
  inputs: Map<string, OperationInput[]>,
): string {
  const members = queryNames.map((name) => {
    const operationInputs = inputs.get(name)!;
    const key = [
      JSON.stringify(tag),
      JSON.stringify(name),
      ...operationInputs.map(({ name: inputName, optional }) =>
        optional ? `${inputName} ?? null` : inputName,
      ),
    ];
    return `${name}: (${functionParameters(operationInputs)}) => [${key.join(", ")}] as const,`;
  });
  return `export const ${keysName} = {
    all: [${JSON.stringify(tag)}] as const,
    ${members.join("\n")}
  };`;
}

function renderQuery(keysName: string, name: string, inputs: OperationInput[]): string {
  // A path or query input may itself be called "signal"; keep TanStack's signal distinct.
  let signalName = "signal";
  while (inputs.some((input) => input.name === signalName)) {
    signalName = `_${signalName}`;
  }
  const names = inputs.map(({ name: inputName }) => inputName);
  const signal = signalName === "signal" ? "signal" : `signal: ${signalName}`;

  return `export const ${name}Query = (${functionParameters(inputs)}) =>
    queryOptions({
      queryKey: ${keysName}.${name}(${names.join(", ")}),
      queryFn: ({ ${signal} }) => ${name}(${[...names, `{ ${signal} }`].join(", ")}),
    });`;
}

function renderMutation(tag: string, name: string, inputs: OperationInput[]): string {
  const key = `mutationKey: [${JSON.stringify(tag)}, ${JSON.stringify(name)}] as const,`;
  if (!inputs.length) {
    return `export const ${name}Mutation = () =>
      mutationOptions({
        ${key}
        mutationFn: () => ${name}(),
      });`;
  }
  const seen = new Set<string>();
  for (const { name: inputName } of inputs) {
    if (seen.has(inputName) || inputName === "__proto__") {
      throw new Error(`Mutation variable name collision in ${name}: ${inputName}`);
    }
    seen.add(inputName);
  }
  const properties = inputs.map(
    ({ name: inputName, optional, type }) => `${inputName}${optional ? "?" : ""}: ${type};`,
  );
  const call = inputs.map(({ name: inputName }) => `variables.${inputName}`);
  return `export const ${name}Mutation = () =>
    mutationOptions({
      ${key}
      mutationFn: (variables: { ${properties.join(" ")} }) => ${name}(${call.join(", ")}),
    });`;
}

export function renderQueryFiles(
  tag: string,
  operations: Operations,
  apiSource: string,
  header: string,
  config: RenderQueryOptions,
): { queries: string | null; mutations: string | null } {
  const mutationOperations = new Set(config.mutationOperations ?? []);
  const keysName = `${config.namespace}Keys`;
  const inputs = operationInputs(apiSource);
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

  const queries = queryNames.length
    ? [
        header,
        'import { queryOptions } from "@tanstack/lit-query";',
        `import { ${queryNames.join(", ")} } from "./api";`,
        renderKeys(keysName, tag, queryNames, inputs),
        ...queryNames.map((name) => renderQuery(keysName, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  const mutations = mutationNames.length
    ? [
        header,
        'import { mutationOptions } from "@tanstack/lit-query";',
        `import { ${mutationNames.join(", ")} } from "./api";`,
        ...mutationNames.map((name) => renderMutation(tag, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  return { queries, mutations };
}
