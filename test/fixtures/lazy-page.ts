import { LitElement, html } from 'lit';

export class LazyPage extends LitElement {
  override render() {
    return html`lazy page`;
  }
}
customElements.define('lazy-page', LazyPage);
