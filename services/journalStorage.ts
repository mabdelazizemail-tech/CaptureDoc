import { supabase } from './supabaseClient';
import type {
  JournalEntryRow,
  JournalEntryLineRow,
  JournalApprovalHistoryRow,
  JournalAttachmentRow,
} from './financeTypes';

// ─── Input types (matches what dashboards and journalAutoPost produce) ──────

interface JournalLineInput {
  line_no: number;
  account_code: string;
  account_name: string;
  cost_center?: string;
  branch?: string;
  project?: string;
  customer_id?: string;
  supplier_id?: string;
  line_description: string;
  debit_amount: number;
  credit_amount: number;
  tax_code?: string;
  due_date?: string;
  reference_1?: string;
  reference_2?: string;
}

interface ApprovalHistoryInput {
  id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'posted' | 'reversed';
  performed_by: string;
  performed_at: string;
  comment?: string;
}

interface AttachmentInput {
  name: string;
  size: string;
}

export interface JournalEntryInput {
  id: string;
  journal_number: string;
  entry_type: string;
  source_module: string;
  source_document_no?: string;
  source_document_id?: string;
  reference_no?: string;
  entry_date: string;
  posting_date?: string;
  fiscal_period?: string;
  currency: string;
  exchange_rate?: number;
  description: string;
  status: string;
  auto_generated_flag: boolean;
  reversal_of_entry_id?: string;
  created_by: string;
  created_at?: string;
  approved_by?: string;
  approved_at?: string;
  posted_by?: string;
  posted_at?: string;
  lines: JournalLineInput[];
  approval_history: ApprovalHistoryInput[];
  attachments: AttachmentInput[];
}

// ─── Row → dashboard shape (adds children as arrays) ────────────────────────

interface JournalEntryWithChildren extends Omit<JournalEntryRow, 'journal_entry_lines' | 'journal_approval_history' | 'journal_attachments'> {
  lines: JournalEntryLineRow[];
  approval_history: JournalApprovalHistoryRow[];
  attachments: JournalAttachmentRow[];
}

function fromRow(r: JournalEntryRow): JournalEntryWithChildren {
  return {
    ...r,
    lines: r.journal_entry_lines ?? [],
    approval_history: r.journal_approval_history ?? [],
    attachments: r.journal_attachments ?? [],
  };
}

// ─── Schema detection (cached) ──────────────────────────────────────────────

let schemaMode: 'relational' | 'jsonb' | null = null;

async function detectSchema(): Promise<'relational' | 'jsonb'> {
  if (schemaMode) return schemaMode;
  const { error } = await supabase
    .from('journal_entries')
    .select('*, journal_entry_lines(*), journal_approval_history(*), journal_attachments(*)')
    .limit(1);
  schemaMode = error ? 'jsonb' : 'relational';
  return schemaMode;
}

// ─── Load all journal entries with nested children ──────────────────────────

export async function loadJournalEntries(): Promise<JournalEntryWithChildren[]> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { data, error } = await supabase
      .from('journal_entries')
      .select('data')
      .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data ?? []).map((r: { data: JournalEntryWithChildren }) => r.data);
  }

  const { data, error } = await supabase
    .from('journal_entries')
    .select('*, journal_entry_lines(*), journal_approval_history(*), journal_attachments(*)')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return ((data ?? []) as JournalEntryRow[]).map(fromRow);
}

// ─── Upsert entry with children ─────────────────────────────────────────────

export async function upsertJournalEntry(entry: JournalEntryInput): Promise<void> {
  const mode = await detectSchema();

  if (mode === 'jsonb') {
    const { error } = await supabase
      .from('journal_entries')
      .upsert({ id: entry.id, data: entry, updated_at: new Date().toISOString() });
    if (error) throw error;
    return;
  }

  const {
    lines, approval_history, attachments,
    ...parentRow
  } = entry;

  // 1. Upsert parent
  const { error: parentErr } = await supabase
    .from('journal_entries')
    .upsert(parentRow);
  if (parentErr) throw parentErr;

  // 2. Replace lines
  await supabase.from('journal_entry_lines').delete().eq('entry_id', entry.id);
  if (lines.length > 0) {
    const lineRows = lines.map((ln) => ({
      account_code: ln.account_code,
      account_name: ln.account_name,
      line_no: ln.line_no,
      line_description: ln.line_description,
      debit_amount: ln.debit_amount,
      credit_amount: ln.credit_amount,
      cost_center: ln.cost_center ?? null,
      branch: ln.branch ?? null,
      project: ln.project ?? null,
      customer_id: ln.customer_id ?? null,
      supplier_id: ln.supplier_id ?? null,
      tax_code: ln.tax_code ?? null,
      due_date: ln.due_date ?? null,
      reference_1: ln.reference_1 ?? null,
      reference_2: ln.reference_2 ?? null,
      entry_id: entry.id,
    }));
    const { error: linesErr } = await supabase.from('journal_entry_lines').insert(lineRows);
    if (linesErr) throw linesErr;
  }

  // 3. Upsert approval history
  if (approval_history.length > 0) {
    const ahRows = approval_history.map((ah) => ({
      id: ah.id,
      entry_id: entry.id,
      action: ah.action,
      performed_by: ah.performed_by,
      performed_at: ah.performed_at,
      comment: ah.comment ?? null,
    }));
    const { error: ahErr } = await supabase.from('journal_approval_history').upsert(ahRows);
    if (ahErr) throw ahErr;
  }

  // 4. Replace attachments
  await supabase.from('journal_attachments').delete().eq('entry_id', entry.id);
  if (attachments.length > 0) {
    const attRows = attachments.map((att) => ({
      entry_id: entry.id,
      name: att.name,
      size: att.size,
    }));
    const { error: attErr } = await supabase.from('journal_attachments').insert(attRows);
    if (attErr) throw attErr;
  }
}

// ─── Delete journal entries (cascade deletes children) ──────────────────────

export async function deleteJournalEntries(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('journal_entries').delete().in('id', ids);
  if (error) throw error;
}
