import ts from "typescript";
import type { OpenAPIV3 } from "@scalar/openapi-types";
import type { CodegenConfig } from "./config.js";
import type { Operation, Operations } from "./operation.js";
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
  if (parameter.in !== "path" && parameter.in !== "query") {
    throw new Error(`Unsupported ${parameter.in} parameter ${parameter.name} in ${context}`);
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
      parameter.in === "query",
    );
  }
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

export function collectOperations(spec: OpenAPIV3.Document, config: CodegenConfig) {
  const operationsByTag = new Map<string, Operations>();
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
      if (operation.tags?.length !== 1) {
        throw new Error(`${method.toUpperCase()} ${path} needs exactly one OpenAPI tag`);
      }
      const [tag] = operation.tags;
      if (!/^[a-z][a-z0-9-]*$/.test(tag)) {
        throw new Error(`OpenAPI tag cannot be used as a feature directory: ${tag}`);
      }
      if (excluded.has(tag)) {
        continue;
      }
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
      operations.set(name, {
        path,
        method,
        hasQuery: [...parameters.values()].some((parameter) => parameter.in === "query"),
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
  for (const tag of new Set([
    ...Object.keys(config.features ?? {}),
    ...Object.keys(config.queryAliases ?? {}),
  ])) {
    if (!operationsByTag.has(tag)) {
      throw new Error(`Configured feature has no included operations: ${tag}`);
    }
  }
  return { operationsByTag, mutationOperations };
}
