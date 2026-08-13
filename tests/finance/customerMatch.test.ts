import { describe, it, expect } from 'vitest';
import { CUSTOMERS, canonicalCustomer, matchCustomer } from '../../services/customerMatch';

describe('matchCustomer', () => {
  it('returns the master entry unchanged', () => {
    expect(matchCustomer('زيروكس مصر')).toBe('زيروكس مصر');
  });

  it('matches through an Arabic company prefix', () => {
    expect(matchCustomer('شركه زيروكس مصر')).toBe('زيروكس مصر');
    expect(matchCustomer('شركة زيروكس مصر')).toBe('زيروكس مصر');
  });

  it('matches through letter-shape variants (alef/ya/ta-marbuta)', () => {
    expect(matchCustomer('مؤسسة الأهلى للخدمات الطبية')).toBe('الاهلى للخدمات الطبية');
  });

  it('matches when the full master name appears inside longer OCR text', () => {
    expect(matchCustomer('فاتوره من شركه زيروكس مصر لشهر يناير')).toBe('زيروكس مصر');
  });

  it('matches when a single word is misspelled by OCR', () => {
    // "اللوجيستيه" -> "اللوجستية": two of three words still line up.
    expect(matchCustomer('شركة خزنلى للخدمات اللوجستية')).toBe('خزنلي للخدمات اللوجيستيه');
  });

  // ─── False positives ───────────────────────────────────────────────────────

  it('does not match a different company that shares one word', () => {
    expect(matchCustomer('محمد احمد محمد الخطيب زيروكس دوت كوم')).toBe('');
  });

  it('does not match on a lone generic word', () => {
    expect(matchCustomer('مصر')).toBe('');
    expect(matchCustomer('للخدمات')).toBe('');
  });

  it('does not match a third party that shares only the generic word', () => {
    expect(matchCustomer('النيل للخدمات البتروليه')).toBe('');
  });

  it('returns empty for blank or noise input', () => {
    expect(matchCustomer('')).toBe('');
    expect(matchCustomer('   ')).toBe('');
    expect(matchCustomer('شركة')).toBe('');
  });

  it('never invents a name outside the master list', () => {
    const inputs = [
      'محمد احمد محمد الخطيب زيروكس دوت كوم',
      'شركه زيروكس مصر',
      'النيل للخدمات البتروليه',
      'مصر',
    ];
    for (const raw of inputs) {
      const out = matchCustomer(raw);
      expect(out === '' || CUSTOMERS.includes(out)).toBe(true);
    }
  });
});

describe('canonicalCustomer', () => {
  it('folds spelling variants onto the master entry', () => {
    expect(canonicalCustomer('شركه زيروكس مصر')).toBe('زيروكس مصر');
    expect(canonicalCustomer('زيروكس مصر ش.م.م')).toBe('زيروكس مصر');
  });

  it('leaves unknown names alone instead of guessing', () => {
    expect(canonicalCustomer('محمد احمد محمد الخطيب زيروكس دوت كوم'))
      .toBe('محمد احمد محمد الخطيب زيروكس دوت كوم');
  });
});
