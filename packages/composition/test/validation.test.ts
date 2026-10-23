import { describe, expect, it, vi } from 'vitest';
import { html } from 'lit';
import { createContext } from '@lit/context';
import { createApp, defineFeature, definePage, provide } from '../src/index.js';

const page = (path: string) => definePage({ path, render: () => html`${path}` });
const root = () => document.createElement('div');

describe('createApp validation', () => {
  it('rejects a path registered in two features and names both', () => {
    const a = defineFeature({ name: 'alpha', pages: [page('/x')] });
    const b = defineFeature({ name: 'beta', pages: [page('/y'), page('/x')] });
    expect(() => createApp({ root: root(), features: [a, b], rootTagName: 'v-root-1' })).toThrow(
      'Path "/x" is registered twice: in feature "alpha" and in feature "beta".',
    );
  });

  it('rejects a duplicate feature name', () => {
    const a = defineFeature({ name: 'same', pages: [page('/a')] });
    const b = defineFeature({ name: 'same', pages: [page('/b')] });
    expect(() => createApp({ root: root(), features: [a, b], rootTagName: 'v-root-2' })).toThrow(
      'Feature name "same" is registered twice.',
    );
  });

  it('rejects a context provided by the app and by a feature', () => {
    const ctx = createContext<number>('counter');
    const f = defineFeature({ name: 'f', pages: [], providers: [provide(ctx, () => 2)] });
    expect(() =>
      createApp({ root: root(), features: [f], providers: [provide(ctx, () => 1)], rootTagName: 'v-root-3' }),
    ).toThrow('Context "counter" is provided twice: by the app providers and by feature "f".');
  });

  it('rejects a context provided by two features', () => {
    const ctx = createContext<number>(Symbol('counter'));
    const a = defineFeature({ name: 'a', pages: [], providers: [provide(ctx, () => 1)] });
    const b = defineFeature({ name: 'b', pages: [], providers: [provide(ctx, () => 2)] });
    expect(() => createApp({ root: root(), features: [a, b], rootTagName: 'v-root-4' })).toThrow(
      'Context counter is provided twice: by feature "a" and by feature "b".',
    );
  });

  it('rejects a root tag name that is already defined', () => {
    customElements.define('taken-root', class extends HTMLElement {});
    expect(() => createApp({ root: root(), features: [], rootTagName: 'taken-root' })).toThrow(
      'Custom element "taken-root" is already defined.',
    );
  });

  it('rejects a second app with the same root tag name', () => {
    createApp({ root: root(), features: [], rootTagName: 'v-root-5' });
    expect(() => createApp({ root: root(), features: [], rootTagName: 'v-root-5' })).toThrow(
      /already defined/,
    );
  });

  it('validates before creating any provider', () => {
    const factory = vi.fn(() => 1);
    const a = defineFeature({
      name: 'a',
      pages: [page('/a')],
      providers: [provide(createContext<number>('n'), factory)],
    });
    const b = defineFeature({ name: 'b', pages: [page('/a')] });
    expect(() => createApp({ root: root(), features: [a, b], rootTagName: 'v-root-6' })).toThrow();
    expect(factory).not.toHaveBeenCalled();
  });

  it('definePage and defineFeature return their argument', () => {
    const p = { path: '/p', render: () => html`` };
    const f = { name: 'f', pages: [] };
    expect(definePage(p)).toBe(p);
    expect(defineFeature(f)).toBe(f);
  });
});
