import { useSyncExternalStore } from 'react';
import { en } from './en';
import { vi } from './vi';

export type Lang = 'vi' | 'en';
const dicts: Record<Lang, Record<string, string>> = { vi, en };

let lang: Lang = (() => {
  try {
    const saved = localStorage.getItem('lang');
    if (saved === 'vi' || saved === 'en') return saved;
  } catch {
    // storage unavailable
  }
  return 'vi';
})();

const listeners = new Set<() => void>();

export function getLang() {
  return lang;
}

export function setLang(next: Lang) {
  lang = next;
  try {
    localStorage.setItem('lang', next);
  } catch {
    // storage unavailable
  }
  listeners.forEach((l) => l());
}

/** Numeric params with these names are formatted as money. */
const MONEY_PARAMS = new Set(['cost', 'reward', 'penalty', 'money']);

/**
 * Translate a key. `{param}` placeholders are replaced; string params that are
 * themselves translation keys (e.g. building names) are translated too.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  const dict = dicts[lang];
  let s = dict[key] ?? en[key] ?? key;
  if (params) {
    s = s.replace(/\{(\w+)\}/g, (_, p: string) => {
      const v = params[p];
      if (v === undefined) return `{${p}}`;
      if (typeof v === 'number') return MONEY_PARAMS.has(p) ? formatMoney(v) : formatNumber(v);
      return dict[v] ?? en[v] ?? v;
    });
  }
  return s;
}

export function formatNumber(n: number) {
  return Math.round(n).toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-US');
}

/** Money is stored in thousands of VND. */
export function formatMoney(k: number) {
  const vnd = k * 1000;
  const abs = Math.abs(vnd);
  const sign = vnd < 0 ? '−' : '';
  if (abs >= 1e9) return `${sign}${(abs / 1e9).toFixed(2)} ${t('unit.billion')}`;
  if (abs >= 1e6) return `${sign}${(abs / 1e6).toFixed(1)} ${t('unit.million')}`;
  return `${sign}${formatNumber(abs)}₫`;
}

export function useLang(): Lang {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => lang,
  );
}
