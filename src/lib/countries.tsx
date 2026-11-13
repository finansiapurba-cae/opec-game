import sa from 'flag-icons/flags/4x3/sa.svg';
import ir from 'flag-icons/flags/4x3/ir.svg';
import iq from 'flag-icons/flags/4x3/iq.svg';
import kw from 'flag-icons/flags/4x3/kw.svg';
import ae from 'flag-icons/flags/4x3/ae.svg';
import ve from 'flag-icons/flags/4x3/ve.svg';
import ng from 'flag-icons/flags/4x3/ng.svg';
import type { CountryCode, WorldCode } from './types';
import { cn } from './utils';

const FLAGS: Record<CountryCode, string> = { SAU: sa, IRN: ir, IRQ: iq, KWT: kw, ARE: ae, VEN: ve, NGA: ng };

/**
 * Display names (the authoritative country data — capacity, reserves, costs —
 * is loaded from the `countries` table).
 */
export const COUNTRY_NAMES: Record<CountryCode, { en: string; zh: string }> = {
  SAU: { en: 'Saudi Arabia', zh: '沙烏地阿拉伯' },
  IRN: { en: 'Iran', zh: '伊朗' },
  IRQ: { en: 'Iraq', zh: '伊拉克' },
  KWT: { en: 'Kuwait', zh: '科威特' },
  ARE: { en: 'UAE', zh: '阿聯' },
  VEN: { en: 'Venezuela', zh: '委內瑞拉' },
  NGA: { en: 'Nigeria', zh: '奈及利亞' },
};

export const COUNTRY_ORDER: CountryCode[] = ['SAU', 'IRN', 'IRQ', 'KWT', 'ARE', 'VEN', 'NGA'];
export const WORLD_CODES: WorldCode[] = ['A', 'B', 'C'];

/** Categorical slots (validated reference palette) — colour follows the entity. */
export const WORLD_COLORS: Record<WorldCode, string> = { A: '#2a78d6', B: '#eb6834', C: '#1baf7a' };
export const COUNTRY_COLORS: Record<CountryCode, string> = {
  SAU: '#2a78d6',
  IRN: '#eb6834',
  IRQ: '#1baf7a',
  KWT: '#eda100',
  ARE: '#e87ba4',
  VEN: '#008300',
  NGA: '#6250d6',
};

export function countryName(code: CountryCode | null | undefined, lang: 'en' | 'zh'): string {
  if (!code) return '';
  return COUNTRY_NAMES[code]?.[lang] ?? code;
}

export function Flag({ code, className }: { code: CountryCode | null | undefined; className?: string }) {
  if (!code) return null;
  return (
    <img
      src={FLAGS[code]}
      alt=""
      aria-hidden="true"
      className={cn('inline-block h-4 w-[1.33rem] shrink-0 rounded-[3px] object-cover ring-1 ring-black/10', className)}
    />
  );
}
