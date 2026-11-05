import ts from "typescript";
import type { Operations } from "./operation.js";
import { upperFirst } from "./naming.js";

interface OperationInput {
  name: string;
  optional: boolean;
  type: string;
  sourceType: string;
}

interface RenderQueryOptions {
  /** camelCase resource name, e.g. "userSettings" for the tag "user-settings". */
  namespace: string;
  mutationOperations?: string[];
  /** Module that exports ApiRequestOptions, e.g. "lit-canon-fetch". */
  requestImport: string;
}

/** Global types that a copied parameter type may use without an import. */
const globalTypes = new Set(["Array", "ReadonlyArray", "Record", "Blob", "File", "Date"]);

interface ParsedInputs {
  inputs: Map<string, OperationInput[]>;
  /** Model types used by the copied parameter types, per operation. */
  models: Map<string, Set<string>>;
}

/**
 * The parameter type as written in api.ts when it only uses models and global types,
 * e.g. `ListProductsParams`; otherwise null, and the caller derives it from the function.
 */
function parameterType(
  parameter: ts.ParameterDeclaration,
  sourceFile: ts.SourceFile,
  modelImports: Set<string>,
  used: Set<string>,
): string | null {
  if (!parameter.type) {
    return null;
  }
  const references = new Set<string>();
  let portable = true;
  const visit = (node: ts.Node): void => {
    if (ts.isTypeQueryNode(node) || ts.isImportTypeNode(node)) {
      portable = false;
    } else if (ts.isTypeReferenceNode(node)) {
      if (!ts.isIdentifier(node.typeName)) {
        portable = false;
      } else if (modelImports.has(node.typeName.text)) {
        references.add(node.typeName.text);
      } else if (!globalTypes.has(node.typeName.text)) {
        portable = false;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(parameter.type);
  if (!portable) {
    return null;
  }
  references.forEach((name) => used.add(name));
  return parameter.type.getText(sourceFile);
}

export function operationInputs(source: string): ParsedInputs {
  const sourceFile = ts.createSourceFile("api.ts", source, ts.ScriptTarget.Latest, true);
  const inputs = new Map<string, OperationInput[]>();
  const models = new Map<string, Set<string>>();
  const modelImports = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === "./models" &&
      statement.importClause?.namedBindings &&
      ts.isNamedImports(statement.importClause.namedBindings)
    ) {
      for (const element of statement.importClause.namedBindings.elements) {
        if (!element.propertyName) {
          modelImports.add(element.name.text);
        }
      }
    }
  }

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

    const used = new Set<string>();
    inputs.set(
      name,
      parameters.slice(0, -1).map((parameter, index) => ({
        name: parameter.name.getText(sourceFile),
        optional: Boolean(parameter.questionToken),
        type:
          parameterType(parameter, sourceFile, modelImports, used) ??
          `Parameters<typeof ${name}>[${index}]`,
        sourceType: parameter.type?.getText(sourceFile) ?? "unknown",
      })),
    );
    models.set(name, used);
  }

  return { inputs, models };
}

function modelImport(names: string[], models: Map<string, Set<string>>): string[] {
  const used = [...new Set(names.flatMap((name) => [...models.get(name)!]))].sort();
  return used.length ? [`import type { ${used.join(", ")} } from "./models";`] : [];
}

function variablesType(name: string): string {
  return `${upperFirst(name)}Variables`;
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

  // Request options are not part of the query key.
  return `export const ${name}Query = (${[functionParameters(inputs), "options?: ApiRequestOptions"].filter(Boolean).join(", ")}) =>
    queryOptions({
      queryKey: ${keysName}.${name}(${names.join(", ")}),
      queryFn: ({ ${signal} }) => ${name}(${[...names, `{ ...options, ${signal} }`].join(", ")}),
    });`;
}

function renderMutation(tag: string, name: string, inputs: OperationInput[]): string {
  const key = `mutationKey: [${JSON.stringify(tag)}, ${JSON.stringify(name)}] as const,`;
  if (!inputs.length) {
    return `export const ${name}Mutation = (options?: ApiRequestOptions) =>
      mutationOptions({
        ${key}
        mutationFn: () => ${name}(options),
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
  const call = [...inputs.map(({ name: inputName }) => `variables.${inputName}`), "options"];
  return `/** The variables passed to \`mutate\` for ${name}. */
  export type ${variablesType(name)} = { ${properties.join(" ")} };

  export const ${name}Mutation = (options?: ApiRequestOptions) =>
    mutationOptions({
      ${key}
      mutationFn: (variables: ${variablesType(name)}) => ${name}(${call.join(", ")}),
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
  const { inputs, models } = operationInputs(apiSource);
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
    ...mutationNames.filter((name) => inputs.get(name)!.length).map(variablesType),
  ]) {
    if (bindings.has(name)) {
      throw new Error(`Duplicate generated resource export: ${name}`);
    }
    bindings.add(name);
  }

  const queries = queryNames.length
    ? [
        header,
        [
          'import { queryOptions } from "@tanstack/lit-query";',
          `import type { ApiRequestOptions } from ${JSON.stringify(config.requestImport)};`,
        ].join("\n"),
        [
          `import { ${queryNames.join(", ")} } from "./api";`,
          ...modelImport(queryNames, models),
        ].join("\n"),
        renderKeys(keysName, tag, queryNames, inputs),
        ...queryNames.map((name) => renderQuery(keysName, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  const mutations = mutationNames.length
    ? [
        header,
        [
          'import { mutationOptions } from "@tanstack/lit-query";',
          `import type { ApiRequestOptions } from ${JSON.stringify(config.requestImport)};`,
        ].join("\n"),
        [
          `import { ${mutationNames.join(", ")} } from "./api";`,
          ...modelImport(mutationNames, models),
        ].join("\n"),
        ...mutationNames.map((name) => renderMutation(tag, name, inputs.get(name)!)),
        "",
      ].join("\n\n")
    : null;

  return { queries, mutations };
}
