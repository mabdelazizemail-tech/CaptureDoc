import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate, Link } from 'react-router-dom';
import { Plus, X, ArrowUpRight, Edit, Trash2, AlertCircle } from 'lucide-react';
import {
  getDeals, updateDealStage, updateDeal, deleteDeal, Deal,
  getCompanies, getContacts, Company, Contact, createDeal, isCRMAdmin
} from '../../services/crmService';
import { User } from '../../services/types';

const STAGES: Deal['stage'][] = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];

export default function CRMDeals({ user }: { user: User }) {
  const location = useLocation();
  const navigate = useNavigate();

  const [deals, setDeals] = useState<Deal[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);
  const [filterCreatedBy, setFilterCreatedBy] = useState('All');
  const [activeMobileStage, setActiveMobileStage] = useState<Deal['stage']>('Lead');

  const isAdmin = isCRMAdmin(user);

  // Modal states
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [dealName, setDealName] = useState('');
  const [dealValue, setDealValue] = useState('');
  const [dealCurrency, setDealCurrency] = useState<'USD' | 'EGP'>('USD');
  const [dealStage, setDealStage] = useState<Deal['stage']>('Lead');
  const [companyId, setCompanyId] = useState('');
  const [contactId, setContactId] = useState('');
  const [closeDate, setCloseDate] = useState('');
  const [lobValue, setLobValue] = useState('');
  const [lobOther, setLobOther] = useState('');
  const [channelType, setChannelType] = useState<'Direct' | 'Indirect'>('Direct');
  const [channelName, setChannelName] = useState('');
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    fetchData();

    // Check if '?add=true' is in the URL to automatically open creation modal
    const params = new URLSearchParams(location.search);
    if (params.get('add') === 'true') {
      openCreateModal();
      navigate('/crm/deals', { replace: true });
    }
  }, [location]);

  async function fetchData() {
    setLoading(true);
    const [dealsData, companiesData, contactsData] = await Promise.all([
      getDeals(user),
      getCompanies(user),
      getContacts(user)
    ]);
    setDeals(dealsData);
    setCompanies(companiesData);
    setContacts(contactsData);
    setLoading(false);
  }

  async function fetchDealsOnly() {
    const data = await getDeals(user);
    setDeals(data);
  }

  const openCreateModal = () => {
    setEditingDeal(null);
    setDealName('');
    setDealValue('');
    setDealCurrency('USD');
    setDealStage('Lead');
    setCompanyId('');
    setContactId('');
    setCloseDate('');
    setLobValue('');
    setLobOther('');
    setChannelType('Direct');
    setChannelName('');
    setSaveError(null);
    setIsModalOpen(true);
  };

  const openEditModal = (deal: Deal) => {
    setEditingDeal(deal);
    setDealName(deal.name || '');
    setDealValue(deal.value?.toString() || '');
    setDealCurrency(deal.currency || 'USD');
    setDealStage(deal.stage || 'Lead');
    setCompanyId(deal.company_id || '');
    setContactId(deal.contact_id || '');
    setCloseDate(deal.close_date || '');
    setChannelType(deal.channel_type || 'Direct');
    setChannelName(deal.channel_name || '');
    const knownLobs = ['Software', 'Hardware', 'Digitization Services', 'Managed Print Service'];
    const savedLob = deal.line_of_business || '';
    if (knownLobs.includes(savedLob)) {
      setLobValue(savedLob);
      setLobOther('');
    } else if (savedLob) {
      setLobValue('Others');
      setLobOther(savedLob);
    } else {
      setLobValue('');
      setLobOther('');
    }
    setSaveError(null);
    setIsModalOpen(true);
  };

  const INDIRECT_CHANNELS = ['Xerox', 'Ricoh', 'Canon', 'Konica Minolta', 'HP', 'Epson', 'Brother', 'Kyocera', 'Sharp', 'Toshiba'];

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedDealId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, newStage: Deal['stage']) => {
    e.preventDefault();
    if (!draggedDealId) return;

    setDeals(deals.map(d => d.id === draggedDealId ? { ...d, stage: newStage } : d));

    const success = await updateDealStage(draggedDealId, newStage);
    if (!success) {
      fetchDealsOnly();
    }
    setDraggedDealId(null);
  };

  const handleSaveDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dealName.trim() || !dealValue.trim()) {
      setSaveError('Deal Name and Value are required.');
      return;
    }

    const numericValue = Number(dealValue);
    if (isNaN(numericValue) || numericValue < 0) {
      setSaveError('Value must be a valid positive number.');
      return;
    }

    setSaveError(null);
    const payload = {
      name: dealName.trim(),
      value: numericValue,
      currency: dealCurrency,
      stage: dealStage,
      company_id: companyId || undefined,
      contact_id: contactId || undefined,
      close_date: closeDate || undefined,
      line_of_business: lobValue === 'Others'
        ? (lobOther.trim() || undefined)
        : (lobValue || undefined),
      channel_type: channelType,
      channel_name: channelType === 'Indirect' ? (channelName || undefined) : undefined,
      ...(!editingDeal ? { created_by: (user.email || user.username || '').toLowerCase() } : {}),
    };

    if (editingDeal) {
      const ok = await updateDeal(editingDeal.id, payload);
      if (ok) {
        setIsModalOpen(false);
        fetchDealsOnly();
      } else {
        setSaveError('Failed to update deal. Check Supabase RLS policies.');
      }
    } else {
      const { error } = await createDeal(payload);
      if (error) {
        setSaveError(error.message || 'Failed to create deal.');
      } else {
        setIsModalOpen(false);
        fetchDealsOnly();
      }
    }
  };

  const handleDeleteDeal = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this deal?')) return;
    const ok = await deleteDeal(id);
    if (ok) {
      setDeals(prev => prev.filter(d => d.id !== id));
    } else {
      alert('Failed to delete deal.');
    }
  };

  if (loading) {
    return <div className="p-8 text-center text-[var(--muted-foreground)] text-sm">Loading pipeline...</div>;
  }

  return (
    <div className="flex flex-col h-full space-y-5 max-w-[1600px] mx-auto select-none">
      {/* Header */}
      <div className="flex justify-between items-end flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Deals & Pipeline</h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1">
            Drag and drop deals between stages to update status.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {isAdmin && (
            <select
              value={filterCreatedBy}
              onChange={(e) => setFilterCreatedBy(e.target.value)}
              className="h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-xs text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)] font-medium"
            >
              <option value="All">All Users</option>
              {(Array.from(new Set(deals.map(d => d.created_by).filter(Boolean))) as string[]).map(c => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          )}
          <button
            onClick={openCreateModal}
            className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-3 text-xs h-9 gap-1.5 font-medium"
          >
            <Plus className="size-4" />
            Create Deal
          </button>
        </div>
      </div>

      {/* Mobile Horizontal Stage Bar */}
      <div className="lg:hidden flex gap-2 overflow-x-auto pb-2 scrollbar-none border-b border-[var(--border)]">
        {STAGES.map((stage) => {
          const stageDeals = deals.filter(d => d.stage === stage && (filterCreatedBy === 'All' || d.created_by === filterCreatedBy));
          const totalVal = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);
          const isActive = activeMobileStage === stage;

          return (
            <button
              key={stage}
              onClick={() => setActiveMobileStage(stage)}
              className={`flex-1 min-w-[130px] p-2.5 rounded-lg border text-left transition-colors cursor-pointer shrink-0 ${
                isActive
                  ? 'bg-[var(--primary)] text-white border-[var(--primary)] shadow-sm'
                  : 'bg-[var(--card)] text-[var(--foreground)] border-[var(--border)] hover:bg-[var(--secondary)]'
              }`}
            >
              <div className="flex justify-between items-center">
                <span className="font-semibold text-xs uppercase tracking-wide truncate">{stage}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold ${
                  isActive ? 'bg-white/20 text-white' : 'bg-[var(--accent)] text-[var(--accent-foreground)]'
                }`}>
                  {stageDeals.length}
                </span>
              </div>
              <div className={`text-[10px] mt-1 font-mono ${
                isActive ? 'text-white/80' : 'text-[var(--muted-foreground)]'
              }`}>
                {totalVal.toLocaleString()} EGP/USD
              </div>
            </button>
          );
        })}
      </div>

      {/* Mobile Stage Content View */}
      <div className="lg:hidden flex-grow space-y-3 overflow-y-auto min-h-[300px]">
        {(() => {
          const stageDeals = deals.filter(d => d.stage === activeMobileStage && (filterCreatedBy === 'All' || d.created_by === filterCreatedBy));
          if (stageDeals.length === 0) {
            return (
              <div className="h-40 border-2 border-dashed border-[var(--border)] rounded-lg flex items-center justify-center text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider bg-[var(--card)]">
                No deals in {activeMobileStage}
              </div>
            );
          }
          return stageDeals.map(deal => (
            <div
              key={deal.id}
              className="bg-[var(--card)] p-4 rounded-lg border border-[var(--border)] shadow-sm hover:border-[var(--primary)] transition-colors relative"
            >
              <div className="flex justify-between items-start gap-2">
                <h4 className="text-sm font-semibold text-[var(--foreground)] leading-snug">{deal.name}</h4>
                <Link
                  to={`/crm/detail/deal/${deal.id}`}
                  className="text-[var(--primary)] hover:underline flex-shrink-0"
                  title="View Details"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </div>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">{deal.company?.name || 'No Associated Account'}</p>
              
              <div className="mt-2.5 flex flex-wrap gap-1.5 items-center">
                {deal.line_of_business && (
                  <span className="inline-block text-[9px] font-bold px-1.5 py-0.5 rounded bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-[var(--primary)] uppercase tracking-wide">
                    {deal.line_of_business}
                  </span>
                )}
                {deal.channel_type && (
                  <span className={`inline-block text-[9px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                    deal.channel_type === 'Direct'
                      ? 'bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]'
                      : 'bg-[color-mix(in_oklab,var(--warning,#f59e0b)_12%,transparent)] text-[var(--warning,#f59e0b)]'
                  }`}>
                    {deal.channel_type}{deal.channel_type === 'Indirect' && deal.channel_name ? ` · ${deal.channel_name}` : ''}
                  </span>
                )}
              </div>

              <div className="mt-3.5 flex items-center justify-between border-t border-[var(--border)] pt-2.5">
                <div className="font-bold text-sm font-mono text-[var(--foreground)]">
                  {deal.currency === 'USD' ? '$' : 'EGP '}{Number(deal.value || 0).toLocaleString()}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => openEditModal(deal)}
                    className="p-1.5 rounded-md border border-[var(--border)] text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)] transition-colors cursor-pointer"
                    title="Edit"
                  >
                    <Edit className="size-3.5" />
                  </button>
                  <button
                    onClick={() => handleDeleteDeal(deal.id)}
                    className="p-1.5 rounded-md border border-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] hover:text-[var(--destructive)] transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ));
        })()}
      </div>

      {/* Desktop Kanban Board */}
      <div className="hidden lg:grid flex-1 grid-cols-5 gap-4 pb-4 items-stretch">
        {STAGES.map((stage) => {
          const stageDeals = deals.filter(d => d.stage === stage && (filterCreatedBy === 'All' || d.created_by === filterCreatedBy));
          const totalVal = stageDeals.reduce((sum, d) => sum + (d.value || 0), 0);

          return (
            <div
              key={stage}
              className="bg-[var(--card)] border border-[var(--border)] rounded-lg flex flex-col overflow-hidden shadow-sm min-w-0"
              onDragOver={handleDragOver}
              onDrop={(e) => handleDrop(e, stage)}
            >
              {/* Header */}
              <div className="flex justify-between items-center py-2.5 px-3 border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)] shrink-0">
                <div>
                  <h3 className="font-semibold text-xs text-[var(--foreground)] uppercase tracking-wide">{stage}</h3>
                  <span className="text-[10px] text-[var(--muted-foreground)] mt-0.5 block font-mono">
                    Total: {totalVal.toLocaleString()} EGP/USD
                  </span>
                </div>
                <span className="text-[11px] bg-[var(--accent)] text-[var(--accent-foreground)] px-2 py-0.5 rounded-full font-bold">
                  {stageDeals.length}
                </span>
              </div>

              {/* Scrollable Container */}
              <div className="flex-1 p-3 space-y-3 overflow-y-auto min-h-[400px]">
                {stageDeals.map(deal => (
                  <div
                    key={deal.id}
                    draggable
                    onDragStart={(e) => handleDragStart(e, deal.id)}
                    className="bg-[var(--card)] p-4 rounded-lg border border-[var(--border)] shadow-sm hover:border-[var(--primary)] transition-colors cursor-grab active:cursor-grabbing relative group"
                  >
                    <div className="flex justify-between items-start gap-2">
                      <h4 className="text-sm font-medium text-[var(--foreground)] line-clamp-2 leading-snug">{deal.name}</h4>
                      <Link
                        to={`/crm/detail/deal/${deal.id}`}
                        className="text-[var(--primary)] hover:underline opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                        title="View Details"
                      >
                        <ArrowUpRight className="size-4" />
                      </Link>
                    </div>
                    <p className="text-[11px] text-[var(--muted-foreground)] mt-1">{deal.company?.name || 'No Associated Account'}</p>
                    {deal.line_of_business && (
                      <span className="inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[color-mix(in_oklab,var(--primary)_12%,transparent)] text-[var(--primary)] uppercase tracking-wide">
                        {deal.line_of_business}
                      </span>
                    )}
                    {deal.created_by && (
                      <p className="text-[10px] text-[var(--muted-foreground)] mt-1.5 flex items-center gap-1">
                        <span className="opacity-60">by</span> {deal.created_by}
                      </p>
                    )}
                    {deal.channel_type && (
                      <span className={`inline-block mt-1.5 text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide ${
                        deal.channel_type === 'Direct'
                          ? 'bg-[color-mix(in_oklab,var(--success)_12%,transparent)] text-[var(--success)]'
                          : 'bg-[color-mix(in_oklab,var(--warning,#f59e0b)_12%,transparent)] text-[var(--warning,#f59e0b)]'
                      }`}>
                        {deal.channel_type}{deal.channel_type === 'Indirect' && deal.channel_name ? ` · ${deal.channel_name}` : ''}
                      </span>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <div className="font-semibold text-sm font-mono text-[var(--foreground)]">
                        {deal.currency === 'USD' ? '$' : 'EGP '}{Number(deal.value || 0).toLocaleString()}
                      </div>
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => openEditModal(deal)}
                          className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[var(--secondary)] hover:text-[var(--foreground)]"
                          title="Edit"
                        >
                          <Edit className="size-3.5" />
                        </button>
                        <button
                          onClick={() => handleDeleteDeal(deal.id)}
                          className="p-1 rounded text-[var(--muted-foreground)] hover:bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] hover:text-[var(--destructive)]"
                          title="Delete"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
                {stageDeals.length === 0 && (
                  <div className="h-28 border-2 border-dashed border-[var(--border)] rounded-lg flex items-center justify-center text-xs text-[var(--muted-foreground)] font-medium uppercase tracking-wider">
                    Drop deals here
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add / Edit Deal Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setIsModalOpen(false)}>
          <div className="bg-[var(--card)] rounded-xl shadow-2xl max-w-lg w-full overflow-hidden border border-[var(--border)] max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-6 py-4 border-b border-[var(--border)] flex justify-between items-center">
              <div>
                <h3 className="text-base font-semibold text-[var(--foreground)]">
                  {editingDeal ? 'Edit Deal' : 'Create New Deal'}
                </h3>
                <p className="text-xs text-[var(--muted-foreground)] mt-0.5">
                  {editingDeal ? 'Modify pipeline deal details.' : 'Add a new revenue opportunity to the pipeline.'}
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

            <form onSubmit={handleSaveDeal} className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Deal Name *</label>
                <input
                  type="text"
                  required
                  value={dealName}
                  onChange={(e) => setDealName(e.target.value)}
                  className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  placeholder="e.g. 50 Web Licenses Package"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Value *</label>
                  <input
                    type="number"
                    required
                    min="0"
                    step="0.01"
                    value={dealValue}
                    onChange={(e) => setDealValue(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    placeholder="e.g. 15000"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Currency</label>
                  <select
                    value={dealCurrency}
                    onChange={(e) => setDealCurrency(e.target.value as 'USD' | 'EGP')}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EGP">EGP (EGP)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Stage</label>
                  <select
                    value={dealStage}
                    onChange={(e) => setDealStage(e.target.value as Deal['stage'])}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    {STAGES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Expected Close Date</label>
                  <input
                    type="date"
                    value={closeDate}
                    onChange={(e) => setCloseDate(e.target.value)}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  />
                </div>
              </div>

              {/* Line of Business */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Line of Business</label>
                <div className="flex flex-wrap gap-2">
                  {(['Software', 'Hardware', 'Digitization Services', 'Managed Print Service', 'Others'] as const).map(lob => (
                    <button
                      key={lob}
                      type="button"
                      onClick={() => { setLobValue(lob); if (lob !== 'Others') setLobOther(''); }}
                      className={`px-3 py-1.5 rounded-md text-xs font-medium border transition-colors cursor-pointer ${
                        lobValue === lob
                          ? 'bg-[var(--primary)] text-white border-[var(--primary)]'
                          : 'border-[var(--border)] text-[var(--muted-foreground)] hover:border-[var(--primary)] hover:text-[var(--primary)] bg-transparent'
                      }`}
                    >
                      {lob}
                    </button>
                  ))}
                  {lobValue && (
                    <button
                      type="button"
                      onClick={() => { setLobValue(''); setLobOther(''); }}
                      className="px-2 py-1.5 rounded-md text-xs border border-dashed border-[var(--border)] text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:border-[var(--destructive)] transition-colors cursor-pointer"
                      title="Clear selection"
                    >
                      <X className="size-3" />
                    </button>
                  )}
                </div>
                {lobValue === 'Others' && (
                  <input
                    type="text"
                    value={lobOther}
                    onChange={e => setLobOther(e.target.value)}
                    placeholder="Describe the line of business..."
                    className="mt-2 w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                    autoFocus
                  />
                )}
              </div>

              {/* Channel Type */}
              <div>
                <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Channel Type</label>
                <div className="flex items-center gap-3">
                  {(['Direct', 'Indirect'] as const).map(ct => (
                    <label key={ct} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="channelType"
                        value={ct}
                        checked={channelType === ct}
                        onChange={() => { setChannelType(ct); if (ct === 'Direct') setChannelName(''); }}
                        className="cursor-pointer"
                        style={{ accentColor: 'var(--primary)' }}
                      />
                      <span className={`text-sm font-medium ${
                        channelType === ct ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]'
                      }`}>{ct}</span>
                    </label>
                  ))}
                </div>
                {channelType === 'Indirect' && (
                  <select
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    className="mt-2 w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">Select Channel Partner...</option>
                    {INDIRECT_CHANNELS.map(ch => (
                      <option key={ch} value={ch}>{ch}</option>
                    ))}
                  </select>
                )}
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Account (Company)</label>
                  <select
                    value={companyId}
                    onChange={(e) => {
                      const newCompanyId = e.target.value;
                      setCompanyId(newCompanyId);
                      if (newCompanyId && contactId) {
                        const selectedContact = contacts.find(c => c.id === contactId);
                        if (selectedContact && selectedContact.company_id !== newCompanyId) {
                          setContactId('');
                        }
                      }
                    }}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">Select Account...</option>
                    {companies.map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--muted-foreground)] mb-1.5">Primary Contact</label>
                  <select
                    value={contactId}
                    onChange={(e) => {
                      const newContactId = e.target.value;
                      setContactId(newContactId);
                      if (newContactId && !companyId) {
                        const selectedContact = contacts.find(c => c.id === newContactId);
                        if (selectedContact && selectedContact.company_id) {
                          setCompanyId(selectedContact.company_id);
                        }
                      }
                    }}
                    className="w-full h-9 px-3 border border-[var(--border)] rounded-md bg-[var(--card)] text-sm text-[var(--foreground)] focus:outline-none focus:ring-1 focus:ring-[var(--ring)]"
                  >
                    <option value="">Select Contact...</option>
                    {contacts
                      .filter(c => !companyId || c.company_id === companyId)
                      .map(c => (
                        <option key={c.id} value={c.id}>{c.first_name} {c.last_name}</option>
                      ))}
                  </select>
                </div>
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
                  {editingDeal ? 'Save Changes' : 'Create Deal'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
