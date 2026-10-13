import type { ProblemType } from "./render-problems.js";

export interface Operation {
  path: string;
  method: string;
  hasQuery: boolean;
  problems: ProblemType[];
}

export type Operations = Map<string, Operation>;
