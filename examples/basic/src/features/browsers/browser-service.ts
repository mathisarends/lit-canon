import { createContext } from '@lit/context';
import type { ApiClient, Browser } from '../../api.js';

export class BrowserService {
  constructor(private readonly api: ApiClient) {}

  list(signal?: AbortSignal) {
    return this.api.get<Browser[]>('/browsers', signal);
  }

  get(id: string, signal?: AbortSignal) {
    return this.api.get<Browser>(`/browsers/${encodeURIComponent(id)}`, signal);
  }
}

export const browserServiceCtx = createContext<BrowserService>('browser-service');
