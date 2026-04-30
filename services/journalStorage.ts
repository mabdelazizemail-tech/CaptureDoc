import { supabase } from './supabaseClient';

/*
  SQL (run once in Supabase SQL editor):

  create table if not exists journal_entries (
    id text primary key,
    data jsonb not null,
    created_at timestamptz default now(),
    updated_at timestamptz default now()
  );

  create index if not exists journal_entries_updated_at on journal_entries(updated_at desc);

  alter table journal_entries enable row level security;
  create policy "allow all" on journal_entries for all using (true) with check (true);
*/

export async function loadJournalEntries<T = unknown>(): Promise<T[]> {
  const { data, error } = await supabase
    .from('journal_entries')
    .select('data')
    .order('updated_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: { data: T }) => r.data);
}

export async function upsertJournalEntry(entry: { id: string; [k: string]: unknown }): Promise<void> {
  const { error } = await supabase
    .from('journal_entries')
    .upsert({ id: entry.id, data: entry, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function deleteJournalEntries(ids: string[]): Promise<void> {
  if (!ids.length) return;
  const { error } = await supabase.from('journal_entries').delete().in('id', ids);
  if (error) throw error;
}
