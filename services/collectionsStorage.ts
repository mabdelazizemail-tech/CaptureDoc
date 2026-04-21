import { supabase } from './supabaseClient';

// One-time schema (run in Supabase SQL editor):
//
// create table if not exists public.collections_invoices (
//   id text primary key,
//   data jsonb not null,
//   updated_at timestamptz default now()
// );
// alter table public.collections_invoices enable row level security;
// create policy "collections_invoices_all" on public.collections_invoices
//   for all using (true) with check (true);

const TABLE = 'collections_invoices';

export async function loadInvoices<T = any>(): Promise<T[]> {
  const { data, error } = await supabase
    .from(TABLE)
    .select('data')
    .order('updated_at', { ascending: false });
  if (error) {
    console.error('[collections] load failed:', error);
    return [];
  }
  return (data || []).map((r: any) => r.data as T);
}

export async function upsertInvoice(invoice: { id: string; [k: string]: any }): Promise<void> {
  const { error } = await supabase
    .from(TABLE)
    .upsert({ id: invoice.id, data: invoice, updated_at: new Date().toISOString() });
  if (error) console.error('[collections] upsert failed:', error);
}

export async function deleteInvoices(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from(TABLE).delete().in('id', ids);
  if (error) console.error('[collections] delete failed:', error);
}
