import { html } from 'lit';
import { defineFeature, definePage, provide } from 'lit-canon-composition';
import { AuthService, authCtx } from './auth-service.js';
import './login-page.js';

export const loginPage = definePage({
  path: '/login',
  title: 'Log in',
  render: () => html`<login-page></login-page>`,
});

export const authFeature = defineFeature({
  name: 'auth',
  pages: [loginPage],
  providers: [provide(authCtx, () => new AuthService())],
});
