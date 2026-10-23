import { LitElement, html } from "lit";
import { customElement, property } from "lit/decorators.js";
import { consume } from "@lit/context";
import { Task } from "@lit/task";
import { browserServiceCtx, type BrowserService } from "../browser-service.js";

@customElement("browser-detail-page")
export class BrowserDetailPage extends LitElement {
  @property({ attribute: false }) params: { id?: string } = {};

  @consume({ context: browserServiceCtx }) browsers!: BrowserService;

  // The page loads its own data; lit-canon has no route-level loaders.
  private readonly browserTask = new Task(this, {
    task: ([id], { signal }) => this.browsers.get(id ?? "", signal),
    args: () => [this.params.id] as const,
  });

  override render() {
    return html`
      <p><a href="/browsers">← All browsers</a></p>
      ${this.browserTask.render({
        pending: () => html`<p>Loading browser ${this.params.id}…</p>`,
        complete: (b) => html`
          <h1>${b.name}</h1>
          <dl>
            <dt>Engine</dt>
            <dd>${b.engine}</dd>
            <dt>Version</dt>
            <dd>${b.version}</dd>
          </dl>
        `,
        error: (e) => html`<p>Could not load browser ${this.params.id}: ${String(e)}</p>`,
      })}
    `;
  }
}
