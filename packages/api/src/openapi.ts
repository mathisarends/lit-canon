import ts from "typescript";
import { camelPathParamName } from "@orval/core";
import type { OpenAPIV3 } from "@scalar/openapi-types";
import type { CodegenConfig } from "./config.js";
import type { Operation, OperationParameter, Operations } from "./operation.js";
import { resolveReference } from "./references.js";
import { operationProblems } from "./render-problems.js";

const methods = new Set(["get", "put", "post", "delete", "options", "head", "patch", "trace"]);

function validateParameterSchema(
  value: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject,
  spec: OpenAPIV3.Document,
  context: string,
  allowArray: boolean,
  seen = new Set<object>(),
): void {
  const schema = resolveReference(value, spec, "Schemas");
  if (seen.has(schema)) {
    return;
  }
  const visited = new Set(seen).add(schema);
  const types: string[] = Array.isArray(schema.type) ? schema.type : [schema.type ?? ""];
  if (types.includes("object") || schema.properties || (!allowArray && types.includes("array"))) {
    throw new Error(`Unsupported object or array parameter in ${context}`);
  }
  if ("items" in schema && schema.items) {
    validateParameterSchema(schema.items, spec, context, false, visited);
  }
  for (const variant of [
    ...(schema.allOf ?? []),
    ...(schema.oneOf ?? []),
    ...(schema.anyOf ?? []),
  ]) {
    validateParameterSchema(variant, spec, context, allowArray, visited);
  }
}

function validateParameter(
  parameter: OpenAPIV3.ParameterObject,
  spec: OpenAPIV3.Document,
  context: string,
): void {
  if (parameter.in !== "path" && parameter.in !== "query" && parameter.in !== "header") {
    throw new Error(`Unsupported ${parameter.in} parameter ${parameter.name} in ${context}`);
  }
  if (
    parameter.in === "header" &&
    ["accept", "content-type", "authorization"].includes(String(parameter.name).toLowerCase())
  ) {
    // OpenAPI ignores these header parameters; generating them would demand a value per call.
    throw new Error(
      `Header parameter ${parameter.name} in ${context} is ignored by OpenAPI. Remove it and set the header with configureApiFetch.`,
    );
  }
  const style = parameter.in === "query" ? "form" : "simple";
  const explode = parameter.in === "query";
  if (
    parameter.content ||
    (parameter.style && parameter.style !== style) ||
    (parameter.explode !== undefined && parameter.explode !== explode) ||
    parameter.allowReserved
  ) {
    throw new Error(`Unsupported serialization for parameter ${parameter.name} in ${context}`);
  }
  if (parameter.schema) {
    validateParameterSchema(
      parameter.schema,
      spec,
      `${context} (${parameter.name})`,
      // Query arrays repeat the key; header arrays are comma-separated (simple style).
      parameter.in !== "path",
    );
  }
}

/**
 * Names a path parameter cannot take: generated functions destructure path parameters
 * next to these fields and helpers.
 */
const reservedPathNames = new Set([
  "body",
  "headers",
  "query",
  "params",
  "options",
  "formData",
  "apiFetch",
  "encodeURIComponent",
]);

function isPlainString(
  value: OpenAPIV3.SchemaObject | OpenAPIV3.ReferenceObject | undefined,
  spec: OpenAPIV3.Document,
): boolean {
  if (!value) {
    return false;
  }
  const schema = resolveReference(value, spec, "Schemas");
  const types = Array.isArray(schema.type) ? schema.type : [schema.type];
  return types.length === 1 && types[0] === "string" && !schema.enum;
}

/** Path and query parameters share one flat input object with `headers` and `body`. */
function inputParameters(
  parameters: OpenAPIV3.ParameterObject[],
  spec: OpenAPIV3.Document,
  hasBody: boolean,
  context: string,
): OperationParameter[] {
  const fields = new Set<string>();
  if (hasBody) fields.add("body");
  if (parameters.some((parameter) => parameter.in === "header")) fields.add("headers");
  return parameters.map((parameter) => {
    const location = parameter.in as OperationParameter["in"];
    const source = String(parameter.name);
    // Orval prefixes reserved words, e.g. `_class`; the input field keeps the plain name.
    const variable = location === "path" ? camelPathParamName(source) : undefined;
    const name = variable === undefined || variable === `_${source}` ? source : variable;
    if (location !== "header") {
      if (fields.has(name) || (variable !== undefined && reservedPathNames.has(variable))) {
        throw new Error(
          `Parameter ${parameter.name} in ${context} conflicts with another input field or a generated name`,
        );
      }
      fields.add(name);
    }
    return {
      name,
      ...(variable === undefined ? {} : { variable }),
      in: location,
      required: location === "path" || Boolean(parameter.required),
      plainString: isPlainString(parameter.schema, spec),
    };
  });
}

export function identifier(name: string, label: string): string {
  if (typeof name !== "string" || !/^[A-Za-z_$][\w$]*$/.test(name)) {
    throw new Error(`Invalid ${label}: ${name}`);
  }
  const token = ts
    .createScanner(ts.ScriptTarget.Latest, false, ts.LanguageVariant.Standard, name)
    .scan();
  if (token >= ts.SyntaxKind.FirstKeyword && token <= ts.SyntaxKind.LastReservedWord) {
    throw new Error(`Reserved ${label}: ${name}`);
  }
  return name;
}

export function operationName(id: string | undefined): string {
  if (typeof id !== "string" || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(id)) {
    throw new Error(`Operation IDs must be explicit snake_case or camelCase identifiers: ${id}`);
  }
  const name = id.replace(/_([a-z0-9])/g, (_, character) => character.toUpperCase());
  return identifier(name, "operation name");
}

/**
 * The resource directory for an OpenAPI tag. Tags that are already lower-case with
 * hyphens stay unchanged; others are converted, e.g. "User Settings" or "UserSettings"
 * to "user-settings".
 */
export function resourceName(tag: string): string {
  if (/^[a-z][a-z0-9-]*$/.test(tag)) {
    return tag;
  }
  const name = tag
    // Drop accents: "Über" becomes "Uber".
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new Error(`OpenAPI tag cannot be used as a resource directory: ${tag}`);
  }
  return name;
}

export function collectOperations(spec: OpenAPIV3.Document, config: CodegenConfig) {
  const operationsByTag = new Map<string, Operations>();
  /**
   * The original OpenAPI tag of each resource, used to filter Orval's input; null for
   * the defaultTag resource, which holds the operations without a tag.
   */
  const sourceTags = new Map<string, string | null>();
  /** Every tag in the input, so Orval can select the untagged operations. */
  const allTags = new Set<string>();
  const names = new Set<string>();
  const excluded = new Set(config.excludeTags ?? []);
  for (const [path, pathItem] of Object.entries(spec.paths ?? {})) {
    if (!pathItem) {
      continue;
    }
    if (pathItem.$ref) {
      throw new Error(`Path item references must be bundled before generation: ${path}`);
    }
    for (const [method, value] of Object.entries(pathItem)) {
      if (!methods.has(method)) {
        continue;
      }
      const operation = value as OpenAPIV3.OperationObject;
      const operationTags = operation.tags ?? [];
      operationTags.forEach((tag) => allTags.add(tag));
      if (
        operationTags.length > 1 ||
        (operationTags.length === 0 && config.defaultTag === undefined)
      ) {
        throw new Error(
          `${method.toUpperCase()} ${path} needs exactly one OpenAPI tag${operationTags.length ? "" : " (or set defaultTag)"}`,
        );
      }
      const sourceTag = operationTags[0] ?? null;
      const label = sourceTag ?? config.defaultTag!;
      const tag = resourceName(label);
      if (excluded.has(label) || excluded.has(tag)) {
        continue;
      }
      const previousTag = sourceTags.get(tag);
      if (previousTag !== undefined && previousTag !== sourceTag) {
        const describe = (value: string | null) =>
          value === null ? `defaultTag "${config.defaultTag}"` : `OpenAPI tag "${value}"`;
        throw new Error(
          `${describe(previousTag)} and ${describe(sourceTag)} both map to the resource ${tag}`,
        );
      }
      sourceTags.set(tag, sourceTag);
      const name = operationName(operation.operationId);
      if (["apiFetch", "ApiRequestOptions", "queryOptions", "mutationOptions"].includes(name)) {
        throw new Error(`Operation name conflicts with a generated import: ${name}`);
      }
      if (names.has(name)) {
        throw new Error(`Duplicate generated operation name: ${name}`);
      }
      names.add(name);
      const parameters = new Map(
        [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map((value) => {
          const parameter = resolveReference(value, spec, "Parameters");
          return [`${parameter.in}:${parameter.name}`, parameter] as const;
        }),
      );
      for (const parameter of parameters.values()) {
        validateParameter(parameter, spec, `${method.toUpperCase()} ${path}`);
      }
      const operations = operationsByTag.get(tag) ?? new Map<string, Operation>();
      const requestBody = operation.requestBody
        ? resolveReference(operation.requestBody, spec, "Request bodies")
        : undefined;
      operations.set(name, {
        path,
        method,
        parameters: inputParameters(
          [...parameters.values()],
          spec,
          requestBody !== undefined,
          `${method.toUpperCase()} ${path}`,
        ),
        bodyRequired: requestBody ? Boolean(requestBody.required) : undefined,
        jsonContentType: Object.keys(requestBody?.content ?? {}).find(
          (type) => type === "application/json" || type.endsWith("+json"),
        ),
        problems: config.problems === false ? [] : operationProblems(operation, spec),
      });
      operationsByTag.set(tag, operations);
    }
  }
  const mutationOperations = (config.mutationOperations ?? []).map(operationName);
  for (const name of mutationOperations) {
    if (!names.has(name)) {
      throw new Error(`Configured mutation has no included operation: ${name}`);
    }
  }
  return { operationsByTag, sourceTags, allTags: [...allTags], mutationOperations };
}
