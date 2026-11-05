import type { OperationKind } from "./config.js";
import type { ProblemType } from "./render-problems.js";

export interface OperationParameter {
  /** The field in the generated input object: camelCase for path, as written otherwise. */
  name: string;
  /** The local variable for a path parameter, e.g. `_class` for the field `class`. */
  variable?: string;
  in: "path" | "query" | "header";
  required: boolean;
  /** A plain string schema, without an enum, that a route parameter can fill. */
  plainString: boolean;
}

export interface Operation {
  path: string;
  method: string;
  kind: OperationKind;
  parameters: OperationParameter[];
  /** Whether the request body is required; undefined without a body. */
  bodyRequired?: boolean;
  jsonContentType?: string;
  problems: ProblemType[];
}

export type Operations = Map<string, Operation>;
