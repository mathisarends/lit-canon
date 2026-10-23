import type { Context } from "@lit/context";
import { contextName, missingContext } from "./errors.js";

export interface Container {
  get<T>(context: Context<unknown, T>): T;
}

export interface ProviderDef<T = unknown> {
  context: Context<unknown, T>;
  factory: (c: Container) => T;
}

export const provide = <T>(
  context: Context<unknown, T>,
  factory: (c: Container) => T,
): ProviderDef<T> => ({ context, factory });

/** A provider plus a description of where it was declared, for error messages. */
export interface OwnedProvider {
  def: ProviderDef;
  owner: string;
}

/**
 * Eagerly instantiates `providers` in order. Each factory only sees the
 * values created before it. Every value is a singleton.
 */
export function resolveProviders(providers: OwnedProvider[]) {
  const values = new Map<Context<unknown, unknown>, unknown>();
  let requester: string | undefined;
  const container: Container = {
    get<T>(context: Context<unknown, T>): T {
      if (!values.has(context)) throw missingContext(context, requester);
      return values.get(context) as T;
    },
  };
  for (const { def, owner } of providers) {
    requester = `The provider for ${contextName(def.context)} (${owner})`;
    try {
      values.set(def.context, def.factory(container));
    } finally {
      requester = undefined;
    }
  }
  return { container, values };
}
