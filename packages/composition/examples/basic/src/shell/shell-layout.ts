import { LitElement, css, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import type { Layout } from 'lit-canon-composition';
import { authCtx, type AuthService } from '../features/auth/auth-service.js';

export const shellLayout: Layout = (content) => html`<app-shell>${content}</app-shell>`;

@customElement('app-shell')
export class AppShell extends LitElement {
  static override styles = css`
    header {
      display: flex;
      gap: 1rem;
      align-items: center;
      padding: 0.75rem 1.5rem;
      background: #1d1d1f;
      color: white;
    }
    header a {
      color: white;
    }
    .spacer {
      flex: 1;
    }
    main {
      max-width: 48rem;
      margin: 0 auto;
      padding: 1.5rem;
    }
  `;

  @consume({ context: authCtx }) auth!: AuthService;

  override render() {
    const user = this.auth.user;
    return html`
      <header>
        <strong>Example</strong>
        <a href="/browsers">Browsers</a>
        <span class="spacer"></span>
        ${user
          ? html`<span>${user}</span> <a href="/login" @click=${() => this.auth.logout()}>Log out</a>`
          : html`<a href="/login">Log in</a>`}
      </header>
      <main><slot></slot></main>
    `;
  }
}
