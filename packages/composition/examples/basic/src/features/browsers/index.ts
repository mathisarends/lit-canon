import { html } from 'lit';
import { defineFeature, definePage, provide, redirect } from 'lit-canon-composition';
import { apiCtx } from '../../api.js';
import { shellLayout } from '../../shell/shell-layout.js';
import { requireAuth } from '../auth/auth-service.js';
import { BrowserService, browserServiceCtx } from './browser-service.js';

export const home = definePage({
  path: '/',
  guards: [() => redirect('/browsers')],
  render: () => html``,
});

export const browserList = definePage({
  path: '/browsers',
  load: () => import('./pages/browser-list-page.js'),
  render: () => html`<browser-list-page></browser-list-page>`,
  title: 'Browsers',
});

export const browserDetail = definePage({
  path: '/browsers/:id',
  load: () => import('./pages/browser-detail-page.js'),
  render: ({ id }) => html`<browser-detail-page .params=${{ id }}></browser-detail-page>`,
  title: ({ params }) => `Browser ${params.id}`,
  guards: [requireAuth],
});

export const browsersFeature = defineFeature({
  name: 'browsers',
  pages: [home, browserList, browserDetail],
  layout: shellLayout,
  // The ApiClient is an app provider, so it already exists when this factory runs.
  providers: [provide(browserServiceCtx, (c) => new BrowserService(c.get(apiCtx)))],
});
