import {makeAutoObservable, runInAction} from 'mobx';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {makePersistable} from 'mobx-persist-store';
import * as Keychain from 'react-native-keychain';

import type {SearchProviderId} from '../services/search/types';
import {resetSearchCache} from '../services/search/searchBudget';

/** Distinct Keychain service per provider so iOS entries co-exist. */
const keychainService = (id: SearchProviderId): string =>
  `search_provider_service_${id}`;

export interface SearchProviderMeta {
  id: SearchProviderId;
  label: string;
  /** Gated providers appear in the picker but cannot be the active provider. */
  selectable: boolean;
  /** Keyless providers (e.g. the built-in DuckDuckGo) need no BYOK key. */
  requiresKey: boolean;
}

/**
 * `duckduckgo` is a built-in, keyless provider — it works out of the box with no
 * API key, so it's first and the default. Tavily/Brave/Exa stay as optional
 * premium upgrades. Parallel ships gated (not selectable) until its
 * free-tier/PAYG terms are confirmed.
 */
export const SEARCH_PROVIDERS: SearchProviderMeta[] = [
  {
    id: 'duckduckgo',
    label: '免费内置搜索',
    selectable: true,
    requiresKey: false,
  },
  {id: 'tavily', label: 'Tavily', selectable: true, requiresKey: true},
  {id: 'brave', label: 'Brave', selectable: true, requiresKey: true},
  {id: 'exa', label: 'Exa', selectable: true, requiresKey: true},
  {id: 'parallel', label: 'Parallel', selectable: false, requiresKey: true},
];

const DEFAULT_PROVIDER: SearchProviderId = 'duckduckgo';
const DEFAULT_RESULT_COUNT = 5;
const MIN_RESULT_COUNT = 1;
const MAX_RESULT_COUNT = 8;

class SearchProviderStore {
  activeProviderId: SearchProviderId = DEFAULT_PROVIDER;
  resultCount: number = DEFAULT_RESULT_COUNT;
  hasConsentedToSearch = false;
  /**
   * 安全闸命中（Frida / Xposed 等注入框架）时为 true：付费供应商的密钥
   * 故意不从钥匙串释放。给 UI 做明确提示用，不持久化。
   */
  secretBlocked = false;

  /** In-memory mirror of each provider's BYOK key (source of truth: Keychain). */
  private keys: Partial<Record<SearchProviderId, string>> = {};

  constructor() {
    makeAutoObservable(this);

    makePersistable(this, {
      name: 'SearchProviderStore',
      properties: ['activeProviderId', 'resultCount', 'hasConsentedToSearch'],
      storage: AsyncStorage,
    }).then(() => this.normalizeHydratedPrefs());

    this.loadKeysFromSecureStorage();
  }

  // Persisted prefs skip the setters — re-validate after hydration so a stale
  // gated/unknown provider, malformed type, or out-of-range count can't
  // survive a reload. Consent is a privacy gate: only a literal true counts.
  normalizeHydratedPrefs() {
    const meta = SEARCH_PROVIDERS.find(p => p.id === this.activeProviderId);
    const provider =
      meta && meta.selectable ? this.activeProviderId : DEFAULT_PROVIDER;
    const rawCount: unknown = this.resultCount;
    const count =
      typeof rawCount === 'number' && Number.isFinite(rawCount)
        ? Math.min(
            MAX_RESULT_COUNT,
            Math.max(MIN_RESULT_COUNT, Math.round(rawCount)),
          )
        : DEFAULT_RESULT_COUNT;
    const consent = (this.hasConsentedToSearch as unknown) === true;
    runInAction(() => {
      this.activeProviderId = provider;
      this.resultCount = count;
      this.hasConsentedToSearch = consent;
    });
  }

  private async loadKeysFromSecureStorage() {
    // 安全闸：检测到注入框架（Frida/Xposed 等）时不释放密钥
    try {
      const {allowSecretAccess} = require('../services/security/securityGuard');
      if (!(await allowSecretAccess())) {
        runInAction(() => {
          this.secretBlocked = true;
        });
        return;
      }
    } catch {
      /* 守卫自身异常：放行（宁可漏报不可误杀） */
    }
    for (const {id} of SEARCH_PROVIDERS) {
      try {
        const credentials = await Keychain.getGenericPassword({
          service: keychainService(id),
        });
        if (credentials) {
          runInAction(() => {
            this.keys[id] = credentials.password;
          });
        }
      } catch (error) {
        console.error(`Failed to load ${id} search key:`, error);
      }
    }
  }

  get providers(): SearchProviderMeta[] {
    return SEARCH_PROVIDERS;
  }

  getKey(id: SearchProviderId): string {
    return this.keys[id] ?? '';
  }

  hasKey(id: SearchProviderId): boolean {
    return (this.keys[id] ?? '').trim().length > 0;
  }

  get isProviderConfigured(): boolean {
    // Keyless providers (built-in DuckDuckGo) are always configured.
    const meta = SEARCH_PROVIDERS.find(p => p.id === this.activeProviderId);
    if (meta && !meta.requiresKey) {
      return true;
    }
    return this.hasKey(this.activeProviderId);
  }

  /** True when the active provider needs a BYOK key before it can search. */
  get activeProviderRequiresKey(): boolean {
    const meta = SEARCH_PROVIDERS.find(p => p.id === this.activeProviderId);
    return meta ? meta.requiresKey : true;
  }

  get canSearch(): boolean {
    return this.hasConsentedToSearch && this.isProviderConfigured;
  }

  setActiveProvider(id: SearchProviderId) {
    const meta = SEARCH_PROVIDERS.find(p => p.id === id);
    if (!meta || !meta.selectable) {
      return;
    }
    runInAction(() => {
      this.activeProviderId = id;
    });
    resetSearchCache();
  }

  setResultCount(count: number) {
    const clamped = Math.min(
      MAX_RESULT_COUNT,
      Math.max(MIN_RESULT_COUNT, Math.round(count)),
    );
    runInAction(() => {
      this.resultCount = clamped;
    });
  }

  setConsent(consented: boolean) {
    runInAction(() => {
      this.hasConsentedToSearch = consented;
    });
    resetSearchCache();
  }

  async setKey(id: SearchProviderId, key: string): Promise<boolean> {
    try {
      await Keychain.setGenericPassword(id, key, {
        service: keychainService(id),
      });
      runInAction(() => {
        this.keys[id] = key;
      });
      resetSearchCache();
      return true;
    } catch (error) {
      console.error(`Failed to save ${id} search key:`, error);
      return false;
    }
  }

  async clearKey(id: SearchProviderId): Promise<boolean> {
    try {
      await Keychain.resetGenericPassword({service: keychainService(id)});
      runInAction(() => {
        delete this.keys[id];
      });
      resetSearchCache();
      return true;
    } catch (error) {
      console.error(`Failed to clear ${id} search key:`, error);
      return false;
    }
  }
}

export const searchProviderStore = new SearchProviderStore();
export {SearchProviderStore};
