import { LitElement, css, html } from "lit";
import { customElement } from "lit/decorators.js";
import { consume } from "@lit/context";
import { authCtx, type AuthService } from "./auth-service.js";

@customElement("login-page")
export class LoginPage extends LitElement {
  static override styles = css`
    :host {
      display: block;
      max-width: 24rem;
      margin: 15vh auto;
      padding: 2rem;
      background: white;
      border-radius: 12px;
    }
    a {
      display: inline-block;
      padding: 0.5rem 1rem;
      border-radius: 6px;
      background: #3451b2;
      color: white;
      text-decoration: none;
    }
  `;

  @consume({ context: authCtx }) auth!: AuthService;

  /** Only same-site paths, so `?next=` cannot send users elsewhere. */
  private get next() {
    const next = new URLSearchParams(location.search).get("next");
    return next?.startsWith("/") && !next.startsWith("//") ? next : "/browsers";
  }

  override render() {
    // The router intercepts this link; the click handler logs in first, so the guard passes.
    return html`
      <h1>Log in</h1>
      <p>${this.auth.user ? `Logged in as ${this.auth.user}.` : "You are not logged in."}</p>
      <a href=${this.next} @click=${() => this.auth.login("demo")}>Log in as demo</a>
    `;
  }
}
