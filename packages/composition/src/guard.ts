import type { Container } from "./container.js";
import type { Params } from "./page.js";

const REDIRECT = Symbol("lit-canon.redirect");

/** Opaque result of {@link redirect}. */
export interface Redirect {
  readonly [REDIRECT]: true;
  readonly to: string;
}

export type GuardResult = boolean | Redirect;

export type Guard = (ctx: {
  params: Params;
  /** The pathname being navigated to, e.g. `/browsers/42`. */
  path: string;
  container: Container;
}) => GuardResult | Promise<GuardResult>;

/** Guard result that cancels the navigation and replaces it with one to `to`. */
export const redirect = (to: string): Redirect => Object.freeze({ [REDIRECT]: true as const, to });

export const isRedirect = (value: unknown): value is Redirect =>
  typeof value === "object" && value !== null && REDIRECT in value;
