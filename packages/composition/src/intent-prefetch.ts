import type { ReactiveController, ReactiveControllerHost } from "lit";

/** One controller per app root, including links inside open shadow roots. */
export class IntentPrefetchController implements ReactiveController {
  private timer?: ReturnType<typeof setTimeout>;
  private pending?: HTMLAnchorElement;

  constructor(
    private host: ReactiveControllerHost & HTMLElement,
    private prefetch: (href: string) => Promise<void>,
  ) {
    host.addController(this);
  }

  hostConnected() {
    this.host.addEventListener("pointerover", this.onOver);
    this.host.addEventListener("pointerout", this.onOut);
    this.host.addEventListener("focusin", this.onNow);
    this.host.addEventListener("touchstart", this.onNow, { passive: true });
  }

  hostDisconnected() {
    this.clear();
    this.host.removeEventListener("pointerover", this.onOver);
    this.host.removeEventListener("pointerout", this.onOut);
    this.host.removeEventListener("focusin", this.onNow);
    this.host.removeEventListener("touchstart", this.onNow);
  }

  private anchor(event: Event) {
    return event
      .composedPath()
      .find(
        (node): node is HTMLAnchorElement =>
          node instanceof HTMLAnchorElement &&
          node.hasAttribute("href") &&
          !node.hasAttribute("download") &&
          !node.hasAttribute("data-no-prefetch") &&
          (!node.target || node.target === "_self"),
      );
  }

  private clear = () => {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.pending = undefined;
  };

  private onOver = (event: PointerEvent) => {
    if (event.pointerType === "touch") return;
    const anchor = this.anchor(event);
    if (anchor === this.pending) return;
    this.clear();
    if (!anchor) return;
    this.pending = anchor;
    this.timer = setTimeout(() => {
      this.clear();
      if (anchor.isConnected) void this.prefetch(anchor.href);
    }, 60);
  };

  private onOut = (event: PointerEvent) => {
    const anchor = this.anchor(event);
    // Moving between children of the same link is not leaving that link.
    if (anchor && event.relatedTarget instanceof Node && anchor.contains(event.relatedTarget))
      return;
    if (anchor === this.pending) this.clear();
  };

  private onNow = (event: Event) => {
    this.clear();
    const anchor = this.anchor(event);
    if (anchor) void this.prefetch(anchor.href);
  };
}
