// Canonical account naming for customers and suppliers.
//
// The same company reaches us spelled several ways — OCR'd invoice headers,
// manual entry, and the master dropdown lists all disagree. Financial reports
// (statements of account above all) must show one account per company, so
// grouping keys off this module rather than the raw string.

// Zero-width marks, bidi controls and BOM survive copy/paste out of PDFs but
// carry no meaning for identity comparison. Same for Arabic diacritics/tatweel.
const INVISIBLE = /[​-‏‪-‮⁦-⁩﻿]/g;
const DIACRITICS = /[ً-ْٰـ]/g;

/** Normalised comparison key: same company => same key. */
export const normalizeAccountName = (raw: string): string =>
  (raw ?? '')
    .normalize('NFKC')
    .replace(INVISIBLE, '')
    .replace(DIACRITICS, '')
    .replace(/ /g, ' ')
    .replace(/[إأآٱا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .replace(/^\s*(شركة|شركه|مؤسسة|مؤسسه|مصنع|مكتب)\s+/i, '')
    .replace(/\s*(ش\s*\.?\s*م\s*\.?\s*م|ذ\s*\.?\s*م\s*\.?\s*م)\s*$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Known misspellings that normalisation cannot resolve, because the letters
// genuinely differ (e.g. ت vs ن — visually near-identical at small sizes, but
// merging them wholesale would corrupt unrelated names). Each entry maps
// spelling variants onto the name we want displayed.
const ALIASES: { canonical: string; variants: string[] }[] = [
  {
    canonical: 'خزنلي للخدمات اللوجيستيه',
    variants: ['خزتلي للخدمات اللوجيستيه'],
  },
];

const ALIAS_BY_KEY = new Map<string, string>();
for (const { canonical, variants } of ALIASES) {
  ALIAS_BY_KEY.set(normalizeAccountName(canonical), canonical);
  for (const v of variants) ALIAS_BY_KEY.set(normalizeAccountName(v), canonical);
}

/**
 * Grouping key for an account. Two spellings of one company share a key;
 * genuinely different companies never do.
 */
export const accountKey = (raw: string): string => {
  const key = normalizeAccountName(raw);
  if (!key) return (raw ?? '').trim();
  const alias = ALIAS_BY_KEY.get(key);
  return alias ? normalizeAccountName(alias) : key;
};

/**
 * Display name for an account. Prefers an explicit alias, then a master-list
 * entry (so the dropdown spelling wins), then the name as stored.
 */
export const canonicalAccountName = (raw: string, master: readonly string[] = []): string => {
  const name = (raw ?? '').trim();
  if (!name) return '';
  const key = normalizeAccountName(name);
  const alias = ALIAS_BY_KEY.get(key);
  if (alias) return alias;
  for (const m of master) if (normalizeAccountName(m) === key) return m;
  return name;
};
