import { LitElement, html } from 'lit';
import { customElement } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { Task } from '@lit/task';
import { browserServiceCtx, type BrowserService } from '../browser-service.js';

@customElement('browser-list-page')
export class BrowserListPage extends LitElement {
  @consume({ context: browserServiceCtx }) browsers!: BrowserService;

  private readonly listTask = new Task(this, {
    task: (_args, { signal }) => this.browsers.list(signal),
    args: () => [],
  });

  override render() {
    return html`
      <h1>Browsers</h1>
      ${this.listTask.render({
        pending: () => html`<p>Loading…</p>`,
        complete: (list) => html`
          <ul>
            ${list.map((b) => html`<li><a href="/browsers/${b.id}">${b.name}</a></li>`)}
          </ul>
          <p><a href="/browsers/99">A browser that does not exist</a></p>
        `,
        error: (e) => html`<p>Could not load browsers: ${String(e)}</p>`,
      })}
    `;
  }
}
