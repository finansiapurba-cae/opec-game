import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import en, { type Dict } from './en';
import zh from './zh';

export type Lang = 'en' | 'zh';
const dicts: Record<Lang, Dict> = { en, zh };

type Params = Record<string, string | number | null | undefined>;

function lookup(dict: unknown, key: string): string | undefined {
  let cur: any = dict;
  for (const part of key.split('.')) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return typeof cur === 'string' ? cur : undefined;
}

export function format(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, k) => (params[k] == null ? '' : String(params[k])));
}

interface I18nValue {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string, params?: Params) => string;
  /** `true` when the key exists */
  has: (key: string) => boolean;
}

const I18nContext = createContext<I18nValue | null>(null);
const STORAGE_KEY = 'opec-lang';

function initialLang(): Lang {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === 'en' || saved === 'zh') return saved;
  } catch {
    /* storage unavailable */
  }
  return typeof navigator !== 'undefined' && /^zh/i.test(navigator.language) ? 'zh' : 'en';
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);
  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {
      /* ignore */
    }
    document.documentElement.lang = l === 'zh' ? 'zh-Hant' : 'en';
  }, []);
  const value = useMemo<I18nValue>(
    () => ({
      lang,
      setLang,
      t: (key, params) => format(lookup(dicts[lang], key) ?? lookup(dicts.en, key) ?? key, params),
      has: (key) => lookup(dicts.en, key) !== undefined,
    }),
    [lang, setLang],
  );
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const v = useContext(I18nContext);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}

/** Translate an error raised by an RPC. */
export function useErrorText() {
  const { t, has } = useI18n();
  return (err: unknown): string => {
    const code = (err as { code?: string })?.code ?? (err as Error)?.message ?? 'unknown';
    return has(`errors.${code}`) ? t(`errors.${code}`) : t('errors.generic', { code });
  };
}
