# lit-canon – Spezifikation v1

## 1. Ziel

`lit-canon` ist eine dünne, opinionated Schicht über Lit, die eine kanonische Form für Single-Page-Apps vorgibt: **Pages registrieren, zu Features bündeln, Features zu einer App komponieren.**

Vorbild ist das Feature-Slice-Muster aus FastAPI-Projekten: Jedes Feature exportiert genau ein Objekt, die App hält eine **explizite Liste** dieser Objekte. Keine Auto-Discovery, keine Magie.

Die Library erfindet nichts Neues, sondern verdrahtet drei bestehende Bausteine:

| Baustein           | Aufgabe                                                     |
| ------------------ | ----------------------------------------------------------- |
| `@lit-labs/router` | URL → Template, Lazy Loading via `enter`, Link-Interception |
| `@lit/context`     | Dependency Injection über den DOM-Baum                      |
| `lit`              | Rendering, Custom Elements                                  |

Zielgröße: **unter ca. 500 Zeilen Quellcode** (ohne Tests und Typen-Tests). Wenn die Implementierung deutlich größer wird, ist der Scope verletzt.

## 2. Nicht-Ziele (v1)

Diese Dinge werden **bewusst nicht** gebaut. Der Agent soll sie nicht „vorsorglich“ ergänzen:

- Route-Level-Data-Loader (Datenladen passiert in der Page, z. B. mit `@lit/task`)
- Verschachtelte Routen / Child-Routes / verschachtelte Layouts
- Typsichere Param-Inferenz aus Path-Strings und typisierte `href()`-Helper (kommt in v2, additiv)
- Query-Param-Abstraktion
- Page-Transitions, Prefetching, Breadcrumbs, Meta-Tags
- SSR / Hydration
- i18n
- Eigene Basisklasse für Pages (Pages sind normale `LitElement`s)
- Lazy oder zyklische Provider-Auflösung

## 3. Rahmenbedingungen

- TypeScript, `strict: true`
- ESM only
- Peer Dependencies: `lit` (^3), `@lit-labs/router`, `@lit/context`
- Die Library selbst nutzt **keine Decorators**, damit sie unabhängig von `experimentalDecorators` / Standard-Decorators der App funktioniert
- Läuft in allen Evergreen-Browsern. Wo `URLPattern` fehlt, ist ein Polyfill (`urlpattern-polyfill`) Sache der App; in der README dokumentieren
- Keine weiteren Runtime-Dependencies

## 4. Öffentliche API

Alles wird aus dem Paket-Root exportiert:

```ts
export { definePage, defineFeature, provide, redirect, createApp };
export type {
  PageDef,
  FeatureDef,
  Layout,
  Guard,
  GuardResult,
  ProviderDef,
  Container,
  AppOptions,
  App,
};
```

### 4.1 `definePage`

```ts
type Params = Record<string, string | undefined>;

interface PageDef {
  path: string; // URLPattern-Syntax, z. B. '/browsers/:id'
  render: (params: Params) => TemplateResult; // liefert das Page-Element
  load?: () => Promise<unknown>; // Lazy-Import des Moduls
  title?: string | ((ctx: { params: Params }) => string);
  guards?: Guard[];
}

function definePage(def: PageDef): PageDef;
```

`definePage` ist eine **Identitätsfunktion** (gibt `def` unverändert zurück, ggf. eingefroren). Sie existiert für Typ-Inferenz und Lesbarkeit. Validierung findet in `createApp` statt.

Beispiel:

```ts
export const browserDetail = definePage({
  path: "/browsers/:id",
  load: () => import("./pages/browser-detail-page.js"),
  render: ({ id }) =>
    html`<browser-detail-page .params=${{ id }}></browser-detail-page>`,
  title: ({ params }) => `Browser ${params.id}`,
  guards: [requireAuth],
});
```

### 4.2 `Guard` und `redirect`

```ts
type GuardResult = boolean | Redirect;
type Guard = (ctx: {
  params: Params;
  path: string;
  container: Container;
}) => GuardResult | Promise<GuardResult>;

function redirect(to: string): Redirect; // opakes Objekt, per Marker-Symbol erkennbar
```

- `true`: weiter zum nächsten Guard
- `false`: Navigation abbrechen, aktuelle Seite bleibt stehen
- `redirect('/login')`: Navigation abbrechen und auf das Ziel umleiten (History-Eintrag wird **ersetzt**, nicht hinzugefügt)

Guards bekommen den `Container` (siehe 4.4), damit sie z. B. einen `AuthService` abfragen können, ohne im DOM zu hängen.

### 4.3 `defineFeature` und `Layout`

```ts
type Layout = (content: TemplateResult) => TemplateResult;

interface FeatureDef {
  name: string;
  pages: PageDef[];
  layout?: Layout;
  providers?: ProviderDef[];
}

function defineFeature(def: FeatureDef): FeatureDef;
```

Ebenfalls eine Identitätsfunktion. Ein Layout wickelt **jede** Page des Features ein:

```ts
const shellLayout: Layout = (content) =>
  html`<app-shell>${content}</app-shell>`;
```

### 4.4 `provide` und `Container`

```ts
interface Container {
  get<T>(context: Context<unknown, T>): T;
}

interface ProviderDef<T = unknown> {
  context: Context<unknown, T>;
  factory: (c: Container) => T;
}

function provide<T>(
  context: Context<unknown, T>,
  factory: (c: Container) => T,
): ProviderDef<T>;
```

`Context` ist der Typ aus `@lit/context` (`createContext`). Pages konsumieren Services ganz normal mit `@consume` / `ContextConsumer` aus `@lit/context`. `lit-canon` kapselt das Konsumieren **nicht**.

### 4.5 `createApp`

```ts
interface AppOptions {
  root: Element; // Container, in den das Root-Element gehängt wird
  features: FeatureDef[];
  providers?: ProviderDef[]; // app-weite Provider (z. B. ApiClient)
  notFound?: () => TemplateResult;
  rootTagName?: string; // Default: 'lit-canon-root'
  baseTitle?: string; // optional, z. B. 'Vizro' → 'Browser 42 · Vizro'
}

interface App {
  start(): void;
  navigate(path: string): Promise<void>; // pushState + Routing
  container: Container;
}

function createApp(options: AppOptions): App;
```

## 5. Semantik

### 5.1 Validierung beim `createApp`-Aufruf

`createApp` wirft sofort einen sprechenden `Error` bei:

- doppeltem `path` über alle Features hinweg (Fehlermeldung nennt beide Features)
- doppeltem `feature.name`
- mehrfach registriertem Context (app-weit oder in zwei Features)
- `rootTagName`, das bereits als Custom Element registriert ist

### 5.2 Provider-Auflösung

- Provider werden **eager** beim `createApp`-Aufruf instanziiert, in dieser Reihenfolge: zuerst `options.providers`, dann die Provider jedes Features in Reihenfolge von `options.features`, innerhalb eines Features in Deklarationsreihenfolge.
- `container.get(ctx)` sieht nur bereits instanziierte Provider. Ein Zugriff auf einen noch nicht oder nie registrierten Context wirft einen Fehler, der den Context-Namen und den anfragenden Provider nennt.
- Jeder Provider ist ein Singleton für die Lebensdauer der App.
- Alle instanziierten Werte werden am Root-Element per `ContextProvider` aus `@lit/context` bereitgestellt. Damit sind sie für **alle** Pages sichtbar, unabhängig davon, in welchem Feature der Provider deklariert wurde. (Feature-Provider sind Organisation, keine Kapselung.)

### 5.3 Routing

- Die Routen-Tabelle wird aus `features.flatMap(f => f.pages)` gebaut. Reihenfolge = Features in Listenreihenfolge, Pages in Listenreihenfolge.
- `notFound` wird als `fallback` des Routers registriert (nicht als Wildcard-Route in der Liste). Ohne `notFound` rendert der Fallback ein leeres Template.
- Navigationsablauf beim Betreten einer Route, abgebildet auf `enter` von `@lit-labs/router`:
  1. Guards der Page **sequenziell** in Deklarationsreihenfolge ausführen. Beim ersten `false` oder `Redirect` abbrechen.
  2. `load()` ausführen, falls vorhanden. Wirft `load`, wird der Fehler nicht verschluckt, sondern mit Kontext (Page-Path) per `console.error` geloggt und die Navigation abgebrochen.
  3. Titel setzen (siehe 5.4).
  4. Navigation freigeben.
- Nach erfolgreichem Rendern einer neuen Route: `window.scrollTo(0, 0)`. Ausnahme: Navigation über Browser-Zurück/Vor (`popstate`) – dort nicht scrollen.
- `render(params)` des PageDefs wird aufgerufen und, falls das Feature ein `layout` hat, damit eingewickelt.
- Link-Klicks auf `<a href>` übernimmt `@lit-labs/router` selbst. `lit-canon` installiert **keinen** eigenen Click-Handler.

### 5.4 Titel

- `title` als String oder Funktion wird nach erfolgreichem `load` ausgewertet.
- Mit `baseTitle`: `"{title} · {baseTitle}"`. Ohne `title`: nur `baseTitle`. Ohne beides: `document.title` bleibt unverändert.

### 5.5 Redirect und `navigate`

- `app.navigate(path)`: `history.pushState` + Router auf `path` routen.
- Redirect aus einem Guard: `history.replaceState` + Router auf das Ziel routen. Der Redirect darf **nicht synchron innerhalb von `enter`** eine neue Navigation starten, sondern muss nach Abbruch der aktuellen geplant werden (z. B. `queueMicrotask`).
- Redirect-Schleifen: Nach 10 aufeinanderfolgenden Redirects ohne erfolgreiche Navigation wird abgebrochen und ein Fehler geloggt.

> Hinweis für die Implementierung: Das genaue Verhalten von `goto()` bzgl. History hängt von der Version von `@lit-labs/router` ab. Vor der Implementierung im Quellcode der installierten Version prüfen, ob `goto` die History selbst anfasst, und 5.5 entsprechend umsetzen.

## 6. Paketstruktur

```
lit-canon/
├── src/
│   ├── index.ts          # öffentliche Exporte
│   ├── page.ts           # definePage, PageDef
│   ├── feature.ts        # defineFeature, FeatureDef, Layout
│   ├── guard.ts          # Guard, redirect, isRedirect
│   ├── container.ts      # provide, Container, Auflösung
│   ├── app.ts            # createApp, Root-Element, Router-Verdrahtung
│   └── errors.ts         # Fehlermeldungen
├── test/
├── examples/basic/       # lauffähige Mini-App (siehe 8)
├── package.json
├── tsconfig.json
└── README.md
```

## 7. Tests

Tests laufen im echten Browser (z. B. Vitest Browser Mode oder `@web/test-runner`), nicht in jsdom, weil Custom Elements, Shadow DOM und Context-Events beteiligt sind.

Mindestens abzudecken:

- **Validierung:** doppelter Path, doppelter Feature-Name, doppelter Context, belegter Tag-Name → jeweils Fehler mit sprechender Meldung
- **Container:** Reihenfolge der Auflösung; `get` auf späteren/unbekannten Context wirft; Singleton-Verhalten
- **Context:** eine Page mit `@consume` bekommt den Wert aus einem Feature-Provider und aus einem App-Provider
- **Routing:** richtige Page für Path mit Params; Layout wird angewendet; Page ohne Layout wird nicht eingewickelt; `notFound` greift
- **Lazy Loading:** `load` wird erst beim Betreten der Route aufgerufen; Fehler in `load` bricht ab
- **Guards:** sequenzielle Ausführung; `false` bleibt auf aktueller Seite; `redirect` landet auf Ziel und ersetzt den History-Eintrag; async Guards; Redirect-Schleife wird abgebrochen
- **Titel:** String, Funktion mit Params, `baseTitle`-Kombination
- **Scroll:** scrollt nach `navigate`, nicht nach `popstate`

## 8. Beispiel-App (Akzeptanzkriterium)

Unter `examples/basic/` liegt eine lauffähige App (Vite), die genau dieses `main.ts` verwendet und funktioniert:

```ts
const FEATURES = [authFeature, browsersFeature];

createApp({
  root: document.querySelector("#app")!,
  features: FEATURES,
  providers: [provide(apiCtx, () => new FakeApiClient())],
  notFound: () => html`<not-found-page></not-found-page>`,
  baseTitle: "Example",
}).start();
```

Mit:

- `authFeature`: `/login`-Page, `AuthService`-Provider
- `browsersFeature`: `/browsers` (Liste) und `/browsers/:id` (Detail), beide lazy geladen, mit `shellLayout`, Detail-Page geschützt durch einen Guard, der ohne Login auf `/login` umleitet
- Detail-Page lädt ihre Daten selbst mit `@lit/task` und dem per `@consume` injizierten `BrowserService`

## 9. Definition of Done

- Alle Tests aus Abschnitt 7 grün
- Beispiel-App aus Abschnitt 8 läuft
- Keine Features aus Abschnitt 2 implementiert
- README mit: Motivation (ein Absatz), Installation, dem Beispiel aus Abschnitt 8, API-Referenz für jede Funktion aus Abschnitt 4, Hinweis auf URLPattern-Polyfill
- Öffentliche API exakt wie in Abschnitt 4. Abweichungen nur nach Rückfrage
