// Customer-name matching for the collections module.
//
// Two related jobs, deliberately kept separate:
//   • canonicalCustomer — strict folding of spelling variants onto one master
//     name, used to group statements of account. Never guesses.
//   • matchCustomer     — best-effort mapping of OCR output onto the master
//     list to pre-select the invoice-form dropdown. Allowed to be fuzzy, but a
//     wrong answer books an invoice against the wrong customer account, so it
//     returns '' rather than a plausible-looking guess.

// Master customer list — shown as dropdown options in the invoice form.
// OCR output is matched against these to pre-select the right option.
export const CUSTOMERS: string[] = [
  'زيروكس مصر',
  'خزنلي للخدمات اللوجيستيه',
  'الاهلى للخدمات الطبية',
];

// Strip common Arabic prefixes/noise and fold letter-shape variants
// (alef/ya/ta-marbuta) so OCR spelling differences compare equal.
export const simplifyArabic = (s: string): string =>
  s
    .normalize('NFKC')
    .replace(/ـ/g, '')
    .replace(/[إأآا]/g, 'ا')
    .replace(/[ىي]/g, 'ي')
    .replace(/[ةه]/g, 'ه')
    .replace(/^\s*(شركة|شركه|مؤسسة|مؤسسه|مصنع|مكتب)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();

// Collapse spelling variants of the same customer onto one canonical name so
// a statement isn't split in two (e.g. an OCR'd "شركه زيروكس مصر" and the
// master-list "زيروكس مصر"). Deliberately strict — prefix/suffix normalisation
// with exact matching only. Unknown names are returned unchanged.
export const canonicalCustomer = (raw: string): string => {
  const name = (raw ?? '').trim();
  if (!name) return '';
  const needle = stripLegalSuffix(name);
  if (!needle) return name;
  for (const c of CUSTOMERS) if (stripLegalSuffix(c) === needle) return c;
  return name;
};

const stripLegalSuffix = (s: string): string =>
  simplifyArabic(s).replace(/\s*(ش\s*\.?\s*م\s*\.?\s*م|ذ\s*\.?\s*م\s*\.?\s*م)\s*$/i, '').trim();

// Words shorter than this carry no identifying signal (Arabic particles, OCR
// crumbs), so they neither earn nor block a match.
const MIN_TOKEN_LEN = 2;
// A fuzzy match must rest on at least this many shared words. One word in
// common is never enough: "زيروكس مصر" and "... الخطيب زيروكس دوت كوم" share
// "زيروكس" but are different companies, and every "... للخدمات ..." entry
// shares "للخدمات" with the others.
const MIN_SHARED_TOKENS = 2;
// Shared words must also account for most of the *longer* name. Scoring
// against only the master entry's length lets a long unrelated name score
// 1.0 by covering a short master entry.
const MIN_OVERLAP_SCORE = 0.6;

const tokenize = (s: string): string[] =>
  simplifyArabic(s).split(' ').filter(t => t.length >= MIN_TOKEN_LEN);

// Does `inner` appear as a contiguous run of whole words inside `outer`?
// Word-level rather than substring so "مصر" can't match inside "زيروكس مصر".
const containsRun = (outer: string[], inner: string[]): boolean => {
  if (!inner.length || inner.length > outer.length) return false;
  for (let i = 0; i <= outer.length - inner.length; i++) {
    if (inner.every((t, j) => outer[i + j] === t)) return true;
  }
  return false;
};

export const matchCustomer = (raw: string): string => {
  if (!raw) return '';

  // 1. Strict pass — exact match once prefixes and legal suffixes are folded.
  //    Handles the common "شركه زيروكس مصر" vs "زيروكس مصر" case with no
  //    fuzziness at all.
  const strict = canonicalCustomer(raw);
  if (CUSTOMERS.includes(strict)) return strict;

  const needle = tokenize(raw);
  if (!needle.length) return '';

  // 2. Whole-name containment — the entire master name appears as a run of
  //    words in the OCR text (or vice versa), e.g. surrounding boilerplate
  //    like "فاتوره من شركه زيروكس مصر لشهر يناير". Requires at least
  //    MIN_SHARED_TOKENS words on the shorter side so a lone generic word
  //    can't claim an account.
  for (const c of CUSTOMERS) {
    const hay = tokenize(c);
    if (Math.min(needle.length, hay.length) < MIN_SHARED_TOKENS) continue;
    if (containsRun(needle, hay) || containsRun(hay, needle)) return c;
  }

  // 3. Token-overlap fallback — catches a single OCR-mangled word
  //    ("اللوجستية" for "اللوجيستيه"). Ambiguous results are rejected: if two
  //    master entries score equally we cannot tell which was meant.
  const needleSet = new Set(needle);
  let best = '';
  let bestScore = 0;
  let ambiguous = false;
  for (const c of CUSTOMERS) {
    const haySet = new Set(tokenize(c));
    let shared = 0;
    haySet.forEach(t => { if (needleSet.has(t)) shared++; });
    if (shared < MIN_SHARED_TOKENS) continue;
    const score = shared / Math.max(needleSet.size, haySet.size);
    if (score < MIN_OVERLAP_SCORE) continue;
    if (score > bestScore) {
      bestScore = score;
      best = c;
      ambiguous = false;
    } else if (score === bestScore) {
      ambiguous = true;
    }
  }
  return ambiguous ? '' : best;
};
