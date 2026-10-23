import type { OpenAPIV3 } from "@scalar/openapi-types";

export function resolveReference<T extends object>(
  value: T | OpenAPIV3.ReferenceObject,
  spec: OpenAPIV3.Document,
  label: string,
  seen = new Set<string>(),
): T {
  if (!("$ref" in value)) {
    return value;
  }
  const ref = value.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/") || seen.has(ref)) {
    throw new Error(`${label} require non-circular local references: ${ref}`);
  }
  seen.add(ref);
  let target: unknown = spec;
  for (const key of ref.slice(2).split("/")) {
    if (target === null || typeof target !== "object") {
      throw new Error(`Missing ${label.toLowerCase()} reference: ${ref}`);
    }
    target = (target as Record<string, unknown>)[key.replace(/~1/g, "/").replace(/~0/g, "~")];
  }
  if (target === null || typeof target !== "object") {
    throw new Error(`Missing ${label.toLowerCase()} reference: ${ref}`);
  }
  return resolveReference(target as T | OpenAPIV3.ReferenceObject, spec, label, seen);
}
