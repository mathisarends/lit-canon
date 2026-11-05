import type { ProblemType } from "./render-problems.js";

export interface Operation {
  path: string;
  method: string;
  hasQuery: boolean;
  /** Header parameters, generated as a typed `headers` argument. */
  hasHeaders: boolean;
  jsonContentType?: string;
  problems: ProblemType[];
}

export type Operations = Map<string, Operation>;
