import { supabase } from './supabaseClient';

export interface Company {
  id: string;
  name: string;
  industry?: string;
  website?: string;
  created_at?: string;
}

export type Account = Company;

export interface Lead {
  id: string;
  first_name: string;
  last_name: string;
  company?: string;
  title?: string;
  email?: string;
  phone?: string;
  status: 'New' | 'Contacted' | 'Qualified' | 'Lost';
  source?: string;   // B-003 fix: was missing from type
  value?: number;
  notes?: string;
  created_by?: string;
  created_at?: string;
}

export interface Contact {
  id: string;
  first_name: string;
  last_name: string;
  title?: string;
  email?: string;
  phone?: string;
  company_id?: string;
  notes?: string;
  created_at?: string;
  company?: Company;
}

export interface Deal {
  id: string;
  name: string;
  value: number;
  currency: 'USD' | 'EGP';
  close_date?: string;
  stage: 'Lead' | 'Qualified' | 'Proposal' | 'Won' | 'Lost';
  contact_id?: string;
  company_id?: string;
  line_of_business?: string;
  created_by?: string;
  created_at?: string;
  company?: Company;
  contact?: Contact;
}

export interface Task {
  id: string;
  title: string;
  due_date?: string;
  status: 'Pending' | 'Completed';
  priority?: 'High' | 'Medium' | 'Low';
  contact_id?: string;
  deal_id?: string;
  created_at?: string;
  contact?: Contact;
  deal?: Deal;
}

// ─── GET ──────────────────────────────────────────────────────────────────────

export const getLeads = async (): Promise<Lead[]> => {
  const { data, error } = await supabase
    .from('leads')
    .select('*')
    .order('created_at', { ascending: false });
  if (error) { console.error('Error fetching leads:', error); return []; }
  return data as Lead[];
};

export const getContacts = async (): Promise<Contact[]> => {
  const { data, error } = await supabase
    .from('contacts')
    .select(`*, company:companies(id,name)`)
    .order('created_at', { ascending: false });
  if (error) { console.error('Error fetching contacts:', error); return []; }
  return data as Contact[];
};

export const getDeals = async (): Promise<Deal[]> => {
  const { data, error } = await supabase
    .from('deals')
    .select(`*, company:companies(id,name), contact:contacts(id,first_name,last_name,email)`)
    .order('created_at', { ascending: false });
  if (error) { console.error('Error fetching deals:', error); return []; }
  return data as Deal[];
};

export const getTasks = async (): Promise<Task[]> => {
  const { data, error } = await supabase
    .from('tasks')
    .select('*, contact:contacts(id,first_name,last_name), deal:deals(id,name)')
    .order('due_date', { ascending: true });
  if (error) { console.error('Error fetching tasks:', error); return []; }
  return data as Task[];
};

export const getCompanies = async (): Promise<Company[]> => {
  const { data, error } = await supabase
    .from('companies')
    .select('*')
    .order('name', { ascending: true });
  if (error) { console.error('Error fetching companies:', error); return []; }
  return data as Company[];
};

// ─── DETAIL ───────────────────────────────────────────────────────────────────

export const getLeadDetail = async (id: string): Promise<Lead | null> => {
  const { data, error } = await supabase.from('leads').select('*').eq('id', id).single();
  if (error) { console.error('Error fetching lead detail:', error); return null; }
  return data as Lead;
};

export const getContactDetail = async (id: string): Promise<Contact | null> => {
  const { data, error } = await supabase
    .from('contacts').select(`*, company:companies(*)`)
    .eq('id', id).single();
  if (error) { console.error('Error fetching contact detail:', error); return null; }
  return data as Contact;
};

export const getAccountDetail = async (id: string): Promise<Company | null> => {
  const { data, error } = await supabase.from('companies').select(`*`).eq('id', id).single();
  if (error) { console.error('Error fetching company detail:', error); return null; }
  return data as Company;
};

export const getDealDetail = async (id: string): Promise<Deal | null> => {
  const { data, error } = await supabase
    .from('deals').select(`*, company:companies(*), contact:contacts(*)`)
    .eq('id', id).single();
  if (error) { console.error('Error fetching deal detail:', error); return null; }
  return data as Deal;
};

export const getAccountContacts = async (companyId: string): Promise<Contact[]> => {
  const { data, error } = await supabase.from('contacts').select('*').eq('company_id', companyId);
  return error ? [] : data as Contact[];
};

export const getAccountDeals = async (companyId: string): Promise<Deal[]> => {
  const { data, error } = await supabase.from('deals').select('*').eq('company_id', companyId);
  return error ? [] : data as Deal[];
};

export const getContactDeals = async (contactId: string): Promise<Deal[]> => {
  const { data, error } = await supabase.from('deals').select('*').eq('contact_id', contactId);
  return error ? [] : data as Deal[];
};

// ─── CREATE ───────────────────────────────────────────────────────────────────

export const createLead = async (lead: Omit<Lead, 'id' | 'created_at'>) =>
  supabase.from('leads').insert(lead).select().single();

export const createCompany = async (company: Omit<Company, 'id' | 'created_at'>) =>
  supabase.from('companies').insert(company).select().single();

export const createContact = async (contact: Omit<Contact, 'id' | 'created_at' | 'company'>) =>
  supabase.from('contacts').insert(contact).select(`*, company:companies(id,name)`).single();

export const createDeal = async (deal: Omit<Deal, 'id' | 'created_at' | 'company' | 'contact'>) =>
  supabase.from('deals').insert(deal).select(`*, company:companies(id,name)`).single();

// B-002 fix: createTask was missing entirely
export const createTask = async (task: Omit<Task, 'id' | 'created_at' | 'contact' | 'deal'>) =>
  supabase.from('tasks').insert(task).select().single();

// ─── UPDATE ───────────────────────────────────────────────────────────────────

export const updateLead = async (id: string, patch: Partial<Omit<Lead, 'id' | 'created_at'>>) => {
  const { error } = await supabase.from('leads').update(patch).eq('id', id);
  if (error) { console.error('Error updating lead:', error); return false; }
  return true;
};

export const updateContact = async (id: string, patch: Partial<Omit<Contact, 'id' | 'created_at' | 'company'>>) => {
  const { error } = await supabase.from('contacts').update(patch).eq('id', id);
  if (error) { console.error('Error updating contact:', error); return false; }
  return true;
};

export const updateCompany = async (id: string, patch: Partial<Omit<Company, 'id' | 'created_at'>>) => {
  const { error } = await supabase.from('companies').update(patch).eq('id', id);
  if (error) { console.error('Error updating company:', error); return false; }
  return true;
};

export const updateDeal = async (id: string, patch: Partial<Omit<Deal, 'id' | 'created_at' | 'company' | 'contact'>>) => {
  const { error } = await supabase.from('deals').update(patch).eq('id', id);
  if (error) { console.error('Error updating deal:', error); return false; }
  return true;
};

export const updateDealStage = async (dealId: string, newStage: Deal['stage']): Promise<boolean> => {
  const { error } = await supabase.from('deals').update({ stage: newStage }).eq('id', dealId);
  if (error) { console.error('Error updating deal stage:', error); return false; }
  return true;
};

export const updateTaskStatus = async (taskId: string, newStatus: Task['status']): Promise<boolean> => {
  const { error } = await supabase.from('tasks').update({ status: newStatus }).eq('id', taskId);
  if (error) { console.error('Error updating task status:', error); return false; }
  return true;
};

// ─── DELETE ───────────────────────────────────────────────────────────────────

export const deleteLead = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('leads').delete().eq('id', id);
  if (error) { console.error('Error deleting lead:', error); return false; }
  return true;
};

export const deleteContact = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('contacts').delete().eq('id', id);
  if (error) { console.error('Error deleting contact:', error); return false; }
  return true;
};

export const deleteCompany = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('companies').delete().eq('id', id);
  if (error) { console.error('Error deleting company:', error); return false; }
  return true;
};

export const deleteDeal = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('deals').delete().eq('id', id);
  if (error) { console.error('Error deleting deal:', error); return false; }
  return true;
};

export const deleteTask = async (id: string): Promise<boolean> => {
  const { error } = await supabase.from('tasks').delete().eq('id', id);
  if (error) { console.error('Error deleting task:', error); return false; }
  return true;
};
