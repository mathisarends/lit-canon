import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';

@customElement('not-found-page')
export class NotFoundPage extends LitElement {
  override render() {
    return html`
      <h1>Page not found</h1>
      <p><a href="/browsers">Go to the browser list</a></p>
    `;
  }
}
