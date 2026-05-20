import React, { useEffect, useState } from 'react';
import { useNavigate, useLocation, Link } from 'react-router-dom';
import {
  Plus, Search, Filter, Columns3, Download,
  X, ChevronDown, AlertCircle, Edit, Trash2, Check,
} from 'lucide-react';
import { getLeads, createLead, deleteLead, updateLead, Lead } from '../../services/crmService';
import SmartLookup, { SmartLookupResult } from '../../components/SmartLookup';
import CRMRecordDetail from './CRMRecordDetail';

const statusStyles: Record<string, string> = {
  New:        'bg-[color-mix(in_oklab,var(--info)_10%,transparent)] text-[var(--info)] border-[color-mix(in_oklab,var(--info)_20%,transparent)]',
  Contacted:  'bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--primary)] border-[color-mix(in_oklab,var(--primary)_20%,transparent)]',
  Qualified:  'bg-[color-mix(in_oklab,var(--success)_10%,transparent)] text-[var(--success)] border-[color-mix(in_oklab,var(--success)_20%,transparent)]',
  Lost:       'bg-[var(--muted)] text-[var(--muted-foreground)] border-[var(--border)]',
  Junk:       'bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)] border-[color-mix(in_oklab,var(--destructive)_20%,transparent)]',
};

const STATUSES: Lead['status'][] = ['New', 'Contacted', 'Qualified', 'Lost'];
const SOURCES  = ['Website', 'Referral', 'LinkedIn', 'Trade Show', 'Cold Call', 'Webinar', 'Inbound Email'];

export default function CRMLeads() {
  const navigate   = useNavigate();
  const location   = useLocation();

  const [leads, setLeads]         = useState<Lead[]>([]);
  const [loading, setLoading]     = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingLead, setEditingLead] = useState<Lead | null>(null);
  const [query, setQuery]         = useState('');
  const [filterStatus, setFilterStatus] = useState('All');
  const [selected, setSelected]   = useState<Set<string>>(new Set());

  // Sliding Drawer states
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Form state
  const [firstName,  setFirstName]  = useState('');
  const [lastName,   setLastName]   = useState('');
  const [company,    setCompany]    = useState('');
  const [title,      setTitle]      = useState('');
  const [email,      setEmail]      = useState('');
  const [phone,      setPhone]      = useState('');
  const [status,     setStatus]     = useState<Lead['status']>('New');
  const [source,     setSource]     = useState('Website');
  const [submitting, setSubmitting] = useState(false);
  const [saveError,  setSaveError]  = useState<string | null>(null);

  useEffect(() => {
    fetchLeads();
    const params = new URLSearchParams(location.search);
    if (params.get('add') === 'true') {
      openCreateModal();
      navigate('/crm/leads', { replace: true });
    }
  }, [location]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (modalOpen) {
          setModalOpen(false);
          e.stopPropagation();
        } else if (drawerOpen) {
          setDrawerOpen(false);
          setTimeout(() => setActiveDetailId(null), 300);
          e.stopPropagation();
        }
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [modalOpen, drawerOpen]);


  async function fetchLeads() {
    setLoading(true);
    const data = await getLeads();
    setLeads(data);
    setLoading(false);
  }

  const openCreateModal = () => {
    setEditingLead(null);
    setFirstName(''); setLastName(''); setCompany(''); setTitle('');
    setEmail(''); setPhone(''); setStatus('New'); setSource('Website');
    setSaveError(null);
    setModalOpen(true);
  };

  const handleLookupSelect = (result: SmartLookupResult) => {
    if (result.type === 'contact') {
      setFirstName(result.contact.first_name || '');
      setLastName(result.contact.last_name || '');
      setEmail(result.contact.email || '');
      setPhone(result.contact.phone || '');
      setCompany(result.contact.company?.name || '');
      setTitle(result.contact.title || '');
    } else if (result.type === 'company') {
      setCompany(result.company.name || '');
    } else if (result.type === 'new_contact') {
      setFirstName(result.firstName);
      setLastName(result.lastName);
      setCompany('');
      setTitle('');
      setEmail('');
      setPhone('');
    } else if (result.type === 'new_company') {
      setCompany(result.name);
    }
  };

  const openEditModal = (lead: Lead) => {
    setEditingLead(lead);
    setFirstName(lead.first_name || '');
    setLastName(lead.last_name || '');
    setCompany(lead.company || '');
    setTitle(lead.title || '');
    setEmail(lead.email || '');
    setPhone(lead.phone || '');
    setStatus(lead.status || 'New');
    setSource(lead.source || 'Website');
    setSaveError(null);
    setModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    setSubmitting(true);
    setSaveError(null);

    const payload = {
      first_name: firstName.trim(),
      last_name:  lastName.trim(),
      company:    company.trim()  || undefined,
      title:      title.trim()    || undefined,
      email:      email.trim()    || undefined,
      phone:      phone.trim()    || undefined,
      source:     source          || undefined,
      status,
    };

    if (editingLead) {
      // Update
      const ok = await updateLead(editingLead.id, payload);
      setSubmitting(false);
      if (!ok) {
        setSaveError('Failed to update lead. Please check network/database.');
        return;
      }
    } else {
      // Create
      const { error } = await createLead(payload);
      setSubmitting(false);
      if (error) {
        console.error('Create lead error:', error);
        setSaveError(error.message || 'Failed to save lead.');
        return;
      }
    }

    setModalOpen(false);
    fetchLeads();
  };

  const handleDelete = async (id: string) => {
    const ok = await deleteLead(id);
    if (ok) {
      setLeads((prev) => prev.filter((l) => l.id !== id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } else {
      alert('Failed to delete lead. It may be referenced by other records.');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selected.size} selected leads?`)) return;
    const ids = Array.from(selected);
    const results = await Promise.all(ids.map((id) => deleteLead(id as string)));
    const successfulIds = ids.filter((_, idx) => results[idx]);

    setLeads((prev) => prev.filter((l) => !successfulIds.includes(l.id)));
    setSelected((prev) => {
      const n = new Set(prev);
      successfulIds.forEach((id) => n.delete(id));
      return n;
    });

    if (successfulIds.length < ids.length) {
      alert('Some leads could not be deleted because they are referenced elsewhere.');
    }
  };

  const filtered = leads.filter((l) => {
    const name = `${l.first_name} ${l.last_name}`.toLowerCase();
    const matchQ = !query || name.includes(query.toLowerCase())
      || (l.company || '').toLowerCase().includes(query.toLowerCase())
      || (l.email || '').toLowerCase().includes(query.toLowerCase());
    const matchS = filterStatus === 'All' || l.status === filterStatus;
    return matchQ && matchS;
  });

  const allChecked = selected.size === filtered.length && filtered.length > 0;
  const toggleAll  = () => setSelected(allChecked ? new Set() : new Set(filtered.map((l) => l.id)));
  const toggle     = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  const newThisWeekCount = leads.filter((l) => {
    const d = new Date(l.created_at || 0);
    const now = new Date();
    return now.getTime() - d.getTime() < 7 * 86400000;
  }).length;

  return (
    <div className="space-y-5 max-w-[1600px] mx-auto">
      {/* Page header */}
      <div className="flex items-end justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            {leads.length} total · {newThisWeekCount} new this week
          </p>
        </div>
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <button
              onClick={handleBulkDelete}
              className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--destructive)] text-white hover:bg-[color-mix(in_oklab,var(--destructive)_90%,transparent)] rounded-md px-3 text-xs h-9 gap-1.5 font-medium"
            >
              <Trash2 className="size-4" /> Delete Selected ({selected.size})
            </button>
          )}
          <button
            onClick={openCreateModal}
            className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 gap-1.5 font-medium"
          >
            <Plus className="size-4" /> Create Lead
          </button>
        </div>
      </div>

      {/* Table card */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm overflow-hidden">
        {/* Toolbar */}
        <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--card)]">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search leads…"
              className="w-full h-9 pl-9 pr-3 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
            />
          </div>
          <div className="flex items-center gap-2">
            {(['All', 'New', 'Contacted', 'Qualified', 'Lost'] as const).map((st) => (
              <button
                key={st}
                onClick={() => setFilterStatus(st)}
                className={`px-2.5 py-1 text-xs font-medium rounded transition-colors ${
                  filterStatus === st
                    ? 'bg-[var(--primary)] text-white'
                    : 'text-[var(--muted-foreground)] hover:bg-[var(--secondary)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm border-collapse">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="w-10 pl-4 py-3 text-left sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    aria-label="Select all"
                    className="rounded cursor-pointer"
                    style={{ accentColor: 'var(--primary)' }}
                  />
                </th>
                {['Lead Name', 'Company', 'Email', 'Phone', 'Lead Source', 'Status', 'Actions'].map((h) => (
                  <th
                    key={h}
                    className="py-3 px-3 text-left text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)] sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-[var(--muted-foreground)]">
                    Loading leads…
                  </td>
                </tr>
              ) : filtered.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-16 text-center text-sm text-[var(--muted-foreground)]">
                    No leads found.{' '}
                    <button
                      onClick={openCreateModal}
                      className="font-medium text-[var(--primary)] hover:underline"
                    >
                      Create one
                    </button>
                  </td>
                </tr>
              ) : filtered.map((lead) => {
                const isSelected = selected.has(lead.id);
                const fullName   = `${lead.first_name} ${lead.last_name}`;
                const initials   = fullName.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
                return (
                  <tr
                    key={lead.id}
                    className={`border-b border-[var(--border)] hover:bg-[color-mix(in_oklab,var(--secondary)_40%,transparent)] transition-colors group ${isSelected ? 'bg-[color-mix(in_oklab,var(--accent)_40%,transparent)]' : ''}`}
                  >
                    <td className="pl-4 py-2.5">
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggle(lead.id)}
                        aria-label={`Select ${fullName}`}
                        className="cursor-pointer"
                        style={{ accentColor: 'var(--primary)' }}
                      />
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <div className="size-7 rounded-full bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--primary)] text-[11px] font-semibold flex items-center justify-center shrink-0">
                          {initials}
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.preventDefault();
                            setActiveDetailId(lead.id);
                            setDrawerOpen(true);
                          }}
                          className="text-sm font-medium text-[var(--foreground)] hover:text-[var(--primary)] hover:underline cursor-pointer text-left font-sans"
                        >
                          {fullName}
                        </button>
                      </div>
                    </td>
                    <td className="text-sm text-[var(--foreground)] py-2.5 px-3">{lead.company || '—'}</td>
                    <td className="text-sm text-[var(--muted-foreground)] py-2.5 px-3">
                      {lead.email ? (
                        <a href={`mailto:${lead.email}`} className="hover:text-[var(--primary)] hover:underline">
                          {lead.email}
                        </a>
                      ) : '—'}
                    </td>
                    <td className="text-sm text-[var(--muted-foreground)] py-2.5 px-3 tabular-nums">
                      {lead.phone || '—'}
                    </td>
                    <td className="text-sm text-[var(--muted-foreground)] py-2.5 px-3">
                      {lead.source || '—'}
                    </td>
                    <td className="py-2.5 px-3">
                      <div className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-[11px] font-medium ${statusStyles[lead.status] || statusStyles['Lost']}`}>
                        {lead.status}
                      </div>
                    </td>
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditModal(lead)}
                          className="inline-flex items-center justify-center size-7 rounded-md text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)] transition-colors"
                          title="Edit Lead"
                        >
                          <Edit className="size-4" />
                        </button>
                        <button
                          onClick={() => handleDelete(lead.id)}
                          className="inline-flex items-center justify-center size-7 rounded-md text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] hover:text-[var(--destructive)] transition-colors"
                          title="Delete Lead"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)] text-xs text-[var(--muted-foreground)]">
          <div>
            Showing <span className="font-medium text-[var(--foreground)]">1–{filtered.length}</span>
            {' '}of{' '}
            <span className="font-medium text-[var(--foreground)]">{filtered.length}</span> leads
          </div>
          <div className="flex items-center gap-2">
            <button disabled className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] rounded-md px-3 text-xs h-8 opacity-50 cursor-not-allowed">
              Previous
            </button>
            <button disabled className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] rounded-md px-3 text-xs h-8 opacity-50 cursor-not-allowed">
              Next
            </button>
          </div>
        </div>
      </div>

      {/* Create or Edit Lead Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50"
          onClick={() => setModalOpen(false)}
        >
          <div
            className="w-full max-w-[560px] bg-[var(--card)] rounded-xl shadow-2xl overflow-hidden border border-[var(--border)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div className="px-6 pt-5 pb-3 border-b border-[var(--border)]">
              <div className="flex items-start justify-between">
                <div>
                  <h2 className="text-base font-semibold text-[var(--foreground)]">
                    {editingLead ? 'Edit Lead' : 'Quick Add Lead'}
                  </h2>
                  <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                    {editingLead ? 'Update the details of this lead record.' : 'Create a new lead record. It will appear instantly in your workspace.'}
                  </p>
                </div>
                <button onClick={() => setModalOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                  <X className="size-5" />
                </button>
              </div>
            </div>

            {saveError && (
              <div className="mx-6 mt-3 flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] px-3 py-2 text-xs text-[var(--destructive)]">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            {/* Form */}
            <form onSubmit={handleSave}>
              <div className="px-6 py-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
                {!editingLead && (
                  <div className="col-span-full border-b border-[var(--border)] pb-4 mb-2">
                    <label className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider mb-2 block">
                      Smart Lookup (Hydrate from Contacts & Accounts)
                    </label>
                    <SmartLookup onSelect={handleLookupSelect} />
                  </div>
                )}
                <Field label="First name" required>
                  <input
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    placeholder="Jane"
                    autoFocus
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    placeholder="Cooper"
                  />
                </Field>
                <Field label="Company">
                  <input
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={company}
                    onChange={(e) => setCompany(e.target.value)}
                    placeholder="Acme Inc."
                  />
                </Field>
                <Field label="Title">
                  <input
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    placeholder="VP of Sales"
                  />
                </Field>
                <Field label="Email">
                  <input
                    type="email"
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="jane@acme.io"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+1 (555) 555-0100"
                  />
                </Field>
                <Field label="Lead source">
                  <select
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                  >
                    {SOURCES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
                <Field label="Status">
                  <select
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    value={status}
                    onChange={(e) => setStatus(e.target.value as Lead['status'])}
                  >
                    {STATUSES.map((s) => <option key={s}>{s}</option>)}
                  </select>
                </Field>
              </div>
              <div className="flex items-center justify-end gap-2 px-6 py-3 border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] rounded-md px-3 text-xs h-9 cursor-pointer transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submitting || !firstName.trim() || !lastName.trim()}
                  className="inline-flex items-center justify-center bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 cursor-pointer transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {submitting ? 'Saving…' : (editingLead ? 'Save Changes' : 'Create Lead')}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Right-Side Sliding Drawer */}
      <div className={`fixed inset-0 z-50 flex justify-end transition-opacity duration-300 ${drawerOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
        <div className="absolute inset-0 bg-black/40 backdrop-blur-xs transition-opacity duration-300" onClick={() => { setDrawerOpen(false); setTimeout(() => setActiveDetailId(null), 300); }} />
        <div className={`relative w-full max-w-2xl h-full bg-[var(--card)] shadow-2xl border-l border-[var(--border)] flex flex-col transition-transform duration-300 ease-out transform ${drawerOpen ? 'translate-x-0' : 'translate-x-full'}`}>
          <button 
            onClick={() => { setDrawerOpen(false); setTimeout(() => setActiveDetailId(null), 300); }} 
            className="absolute top-4 right-4 text-[var(--muted-foreground)] hover:text-[var(--foreground)] z-10 p-1.5 hover:bg-[var(--accent)] rounded-[2px] transition-colors cursor-pointer"
            title="Close details"
          >
            <X className="size-5" />
          </button>
          <div className="flex-1 overflow-hidden">
            {activeDetailId && (
              <CRMRecordDetail 
                type="lead" 
                id={activeDetailId} 
                onClose={() => { setDrawerOpen(false); setTimeout(() => setActiveDetailId(null), 300); fetchLeads(); }} 
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Field({ label, required, className, children }: {
  label: string; required?: boolean; className?: string; children: React.ReactNode;
}) {
  return (
    <div className={className}>
      <label className="text-xs font-medium text-[var(--muted-foreground)] mb-1.5 block">
        {label} {required && <span className="text-[var(--destructive)]">*</span>}
      </label>
      {children}
    </div>
  );
}
