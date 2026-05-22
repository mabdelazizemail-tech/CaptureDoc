import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Plus, X, Filter, SlidersHorizontal, ArrowUpRight, Edit, Trash2, AlertCircle, Search } from 'lucide-react';
import {
  getContacts, Contact, getCompanies, createCompany, createContact,
  updateContact, deleteContact, Company, isCRMAdmin
} from '../../services/crmService';
import CRMRecordDetail from './CRMRecordDetail';
import { User } from '../../services/types';

export default function CRMContacts({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [showFilters, setShowFilters] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sliding Drawer states
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingContact, setEditingContact] = useState<Contact | null>(null);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [title, setTitle] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');
  const [companyId, setCompanyId] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Quick Add Company state
  const [isAddingCompany, setIsAddingCompany] = useState(false);
  const [newCompanyName, setNewCompanyName] = useState('');

  // Filters
  const [filterCompany, setFilterCompany] = useState<string>('All');
  const [filterCreatedBy, setFilterCreatedBy] = useState<string>('All');
  const [query, setQuery] = useState('');

  const isAdmin = isCRMAdmin(user);

  useEffect(() => {
    fetchData();

    // Check if '?add=true' is in the URL to automatically open creation modal
    const params = new URLSearchParams(location.search);
    if (params.get('add') === 'true') {
      openCreateModal();
      navigate('/crm/contacts', { replace: true });
    }
  }, [location]);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isModalOpen) {
          setIsModalOpen(false);
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
  }, [isModalOpen, drawerOpen]);


  async function fetchData() {
    setLoading(true);
    const [contactsData, companiesData] = await Promise.all([
      getContacts(user),
      getCompanies(user)
    ]);
    setContacts(contactsData);
    setCompanies(companiesData);
    setLoading(false);
  }

  const openCreateModal = () => {
    setEditingContact(null);
    setFirstName('');
    setLastName('');
    setTitle('');
    setEmail('');
    setPhone('');
    setCompanyId('');
    setNotes('');
    setSaveError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (contact: Contact) => {
    setEditingContact(contact);
    setFirstName(contact.first_name || '');
    setLastName(contact.last_name || '');
    setTitle(contact.title || '');
    setEmail(contact.email || '');
    setPhone(contact.phone || '');
    setCompanyId(contact.company_id || '');
    setNotes(contact.notes || '');
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleAddCompany = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCompanyName.trim()) return;

    setSaveError(null);
    const { data: company, error } = await createCompany({ name: newCompanyName.trim(), created_by: (user.email || user.username || '').toLowerCase() });
    if (error) {
      setSaveError(error.message || 'Failed to create company.');
      return;
    }

    if (company) {
      setCompanies([...companies, company]);
      setCompanyId(company.id);
      setNewCompanyName('');
      setIsAddingCompany(false);
    }
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) {
      setSaveError('First and Last names are required.');
      return;
    }

    setSaveError(null);
    const payload = {
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      title: title.trim() || undefined,
      email: email.trim() || undefined,
      phone: phone.trim() || undefined,
      company_id: companyId || undefined,
      notes: notes.trim() || undefined,
      ...(!editingContact ? { created_by: (user.email || user.username || '').toLowerCase() } : {}),
    };

    if (editingContact) {
      const ok = await updateContact(editingContact.id, payload);
      if (ok) {
        setIsModalOpen(false);
        fetchData();
      } else {
        setSaveError('Failed to update contact. Check Supabase constraints.');
      }
    } else {
      const { data: contact, error } = await createContact(payload);
      if (error) {
        setSaveError(error.message || 'Failed to create contact.');
      } else if (contact) {
        setIsModalOpen(false);
        fetchData();
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this contact?')) return;
    const ok = await deleteContact(id);
    if (ok) {
      setContacts((prev) => prev.filter((c) => c.id !== id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } else {
      alert('Failed to delete contact.');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selected.size} selected contacts?`)) return;
    const ids = Array.from(selected);
    const results = await Promise.all(ids.map((id) => deleteContact(id as string)));
    const successfulIds = ids.filter((_, idx) => results[idx]);

    setContacts((prev) => prev.filter((c) => !successfulIds.includes(c.id)));
    setSelected((prev) => {
      const n = new Set(prev);
      successfulIds.forEach((id) => n.delete(id));
      return n;
    });

    if (successfulIds.length < ids.length) {
      alert('Some contacts could not be deleted because they are referenced elsewhere.');
    }
  };

  const filteredContacts = contacts.filter(c => {
    if (filterCompany !== 'All' && c.company_id !== filterCompany) return false;
    if (filterCreatedBy !== 'All' && c.created_by !== filterCreatedBy) return false;
    if (query.trim() !== '') {
      const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
      const matchQ = fullName.includes(query.toLowerCase()) ||
        (c.email || '').toLowerCase().includes(query.toLowerCase()) ||
        (c.phone || '').toLowerCase().includes(query.toLowerCase());
      if (!matchQ) return false;
    }
    return true;
  });

  const creators = Array.from(new Set(contacts.map(c => c.created_by).filter(Boolean))) as string[];

  const allChecked = selected.size === filteredContacts.length && filteredContacts.length > 0;
  const toggleAll  = () => setSelected(allChecked ? new Set() : new Set(filteredContacts.map((c) => c.id)));
  const toggle     = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="flex h-full space-x-5 max-w-[1600px] mx-auto select-none">
      {/* List Content */}
      <div className="flex-1 flex flex-col space-y-5 overflow-hidden">
        {/* Header Action Bar */}
        <div className="flex justify-between items-end flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Contacts</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">View and manage contact relationships.</p>
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
              onClick={() => setShowFilters(!showFilters)}
              className={`inline-flex items-center justify-center cursor-pointer border rounded-md px-3 text-xs h-9 gap-1.5 font-medium transition-colors ${showFilters ? 'bg-[var(--accent)] border-[var(--primary)] text-[var(--primary)]' : 'border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)]'}`}
            >
              <Filter className="size-4" />
              Filters
            </button>
            <button
              onClick={openCreateModal}
              className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 gap-1.5 font-medium"
            >
              <Plus className="size-4" />
              Create Contact
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm overflow-hidden flex flex-col">
          {/* Search bar inside table container */}
          <div className="p-4 border-b border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search contacts..."
                className="w-full h-9 pl-9 pr-3 rounded-md border border-[var(--border)] bg-[var(--background)] text-sm placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              />
            </div>
          </div>

          <div className="overflow-auto flex-1">
            <table className="w-full text-left border-collapse min-w-[800px] text-sm">
              <thead>
                <tr className="border-b border-[var(--border)] font-semibold text-xs text-[var(--muted-foreground)] uppercase tracking-wider">
                  <th className="w-10 pl-4 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">
                    <input
                      type="checkbox"
                      checked={allChecked}
                      onChange={toggleAll}
                      aria-label="Select all"
                      className="rounded cursor-pointer"
                      style={{ accentColor: 'var(--primary)' }}
                    />
                  </th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Contact Name</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Account</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Email</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Phone</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Created By</th>
                  <th className="px-6 py-3 w-32 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-[var(--muted-foreground)]">Loading contacts...</td></tr>
                ) : filteredContacts.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-[var(--muted-foreground)]">No contacts match the filters.</td></tr>
                ) : (
                  filteredContacts.map((contact) => {
                    const isSelected = selected.has(contact.id);
                    return (
                      <tr key={contact.id} className={`hover:bg-[color-mix(in_oklab,var(--secondary)_40%,transparent)] transition-colors group ${isSelected ? 'bg-[color-mix(in_oklab,var(--accent)_40%,transparent)]' : ''}`}>
                        <td className="pl-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(contact.id)}
                            aria-label={`Select ${contact.first_name}`}
                            className="cursor-pointer"
                            style={{ accentColor: 'var(--primary)' }}
                          />
                        </td>
                        <td className="px-6 py-3">
                          <div className="font-medium text-[var(--foreground)]">
                            {contact.first_name} {contact.last_name}
                          </div>
                          {contact.title && (
                            <div className="text-xs text-[var(--muted-foreground)] font-normal mt-0.5">
                              {contact.title}
                            </div>
                          )}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {contact.company?.name || '—'}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {contact.email ? (
                            <a href={`mailto:${contact.email}`} className="hover:text-[var(--primary)] hover:underline">
                              {contact.email}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {contact.phone || '—'}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {contact.created_by || '—'}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setActiveDetailId(contact.id);
                                setDrawerOpen(true);
                              }}
                              className="inline-flex items-center gap-1 font-semibold text-xs text-[var(--primary)] hover:underline mr-2 cursor-pointer font-sans"
                            >
                              Details
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => openEditModal(contact)}
                              className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                              title="Edit"
                            >
                              <Edit className="size-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(contact.id)}
                              className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] hover:text-[var(--destructive)]"
                              title="Delete"
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <div className="px-6 py-3 border-t border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] flex justify-between items-center text-xs text-[var(--muted-foreground)]">
            <span>Showing {filteredContacts.length} contacts</span>
          </div>
        </div>
      </div>

      {/* Right collapsible filter panel */}
      {showFilters && (
        <div className="w-64 bg-[var(--card)] border border-[var(--border)] rounded-lg p-6 flex flex-col overflow-y-auto shadow-sm self-start">
          <div className="flex justify-between items-center pb-4 border-b border-[var(--border)] mb-4">
            <h3 className="text-sm font-semibold text-[var(--foreground)] uppercase tracking-wide flex items-center gap-2">
              <SlidersHorizontal className="w-4 h-4 text-[var(--muted-foreground)]" />
              Filter By
            </h3>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase mb-2">Account</label>
              <select
                value={filterCompany}
                onChange={(e) => setFilterCompany(e.target.value)}
                className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              >
                <option value="All">All Accounts</option>
                {companies.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            </div>
            {isAdmin && (
              <div>
                <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase mb-2">Created By</label>
                <select
                  value={filterCreatedBy}
                  onChange={(e) => setFilterCreatedBy(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                >
                  <option value="All">All Users</option>
                  {creators.map(c => (
                    <option key={c} value={c}>{c}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Create / Edit Contact Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-[var(--card)] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {editingContact ? 'Edit Contact' : 'Create New Contact'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {editingContact ? 'Modify the details of this contact.' : 'Add a new business contact to your database.'}
                </p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="text-[var(--muted-foreground)] hover:text-[var(--foreground)]">
                <X className="size-5" />
              </button>
            </div>

            {saveError && (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] px-3 py-2 text-xs text-[var(--destructive)]">
                <AlertCircle className="size-4 mt-0.5 shrink-0" />
                <span>{saveError}</span>
              </div>
            )}

            <form onSubmit={handleSaveContact} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">First Name *</label>
                  <input
                    type="text"
                    required
                    value={firstName}
                    onChange={(e) => setFirstName(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="e.g. John"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Last Name *</label>
                  <input
                    type="text"
                    required
                    value={lastName}
                    onChange={(e) => setLastName(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="e.g. Doe"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Account (Company)</label>
                <div className="flex gap-2">
                  <select
                    value={companyId}
                    onChange={(e) => setCompanyId(e.target.value)}
                    className="flex-1 h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">Select Account...</option>
                    {companies.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => setIsAddingCompany(!isAddingCompany)}
                    className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] rounded-md px-3 text-xs h-9 cursor-pointer transition-colors font-medium text-[var(--foreground)]"
                  >
                    {isAddingCompany ? 'Cancel' : 'New Account'}
                  </button>
                </div>
              </div>

              {isAddingCompany && (
                <div className="p-3 bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] rounded-lg border border-[var(--border)] flex gap-2 animate-in slide-in-from-top-2 duration-200">
                  <input
                    type="text"
                    value={newCompanyName}
                    onChange={(e) => setNewCompanyName(e.target.value)}
                    className="flex-1 h-8 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-xs text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="Account Name..."
                  />
                  <button
                    type="button"
                    onClick={handleAddCompany}
                    className="inline-flex items-center justify-center bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-8 cursor-pointer font-medium"
                  >
                    Add
                  </button>
                </div>
              )}

              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Job Title</label>
                <input
                  type="text"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="e.g. Product Manager"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="e.g. john@example.com"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Phone</label>
                  <input
                    type="text"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="e.g. +1 555-1234"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Notes</label>
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full p-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] h-20 resize-none"
                  placeholder="Additional notes..."
                />
              </div>

              <div className="pt-4 border-t border-[var(--border)] flex justify-end gap-2 bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)] -mx-6 -mb-6 p-4">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] rounded-md px-3 text-xs h-9 cursor-pointer transition-colors font-medium"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="inline-flex items-center justify-center bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 cursor-pointer transition-colors font-medium"
                >
                  {editingContact ? 'Save Changes' : 'Create Contact'}
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
                type="contact" 
                id={activeDetailId} 
                onClose={() => { setDrawerOpen(false); setTimeout(() => setActiveDetailId(null), 300); fetchData(); }} 
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

