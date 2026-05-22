import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Plus, X, Filter, SlidersHorizontal, ArrowUpRight, Edit, Trash2, AlertCircle, Search } from 'lucide-react';
import { getCompanies, createCompany, updateCompany, deleteCompany, Company, isCRMAdmin } from '../../services/crmService';
import CRMRecordDetail from './CRMRecordDetail';
import { User } from '../../services/types';

export default function CRMAccounts({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [accounts, setAccounts] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<Company | null>(null);
  const [showFilters, setShowFilters] = useState(true);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  // Sliding Drawer states
  const [activeDetailId, setActiveDetailId] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);


  // Form fields
  const [name, setName] = useState('');
  const [industry, setIndustry] = useState('');
  const [website, setWebsite] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  // Filters
  const [filterIndustry, setFilterIndustry] = useState<string>('All');
  const [filterCreatedBy, setFilterCreatedBy] = useState<string>('All');
  const [query, setQuery] = useState('');

  const isAdmin = isCRMAdmin(user);

  useEffect(() => {
    fetchAccounts();

    // Check if '?add=true' is in the URL to automatically open creation modal
    const params = new URLSearchParams(location.search);
    if (params.get('add') === 'true') {
      openCreateModal();
      navigate('/crm/accounts', { replace: true });
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


  async function fetchAccounts() {
    setLoading(true);
    const data = await getCompanies(user);
    setAccounts(data);
    setLoading(false);
  }

  const openCreateModal = () => {
    setEditingAccount(null);
    setName('');
    setIndustry('');
    setWebsite('');
    setSaveError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (account: Company) => {
    setEditingAccount(account);
    setName(account.name || '');
    setIndustry(account.industry || '');
    setWebsite(account.website || '');
    setSaveError(null);
    setIsModalOpen(true);
  };

  const handleSaveAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setSaveError('Account Name is required.');
      return;
    }

    setSaveError(null);
    const payload = {
      name: name.trim(),
      industry: industry.trim() || undefined,
      website: website.trim() || undefined,
      ...(!editingAccount ? { created_by: (user.email || user.username || '').toLowerCase() } : {}),
    };

    if (editingAccount) {
      const ok = await updateCompany(editingAccount.id, payload);
      if (ok) {
        setIsModalOpen(false);
        fetchAccounts();
      } else {
        setSaveError('Failed to update account. Check permissions.');
      }
    } else {
      const { data: newAccount, error } = await createCompany(payload);
      if (error) {
        setSaveError(error.message || 'Failed to create account.');
      } else if (newAccount) {
        setIsModalOpen(false);
        fetchAccounts();
      }
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this account?')) return;
    const ok = await deleteCompany(id);
    if (ok) {
      setAccounts((prev) => prev.filter((a) => a.id !== id));
      setSelected((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
    } else {
      alert('Failed to delete account. It may have associated contacts or deals.');
    }
  };

  const handleBulkDelete = async () => {
    if (!window.confirm(`Are you sure you want to delete ${selected.size} selected accounts?`)) return;
    const ids = Array.from(selected);
    const results = await Promise.all(ids.map((id) => deleteCompany(id as string)));
    const successfulIds = ids.filter((_, idx) => results[idx]);

    setAccounts((prev) => prev.filter((a) => !successfulIds.includes(a.id)));
    setSelected((prev) => {
      const n = new Set(prev);
      successfulIds.forEach((id) => n.delete(id));
      return n;
    });

    if (successfulIds.length < ids.length) {
      alert('Some accounts could not be deleted because they are referenced elsewhere.');
    }
  };

  const filteredAccounts = accounts.filter(a => {
    if (filterIndustry !== 'All' && a.industry !== filterIndustry) return false;
    if (filterCreatedBy !== 'All' && a.created_by !== filterCreatedBy) return false;
    if (query.trim() !== '') {
      const matchQ = a.name.toLowerCase().includes(query.toLowerCase()) ||
        (a.industry || '').toLowerCase().includes(query.toLowerCase()) ||
        (a.website || '').toLowerCase().includes(query.toLowerCase());
      if (!matchQ) return false;
    }
    return true;
  });

  // Extract unique industries for filter dropdown
  const industries = Array.from(new Set(accounts.map(a => a.industry).filter(Boolean)));
  const creators = Array.from(new Set(accounts.map(a => a.created_by).filter(Boolean))) as string[];

  const allChecked = selected.size === filteredAccounts.length && filteredAccounts.length > 0;
  const toggleAll  = () => setSelected(allChecked ? new Set() : new Set(filteredAccounts.map((a) => a.id)));
  const toggle     = (id: string) => setSelected((prev) => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n;
  });

  return (
    <div className="flex h-full space-x-5 max-w-[1600px] mx-auto select-none">
      {/* List content */}
      <div className="flex-1 flex flex-col space-y-5 overflow-hidden">
        {/* Header Action Bar */}
        <div className="flex justify-between items-end flex-wrap gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Accounts</h1>
            <p className="text-sm text-[var(--muted-foreground)] mt-1">Manage client organizations and business units.</p>
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
              Create Account
            </button>
          </div>
        </div>

        {/* Data Table */}
        <div className="flex-1 bg-[var(--card)] border border-[var(--border)] rounded-lg shadow-sm overflow-hidden flex flex-col">
          {/* Search Bar */}
          <div className="p-4 border-b border-[var(--border)] bg-[var(--card)] flex items-center justify-between">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-[var(--muted-foreground)]" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search accounts..."
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
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Account Name</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Industry</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Website</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Created By</th>
                  <th className="px-6 py-3 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]">Created At</th>
                  <th className="px-6 py-3 w-32 sticky top-0 bg-[color-mix(in_oklab,var(--secondary)_30%,var(--card))] z-10 border-b border-[var(--border)]"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {loading ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-[var(--muted-foreground)]">Loading accounts...</td></tr>
                ) : filteredAccounts.length === 0 ? (
                  <tr><td colSpan={7} className="px-6 py-12 text-center text-[var(--muted-foreground)]">No accounts match the filters.</td></tr>
                ) : (
                  filteredAccounts.map((account) => {
                    const isSelected = selected.has(account.id);
                    return (
                      <tr key={account.id} className={`hover:bg-[color-mix(in_oklab,var(--secondary)_40%,transparent)] transition-colors group ${isSelected ? 'bg-[color-mix(in_oklab,var(--accent)_40%,transparent)]' : ''}`}>
                        <td className="pl-4 py-3">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggle(account.id)}
                            aria-label={`Select ${account.name}`}
                            className="cursor-pointer"
                            style={{ accentColor: 'var(--primary)' }}
                          />
                        </td>
                        <td className="px-6 py-3 font-medium text-[var(--foreground)]">
                          {account.name}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">{account.industry || '—'}</td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {account.website ? (
                            <a
                              href={account.website.startsWith('http') ? account.website : `https://${account.website}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-[var(--primary)] hover:underline"
                            >
                              {account.website}
                            </a>
                          ) : '—'}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {account.created_by || '—'}
                        </td>
                        <td className="px-6 py-3 text-[var(--muted-foreground)]">
                          {account.created_at ? new Date(account.created_at).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-6 py-3 text-center">
                          <div className="flex items-center gap-1 justify-end opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.preventDefault();
                                setActiveDetailId(account.id);
                                setDrawerOpen(true);
                              }}
                              className="inline-flex items-center gap-1 font-semibold text-xs text-[var(--primary)] hover:underline mr-2 cursor-pointer font-sans"
                            >
                              Details
                              <ArrowUpRight className="w-3.5 h-3.5" />
                            </button>

                            <button
                              onClick={() => openEditModal(account)}
                              className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                              title="Edit"
                            >
                              <Edit className="size-3.5" />
                            </button>
                            <button
                              onClick={() => handleDelete(account.id)}
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
            <span>Showing {filteredAccounts.length} accounts</span>
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
              <label className="block text-xs font-semibold text-[var(--muted-foreground)] uppercase mb-2">Industry</label>
              <select
                value={filterIndustry}
                onChange={(e) => setFilterIndustry(e.target.value)}
                className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
              >
                <option value="All">All Industries</option>
                {industries.map(ind => (
                  <option key={ind} value={ind}>{ind}</option>
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

      {/* Create / Edit Account Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-[var(--card)] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-[var(--border)]" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {editingAccount ? 'Edit Account' : 'Create New Account'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {editingAccount ? 'Modify organization details.' : 'Add a new client organization or business unit.'}
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

            <form onSubmit={handleSaveAccount} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Account Name *</label>
                <input
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="e.g. Acme Corp"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Industry</label>
                <input
                  type="text"
                  value={industry}
                  onChange={(e) => setIndustry(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="e.g. Technology, Finance, Health"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Website</label>
                <input
                  type="text"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="e.g. www.acme.com"
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
                  {editingAccount ? 'Save Changes' : 'Create Account'}
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
                type="account" 
                id={activeDetailId} 
                onClose={() => { setDrawerOpen(false); setTimeout(() => setActiveDetailId(null), 300); fetchAccounts(); }} 
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
