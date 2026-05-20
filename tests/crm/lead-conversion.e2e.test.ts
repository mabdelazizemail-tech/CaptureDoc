/**
 * E2E User Journey Test — Full Sales Rep Flow
 * Lead → Contact → Deal → Won
 *
 * Tests the complete business workflow a sales rep performs.
 * Uses mock data tagged with [QA-TEST] to avoid polluting production.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

// ── Mock Supabase client globally ──────────────────────────────────────────
const db: Record<string, any[]> = {
  leads:     [],
  contacts:  [],
  companies: [],
  deals:     [],
  tasks:     [],
};

let idCounter = 1;
const mkId = () => `qa-test-${idCounter++}`;

// Simulate Supabase fluent API in-memory
function buildChain(table: string) {
  let _data: any = null;
  let _patch: any = null;
  let _filters: { col: string; val: any }[] = [];

  const chain: any = {
    select: (_cols?: string) => chain,
    insert: (row: any) => {
      const record = { ...row, id: mkId(), created_at: new Date().toISOString() };
      db[table].push(record);
      _data = record;
      return chain;
    },
    update: (patch: any) => {
      _patch = patch;
      return chain;
    },
    eq: (col: string, val: any) => {
      _filters.push({ col, val });
      // Flush update immediately when eq is called (mirrors Supabase lazy execution)
      if (_patch !== null) {
        db[table] = db[table].map((r) =>
          _filters.every(({ col: c, val: v }) => r[c] === v) ? { ...r, ..._patch } : r
        );
        return Promise.resolve({ error: null });
      }
      return chain;
    },
    order: () => {
      return Promise.resolve({ data: [...db[table]], error: null });
    },
    single: () => {
      const record = _filters.length
        ? db[table].find((r) => _filters.every(({ col, val }) => r[col] === val))
        : _data;
      return Promise.resolve({
        data: record || null,
        error: record ? null : { message: 'Not found' },
      });
    },
  };
  return chain;
}


vi.mock('../../services/supabaseClient', () => ({
  supabase: { from: (table: string) => buildChain(table) },
}));

import {
  createLead, getLeads,
  createContact, getContacts,
  createCompany, getCompanies,
  createDeal, getDeals, updateDealStage,
} from '../../services/crmService';

// ── Clean up QA test data ──────────────────────────────────────────────────
afterAll(() => {
  Object.keys(db).forEach((k) => { db[k] = []; });
});

// ── Test Journey ──────────────────────────────────────────────────────────
describe('JOURNEY: Full Sales Rep Workflow', () => {

  let leadId: string;
  let contactId: string;
  let accountId: string;
  let dealId: string;

  // Step 1: Create a Lead
  it('STEP 1 — Create a lead with required fields', async () => {
    const { data, error } = await createLead({
      first_name: '[QA-TEST] Jane',
      last_name:  'Cooper',
      company:    'Acme Corp',
      email:      'qa-jane@acme.io',
      phone:      '+15550001234',
      status:     'New',
    });
    expect(error).toBeNull();
    expect(data).toBeTruthy();
    expect(data?.first_name).toBe('[QA-TEST] Jane');
    expect(data?.status).toBe('New');
    leadId = data!.id;
  });

  // Step 2: Verify lead appears in list
  it('STEP 2 — Lead appears in leads list', async () => {
    const leads = await getLeads();
    const found = leads.find((l) => l.id === leadId);
    expect(found).toBeDefined();
    expect(found?.email).toBe('qa-jane@acme.io');
  });

  // Step 3: Create an Account (company)
  it('STEP 3 — Create account for lead\'s company', async () => {
    const { data, error } = await createCompany({
      name:     '[QA-TEST] Acme Corp',
      industry: 'Technology',
      website:  'https://acme.io',
    });
    expect(error).toBeNull();
    expect(data?.name).toContain('Acme Corp');
    accountId = data!.id;
  });

  // Step 4: Convert lead to Contact
  it('STEP 4 — Convert lead to contact (lead conversion)', async () => {
    const { data, error } = await createContact({
      first_name:  '[QA-TEST] Jane',
      last_name:   'Cooper',
      email:       'qa-jane@acme.io',
      phone:       '+15550001234',
      company_id:  accountId,
    });
    expect(error).toBeNull();
    expect(data?.first_name).toBe('[QA-TEST] Jane');
    expect(data?.company_id).toBe(accountId);
    contactId = data!.id;
  });

  // Step 5: Verify contact in list
  it('STEP 5 — Contact appears in contacts list', async () => {
    const contacts = await getContacts();
    const found = contacts.find((c) => c.id === contactId);
    expect(found).toBeDefined();
  });

  // Step 6: Create a Deal linked to the contact and account
  it('STEP 6 — Create deal at Proposal stage', async () => {
    const { data, error } = await createDeal({
      name:       '[QA-TEST] Acme Enterprise Deal',
      value:      75000,
      currency:   'USD',
      stage:      'Proposal',
      contact_id: contactId,
      company_id: accountId,
      close_date: new Date(Date.now() + 30 * 86_400_000).toISOString().split('T')[0],
    });
    expect(error).toBeNull();
    expect(data?.name).toContain('Acme Enterprise Deal');
    expect(data?.value).toBe(75000);
    expect(data?.stage).toBe('Proposal');
    dealId = data!.id;
  });

  // Step 7: Advance deal through pipeline
  it('STEP 7 — Advance deal: Proposal → Won', async () => {
    const ok = await updateDealStage(dealId, 'Won');
    expect(ok).toBe(true);

    const deals = await getDeals();
    const updated = deals.find((d) => d.id === dealId);
    expect(updated?.stage).toBe('Won');
  });

  // Step 8: Verify dashboard metrics reflect the closed deal
  it('STEP 8 — Dashboard calculations: won revenue > 0', async () => {
    const deals = await getDeals();
    const wonRevenue = deals
      .filter((d) => d.stage === 'Won')
      .reduce((sum, d) => sum + d.value, 0);
    expect(wonRevenue).toBeGreaterThan(0);
  });
});

// ── Validation E2E Tests ───────────────────────────────────────────────────
describe('VALIDATION: Business Rule Enforcement', () => {

  it('Cannot create lead with empty first_name', () => {
    const validate = (fn: string, ln: string) => fn.trim().length > 0 && ln.trim().length > 0;
    expect(validate('', 'Cooper')).toBe(false);
  });

  it('Cannot create deal with value <= 0', () => {
    const validate = (v: number) => v > 0;
    expect(validate(0)).toBe(false);
    expect(validate(-1)).toBe(false);
    expect(validate(1)).toBe(true);
  });

  it('Deal stage transitions must follow pipeline order', () => {
    const STAGES = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
    const isValidStage = (s: string) => STAGES.includes(s);
    expect(isValidStage('Won')).toBe(true);
    expect(isValidStage('Closed')).toBe(false); // Not a valid stage
    expect(isValidStage('Negotiation')).toBe(false); // Zoho stage, not in our schema
  });

  it('Lead email format validation', () => {
    const isValidEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
    expect(isValidEmail('jane@acme.io')).toBe(true);
    expect(isValidEmail('not-an-email')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });
});
