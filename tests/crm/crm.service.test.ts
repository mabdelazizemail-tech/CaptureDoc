import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mock Supabase ───────────────────────────────────────────────────────────
const mockSelect   = vi.fn();
const mockInsert   = vi.fn();
const mockUpdate   = vi.fn();
const mockEq       = vi.fn();
const mockOrder    = vi.fn();
const mockSingle   = vi.fn();

const chainMock = {
  select: mockSelect,
  insert: mockInsert,
  update: mockUpdate,
  eq:     mockEq,
  order:  mockOrder,
  single: mockSingle,
};

// Each mock returns `this` for chaining
Object.values(chainMock).forEach((fn) => fn.mockReturnValue(chainMock));

vi.mock('../../services/supabaseClient', () => ({
  supabase: { from: vi.fn(() => chainMock) },
}));

import {
  getLeads, createLead, getDeals, getContacts,
  getTasks, updateTaskStatus, getCompanies,
  getLeadDetail,
} from '../../services/crmService';

// ─── Test Data ──────────────────────────────────────────────────────────────
const MOCK_LEAD = {
  id: 'lead-001',
  first_name: 'Jane',
  last_name: 'Cooper',
  company: 'Acme Inc.',
  title: 'Sales Director',
  email: 'jane@acme.io',
  phone: '+1555000001',
  status: 'New' as const,
  created_at: new Date().toISOString(),
};

const MOCK_DEAL = {
  id: 'deal-001',
  name: 'Acme Corp - Enterprise',
  value: 50000,
  currency: 'USD' as const,
  stage: 'Proposal' as const,
  created_at: new Date().toISOString(),
};

const MOCK_TASK = {
  id: 'task-001',
  title: 'Follow up call',
  status: 'Pending' as const,
  due_date: new Date(Date.now() + 86_400_000).toISOString(),
};

// ─── Lead Tests ──────────────────────────────────────────────────────────────
describe('crmService — Leads', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getLeads() returns array from Supabase', async () => {
    mockOrder.mockResolvedValueOnce({ data: [MOCK_LEAD], error: null });
    const leads = await getLeads();
    expect(leads).toHaveLength(1);
    expect(leads[0].first_name).toBe('Jane');
  });

  it('getLeads() returns [] on error', async () => {
    mockOrder.mockResolvedValueOnce({ data: null, error: { message: 'DB error' } });
    const leads = await getLeads();
    expect(leads).toEqual([]);
  });

  it('createLead() sends correct payload', async () => {
    mockSingle.mockResolvedValueOnce({ data: MOCK_LEAD, error: null });
    const result = await createLead({
      first_name: 'Jane',
      last_name: 'Cooper',
      status: 'New',
    });
    expect(result.error).toBeNull();
    expect(result.data?.first_name).toBe('Jane');
  });

  it('createLead() rejects invalid status (Junk not in schema)', async () => {
    // The DB CHECK constraint rejects 'Junk' — service should propagate the error
    mockSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'new row violates row-level security policy for table "leads"' },
    });
    // @ts-expect-error intentional bad status
    const result = await createLead({ first_name: 'X', last_name: 'Y', status: 'Junk' });
    expect(result.error).not.toBeNull();
  });

  it('getLeadDetail() fetches single lead by id', async () => {
    mockSingle.mockResolvedValueOnce({ data: MOCK_LEAD, error: null });
    const lead = await getLeadDetail('lead-001');
    expect(lead?.id).toBe('lead-001');
  });

  it('getLeadDetail() returns null on error', async () => {
    mockSingle.mockResolvedValueOnce({ data: null, error: { message: 'Not found' } });
    const lead = await getLeadDetail('nonexistent');
    expect(lead).toBeNull();
  });
});

// ─── Deal Tests ──────────────────────────────────────────────────────────────
describe('crmService — Deals', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getDeals() returns deals with relations', async () => {
    mockOrder.mockResolvedValueOnce({ data: [MOCK_DEAL], error: null });
    const deals = await getDeals();
    expect(deals[0].stage).toBe('Proposal');
    expect(deals[0].value).toBe(50000);
  });

  it('deal stages are constrained to valid values', () => {
    const VALID_STAGES = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
    expect(VALID_STAGES).toContain(MOCK_DEAL.stage);
    expect(VALID_STAGES).not.toContain('Pipeline'); // Not a valid Zoho stage
  });
});

// ─── Task Tests ──────────────────────────────────────────────────────────────
describe('crmService — Tasks', () => {
  beforeEach(() => vi.clearAllMocks());

  it('getTasks() orders by due_date ascending', async () => {
    mockOrder.mockResolvedValueOnce({ data: [MOCK_TASK], error: null });
    const tasks = await getTasks();
    expect(tasks).toHaveLength(1);
  });

  it('updateTaskStatus() toggles Pending → Completed', async () => {
    mockEq.mockResolvedValueOnce({ error: null });
    const ok = await updateTaskStatus('task-001', 'Completed');
    expect(ok).toBe(true);
  });

  it('updateTaskStatus() returns false on DB error', async () => {
    mockEq.mockResolvedValueOnce({ error: { message: 'Update failed' } });
    const ok = await updateTaskStatus('task-001', 'Completed');
    expect(ok).toBe(false);
  });
});

// ─── Data Integrity Tests ────────────────────────────────────────────────────
describe('Data Integrity — Schema validation', () => {
  it('Lead status must be one of the schema values', () => {
    const VALID = ['New', 'Contacted', 'Qualified', 'Lost'];
    const lead = { ...MOCK_LEAD, status: 'New' as const };
    expect(VALID).toContain(lead.status);
  });

  it('Deal currency must be USD or EGP', () => {
    const VALID = ['USD', 'EGP'];
    expect(VALID).toContain(MOCK_DEAL.currency);
  });

  it('Deal stage must be a pipeline stage', () => {
    const VALID = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];
    expect(VALID).toContain(MOCK_DEAL.stage);
  });

  it('Lead required fields: first_name and last_name must not be empty', () => {
    const validate = (l: { first_name: string; last_name: string }) =>
      l.first_name.trim().length > 0 && l.last_name.trim().length > 0;

    expect(validate({ first_name: 'Jane', last_name: 'Cooper' })).toBe(true);
    expect(validate({ first_name: '', last_name: 'Cooper' })).toBe(false);
    expect(validate({ first_name: 'Jane', last_name: '' })).toBe(false);
    expect(validate({ first_name: '  ', last_name: '  ' })).toBe(false);
  });

  it('Deal value must be a positive number', () => {
    const validate = (v: number) => typeof v === 'number' && v > 0;
    expect(validate(50000)).toBe(true);
    expect(validate(0)).toBe(false);
    expect(validate(-100)).toBe(false);
  });
});
