import { afterEach } from 'vitest';
import type { LitElement } from 'lit';
import { createApp, type AppOptions } from '../src/index.js';

let count = 0;
const hosts: HTMLElement[] = [];

afterEach(() => {
  for (const host of hosts.splice(0)) host.remove();
  history.replaceState(null, '', '/');
});

/** Creates (but does not start) an app with a unique root tag, starting at `startPath`. */
export function setup(options: Omit<AppOptions, 'root'>, startPath = '/') {
  history.replaceState(null, '', startPath);
  const host = document.createElement('div');
  document.body.append(host);
  hosts.push(host);
  const app = createApp({ rootTagName: `test-root-${++count}`, ...options, root: host });
  return { app, host };
}

/** Creates and starts an app and waits for the initial navigation. */
export async function start(options: Omit<AppOptions, 'root'>, startPath = '/') {
  const ctx = setup(options, startPath);
  ctx.app.start();
  await flush(ctx.host);
  return ctx;
}

/** Lets pending navigations (microtasks, zero-delay timers) finish and the root render. */
export async function flush(host: HTMLElement) {
  await new Promise((r) => setTimeout(r));
  await (host.firstElementChild as LitElement).updateComplete;
}

export const text = (host: Element) => (host.textContent ?? '').replace(/\s+/g, ' ').trim();

export const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Goes back in history and waits until the router has handled the popstate. */
export async function back(host: HTMLElement) {
  const popped = new Promise((r) => window.addEventListener('popstate', r, { once: true }));
  history.back();
  await popped;
  await flush(host);
}
