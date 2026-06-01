import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { 
  ArrowLeft, 
  Building, 
  User, 
  FileText, 
  KanbanSquare, 
  Mail, 
  Phone, 
  Globe, 
  ChevronRight,
  Trash2,
  AlertCircle
} from 'lucide-react';
import { 
  getLeadDetail, 
  getContactDetail, 
  getAccountDetail, 
  getDealDetail, 
  getAccountContacts,
  getAccountDeals,
  getContactDeals,
  deleteLead,
  deleteContact,
  deleteCompany,
  deleteDeal,
  Lead, 
  Contact, 
  Company, 
  Deal 
} from '../../services/crmService';

type RecordType = 'lead' | 'contact' | 'account' | 'deal';

interface CRMRecordDetailProps {
  type?: RecordType;
  id?: string;
  onClose?: () => void;
}

export default function CRMRecordDetail({ type: propType, id: propId, onClose }: CRMRecordDetailProps = {}) {
  const params = useParams<{ type: RecordType; id: string }>();
  const type = propType || params.type;
  const id = propId || params.id;
  const isDrawerMode = !!propId;
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'overview' | 'details' | 'related'>('overview');

  // Record data states
  const [lead, setLead] = useState<Lead | null>(null);
  const [contact, setContact] = useState<Contact | null>(null);
  const [account, setAccount] = useState<Company | null>(null);
  const [deal, setDeal] = useState<Deal | null>(null);

  // Related lists
  const [relatedContacts, setRelatedContacts] = useState<Contact[]>([]);
  const [relatedDeals, setRelatedDeals] = useState<Deal[]>([]);

  // Deletion and modal states
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Validate record type to prevent blank screen render
  const validTypes = ['lead', 'contact', 'account', 'deal'];
  const isValidType = type && validTypes.includes(type);

  useEffect(() => {
    if (id && isValidType) {
      loadData();
    }
  }, [type, id]);

  async function loadData() {
    setLoading(true);
    try {
      if (type === 'lead') {
        const data = await getLeadDetail(id!);
        setLead(data);
      } else if (type === 'contact') {
        const data = await getContactDetail(id!);
        setContact(data);
        if (data) {
          const deals = await getContactDeals(data.id);
          setRelatedDeals(deals);
        }
      } else if (type === 'account') {
        const data = await getAccountDetail(id!);
        setAccount(data);
        if (data) {
          const [contacts, deals] = await Promise.all([
            getAccountContacts(data.id),
            getAccountDeals(data.id)
          ]);
          setRelatedContacts(contacts);
          setRelatedDeals(deals);
        }
      } else if (type === 'deal') {
        const data = await getDealDetail(id!);
        setDeal(data);
      }
    } catch (e) {
      console.error('Error loading detail view:', e);
    }
    setLoading(false);
  }

  const handleDelete = async () => {
    setDeleting(true);
    setDeleteError(null);
    try {
      let success = false;
      if (type === 'lead') {
        success = await deleteLead(id!);
      } else if (type === 'contact') {
        success = await deleteContact(id!);
      } else if (type === 'account') {
        success = await deleteCompany(id!);
      } else if (type === 'deal') {
        success = await deleteDeal(id!);
      }

      if (success) {
        setShowDeleteModal(false);
        if (isDrawerMode) {
          onClose?.();
        } else {
          const redirectPath = 
            type === 'lead' ? '/crm/leads' : 
            type === 'contact' ? '/crm/contacts' : 
            type === 'account' ? '/crm/accounts' : 
            '/crm/deals';
          navigate(redirectPath);
        }
      } else {
        setDeleteError(`Failed to delete the ${type}. The database rejected the request.`);
      }
    } catch (err: any) {
      setDeleteError(err.message || `An error occurred while deleting the ${type}.`);
    } finally {
      setDeleting(false);
    }
  };

  // ─── RENDERING FALLBACKS ───────────────────────────────────────────────────

  if (!isValidType) {
    return (
      <div className="p-8 text-center bg-[var(--background)] min-h-[50vh] flex flex-col items-center justify-center">
        <div className="size-12 rounded-full bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)] flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Invalid Record Type</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-sm">
          The record type "{type}" is not recognized by the CaptureCRM platform.
        </p>
        <Link 
          to="/crm" 
          className="inline-flex items-center justify-center bg-[var(--primary)] text-white hover:bg-[color-mix(in_oklab,var(--primary)_90%,transparent)] rounded-md px-4 py-2 text-sm font-semibold transition-colors shadow-sm cursor-pointer"
        >
          Return to Dashboard
        </Link>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-12 text-center text-[var(--muted-foreground)] text-sm bg-[var(--background)] min-h-[50vh] flex flex-col items-center justify-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-[var(--primary)] border-t-transparent animate-spin"></div>
        <span>Retrieving secure CRM record details...</span>
      </div>
    );
  }

  const recordExists = 
    (type === 'lead' && lead) || 
    (type === 'contact' && contact) || 
    (type === 'account' && account) || 
    (type === 'deal' && deal);

  if (!recordExists) {
    return (
      <div className="p-8 text-center bg-[var(--background)] min-h-[50vh] flex flex-col items-center justify-center">
        <div className="size-12 rounded-full bg-[color-mix(in_oklab,var(--destructive)_10%,transparent)] text-[var(--destructive)] flex items-center justify-center mb-4">
          <AlertCircle className="w-6 h-6" />
        </div>
        <h2 className="text-lg font-semibold text-[var(--foreground)] mb-2">Record Not Found</h2>
        <p className="text-sm text-[var(--muted-foreground)] mb-6 max-w-sm">
          The requested {type} record could not be found or has been removed from the platform.
        </p>
        <Link 
          to={type === 'lead' ? '/crm/leads' : type === 'contact' ? '/crm/contacts' : type === 'account' ? '/crm/accounts' : '/crm/deals'}
          className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] hover:bg-[var(--accent)] rounded-md px-4 py-2 text-sm font-semibold transition-colors shadow-sm cursor-pointer"
        >
          Back to List
        </Link>
      </div>
    );
  }

  // ─── METADATA EXTRACTORS ───────────────────────────────────────────────────

  let recordName = '';
  let recordSubtitle = '';
  let recordIcon = FileText;
  let statusBadge = null;

  if (type === 'lead' && lead) {
    recordName = `${lead.first_name} ${lead.last_name}`;
    recordSubtitle = lead.title || 'Lead Prospect';
    recordIcon = FileText;
    statusBadge = (
      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[color-mix(in_oklab,var(--primary)_10%,transparent)] text-[var(--primary)] border border-[color-mix(in_oklab,var(--primary)_25%,transparent)]">
        Status: {lead.status}
      </span>
    );
  } else if (type === 'contact' && contact) {
    recordName = `${contact.first_name} ${contact.last_name}`;
    recordSubtitle = contact.title 
      ? (contact.company?.name ? `${contact.title} at ${contact.company.name}` : contact.title)
      : (contact.company?.name ? `Contact at ${contact.company.name}` : 'Independent Contact');
    recordIcon = User;
  } else if (type === 'account' && account) {
    recordName = account.name;
    recordSubtitle = account.industry || 'Account / Client Organization';
    recordIcon = Building;
  } else if (type === 'deal' && deal) {
    recordName = deal.name;
    recordSubtitle = deal.company?.name ? `Deal with ${deal.company.name}` : 'Unassociated Deal';
    recordIcon = KanbanSquare;
    statusBadge = (
      <span className="inline-flex px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">
        Stage: {deal.stage}
      </span>
    );
  }

  const IconComponent = recordIcon;

  return (
    <div className="p-4 md:p-6 flex flex-col h-full bg-[var(--background)] text-[var(--foreground)] overflow-y-auto">
      {/* Breadcrumb / Actions Row */}
      <div className="flex items-center justify-between mb-6 flex-wrap gap-4 pr-10">
        {isDrawerMode ? (
          <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--muted-foreground)] font-sans">
            Quick View: {type} Record
          </h2>
        ) : (
          <div className="flex items-center gap-2 text-xs text-[var(--muted-foreground)] font-semibold uppercase tracking-wider">
            <Link 
              to={type === 'lead' ? '/crm/leads' : type === 'contact' ? '/crm/contacts' : type === 'account' ? '/crm/accounts' : '/crm/deals'}
              className="flex items-center gap-1 text-[var(--primary)] hover:underline"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to List</span>
            </Link>
            <ChevronRight className="w-3 h-3 text-[var(--muted-foreground)] opacity-40" />
            <span className="text-[var(--foreground)]">{type} Details</span>
          </div>
        )}

        {/* Action Header Button */}
        <button
          onClick={() => setShowDeleteModal(true)}
          className="inline-flex items-center justify-center cursor-pointer transition-colors bg-[var(--destructive)] text-white hover:bg-[color-mix(in_oklab,var(--destructive)_90%,transparent)] rounded-[2px] px-3.5 text-xs h-9 gap-1.5 font-medium shadow-sm border border-[color-mix(in_oklab,var(--destructive)_20%,transparent)]"
        >
          <Trash2 className="w-3.5 h-3.5" />
          <span>Delete Record</span>
        </button>
      </div>

      {/* Zoho Business Card Header (Glassmorphic) */}
      <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-sm p-4 md:p-6 mb-6 flex flex-col lg:flex-row justify-between items-start lg:items-center gap-6">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 bg-[color-mix(in_oklab,var(--secondary)_50%,transparent)] rounded-full flex items-center justify-center border border-[var(--border)] text-[var(--foreground)] flex-shrink-0 shadow-inner">
            <IconComponent className="w-5 h-5 text-[var(--muted-foreground)]" />
          </div>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-[var(--foreground)] leading-tight">{recordName}</h1>
              {statusBadge}
            </div>
            <p className="text-xs text-[var(--muted-foreground)] font-medium mt-1">{recordSubtitle}</p>
          </div>
        </div>

        {/* Top Header high-value KPI metrics cards */}
        <div className="flex gap-4 flex-wrap w-full lg:w-auto">
          {type === 'lead' && lead && lead.value !== undefined && (
            <div className="bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-center min-w-[110px] flex-1 lg:flex-initial">
              <span className="block text-[9px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">Lead Value</span>
              <span className="text-sm font-bold text-[var(--foreground)]">${lead.value.toLocaleString()}</span>
            </div>
          )}
          {type === 'deal' && deal && (
            <div className="bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-center min-w-[120px] flex-1 lg:flex-initial">
              <span className="block text-[9px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">Deal Value</span>
              <span className="text-sm font-bold text-emerald-500 font-mono">
                {deal.currency} {deal.value.toLocaleString()}
              </span>
            </div>
          )}
          {type === 'contact' && contact && contact.email && (
            <div className="bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-left min-w-[180px] flex items-center gap-2.5 flex-1 lg:flex-initial">
              <Mail className="w-4 h-4 text-[var(--muted-foreground)] opacity-60" />
              <div>
                <span className="block text-[9px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">Email Address</span>
                <span className="text-xs font-semibold text-[var(--foreground)] break-all">{contact.email}</span>
              </div>
            </div>
          )}
          {type === 'account' && account && account.website && (
            <div className="bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] border border-[var(--border)] rounded-lg px-4 py-2.5 text-left min-w-[180px] flex items-center gap-2.5 flex-1 lg:flex-initial">
              <Globe className="w-4 h-4 text-[var(--muted-foreground)] opacity-60" />
              <div>
                <span className="block text-[9px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">Website</span>
                <a 
                  href={account.website.startsWith('http') ? account.website : `https://${account.website}`}
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="text-xs font-semibold text-[var(--primary)] hover:underline block truncate max-w-[140px]"
                >
                  {account.website}
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Tabs Layout */}
      <div className="flex-1 flex flex-col bg-[var(--card)] border border-[var(--border)] rounded-xl shadow-sm overflow-hidden mb-6">
        {/* Tab triggers */}
        <div className="h-11 bg-[color-mix(in_oklab,var(--secondary)_20%,transparent)] border-b border-[var(--border)] flex px-4 md:px-6 items-end space-x-6 overflow-x-auto scrollbar-none whitespace-nowrap">
          <button
            onClick={() => setActiveTab('overview')}
            className={`pb-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex-shrink-0 ${
              activeTab === 'overview' 
                ? 'border-[var(--primary)] text-[var(--primary)]' 
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Overview
          </button>
          <button
            onClick={() => setActiveTab('details')}
            className={`pb-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex-shrink-0 ${
              activeTab === 'details' 
                ? 'border-[var(--primary)] text-[var(--primary)]' 
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
            }`}
          >
            Notes & Details
          </button>
          {['account', 'contact'].includes(type) && (
            <button
              onClick={() => setActiveTab('related')}
              className={`pb-2.5 text-xs font-bold uppercase tracking-wider border-b-2 transition-all cursor-pointer flex-shrink-0 ${
                activeTab === 'related' 
                  ? 'border-[var(--primary)] text-[var(--primary)]' 
                  : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]'
              }`}
            >
              Related Lists
            </button>
          )}
        </div>

        {/* Tab content panel */}
        <div className="flex-1 p-4 md:p-6 overflow-auto">
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Field Information Grid */}
              <div>
                <h3 className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-4">Basic Information</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-5 border border-[var(--border)] rounded-xl p-4 md:p-5 bg-[color-mix(in_oklab,var(--secondary)_8%,transparent)]">
                  {type === 'lead' && lead && (
                    <>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">First Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{lead.first_name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Last Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{lead.last_name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Company Name</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{lead.company || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Professional Title</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{lead.title || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Email Address</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{lead.email || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Phone Number</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{lead.phone || '-'}</span>
                      </div>
                    </>
                  )}
                  {type === 'contact' && contact && (
                    <>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">First Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{contact.first_name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Last Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{contact.last_name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Professional Title</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{contact.title || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Email Address</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{contact.email || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Associated Account</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {contact.company ? (
                            <span 
                              onClick={() => navigate(`/crm/detail/account/${contact.company!.id}`)} 
                              className="text-[var(--primary)] hover:underline font-semibold cursor-pointer"
                            >
                              {contact.company.name}
                            </span>
                          ) : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Phone Number</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{contact.phone || '-'}</span>
                      </div>
                    </>
                  )}
                  {type === 'account' && account && (
                    <>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Account Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{account.name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Industry Category</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{account.industry || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Official Website</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">{account.website || '-'}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Created Date</span>
                        <span className="text-sm font-medium text-[var(--foreground)]">
                          {account.created_at ? new Date(account.created_at).toLocaleDateString() : '-'}
                        </span>
                      </div>
                    </>
                  )}
                  {type === 'deal' && deal && (
                    <>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Deal Name</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">{deal.name}</span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Financial Value</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {deal.currency} {deal.value.toLocaleString()}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Client Account</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {deal.company ? (
                            <span 
                              onClick={() => navigate(`/crm/detail/account/${deal.company!.id}`)} 
                              className="text-[var(--primary)] hover:underline font-semibold cursor-pointer"
                            >
                              {deal.company.name}
                            </span>
                          ) : '-'}
                        </span>
                      </div>
                      <div>
                        <span className="block text-[11px] font-semibold text-[var(--muted-foreground)]">Primary Contact Partner</span>
                        <span className="text-sm font-semibold text-[var(--foreground)]">
                          {deal.contact ? (
                            <span 
                              onClick={() => navigate(`/crm/detail/contact/${deal.contact!.id}`)} 
                              className="text-[var(--primary)] hover:underline font-semibold cursor-pointer"
                            >
                              {deal.contact.first_name} {deal.contact.last_name}
                            </span>
                          ) : '-'}
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'details' && (
            <div className="space-y-6">
              {/* Detailed Notes panel */}
              <div>
                <h3 className="text-xs font-bold text-[var(--muted-foreground)] uppercase tracking-wider mb-3">Record Notes</h3>
                <div className="bg-[color-mix(in_oklab,var(--secondary)_8%,transparent)] border border-[var(--border)] rounded-xl p-5 text-sm text-[var(--foreground)] min-h-[140px] whitespace-pre-wrap leading-relaxed">
                  {type === 'lead' && lead?.notes ? lead.notes :
                   type === 'contact' && contact?.notes ? contact.notes :
                   'No additional description notes are registered for this record.'}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'related' && (
            <div className="space-y-8">
              {type === 'account' && (
                <>
                  {/* Account Contacts list */}
                  <div>
                    <h4 className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <User className="w-4 h-4 text-[var(--muted-foreground)] opacity-70" />
                      <span>Associated Contacts</span>
                    </h4>
                    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-x-auto shadow-inner">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                          <tr className="bg-[color-mix(in_oklab,var(--secondary)_25%,transparent)] border-b border-[var(--border)] text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                            <th className="px-6 py-3">Name</th>
                            <th className="px-6 py-3">Email</th>
                            <th className="px-6 py-3">Phone</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] text-xs text-[var(--foreground)]">
                          {relatedContacts.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-6 py-8 text-center text-[var(--muted-foreground)] italic bg-[color-mix(in_oklab,var(--secondary)_3%,transparent)]">
                                No associated contacts found.
                              </td>
                            </tr>
                          ) : (
                            relatedContacts.map(c => (
                              <tr key={c.id} className="hover:bg-[color-mix(in_oklab,var(--secondary)_12%,transparent)] transition-colors">
                                <td className="px-6 py-3 font-semibold text-[var(--primary)]">
                                  <span 
                                    onClick={() => navigate(`/crm/detail/contact/${c.id}`)} 
                                    className="hover:underline cursor-pointer"
                                  >
                                    {c.first_name} {c.last_name}
                                  </span>
                                </td>
                                <td className="px-6 py-3 text-[var(--muted-foreground)]">{c.email || '—'}</td>
                                <td className="px-6 py-3 text-[var(--muted-foreground)]">{c.phone || '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Account Deals list */}
                  <div>
                    <h4 className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
                      <KanbanSquare className="w-4 h-4 text-[var(--muted-foreground)] opacity-70" />
                      <span>Deals Pipeline</span>
                    </h4>
                    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-x-auto shadow-inner">
                      <table className="w-full text-left border-collapse min-w-[500px]">
                        <thead>
                          <tr className="bg-[color-mix(in_oklab,var(--secondary)_25%,transparent)] border-b border-[var(--border)] text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                            <th className="px-6 py-3">Deal Name</th>
                            <th className="px-6 py-3">Value</th>
                            <th className="px-6 py-3">Stage</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[var(--border)] text-xs text-[var(--foreground)]">
                          {relatedDeals.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="px-6 py-8 text-center text-[var(--muted-foreground)] italic bg-[color-mix(in_oklab,var(--secondary)_3%,transparent)]">
                                No active pipeline deals found.
                              </td>
                            </tr>
                          ) : (
                            relatedDeals.map(d => (
                              <tr key={d.id} className="hover:bg-[color-mix(in_oklab,var(--secondary)_12%,transparent)] transition-colors">
                                <td className="px-6 py-3 font-semibold text-[var(--primary)]">
                                  <span 
                                    onClick={() => navigate(`/crm/detail/deal/${d.id}`)} 
                                    className="hover:underline cursor-pointer"
                                  >
                                    {d.name}
                                  </span>
                                </td>
                                <td className="px-6 py-3 font-medium text-emerald-500">{d.currency} {d.value.toLocaleString()}</td>
                                <td className="px-6 py-3">
                                  <span className="inline-flex px-2 py-0.5 rounded-full font-semibold bg-[color-mix(in_oklab,var(--secondary)_25%,transparent)] border border-[var(--border)] text-[var(--foreground)] text-[10px]">
                                    {d.stage}
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>
              )}

              {type === 'contact' && (
                <div>
                  <h4 className="text-xs font-bold text-[var(--foreground)] uppercase tracking-wider mb-4 flex items-center gap-1.5">
                    <KanbanSquare className="w-4 h-4 text-[var(--muted-foreground)] opacity-70" />
                    <span>Pipeline Deals</span>
                  </h4>
                  <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-x-auto shadow-inner">
                    <table className="w-full text-left border-collapse min-w-[500px]">
                      <thead>
                        <tr className="bg-[color-mix(in_oklab,var(--secondary)_25%,transparent)] border-b border-[var(--border)] text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-wider">
                          <th className="px-6 py-3">Deal Name</th>
                          <th className="px-6 py-3">Value</th>
                          <th className="px-6 py-3">Stage</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-[var(--border)] text-xs text-[var(--foreground)]">
                        {relatedDeals.length === 0 ? (
                          <tr>
                            <td colSpan={3} className="px-6 py-8 text-center text-[var(--muted-foreground)] italic bg-[color-mix(in_oklab,var(--secondary)_3%,transparent)]">
                              No associated pipeline deals found.
                            </td>
                          </tr>
                        ) : (
                          relatedDeals.map(d => (
                            <tr key={d.id} className="hover:bg-[color-mix(in_oklab,var(--secondary)_12%,transparent)] transition-colors">
                              <td className="px-6 py-3 font-semibold text-[var(--primary)]">
                                <span 
                                  onClick={() => navigate(`/crm/detail/deal/${d.id}`)} 
                                  className="hover:underline cursor-pointer"
                                >
                                  {d.name}
                                </span>
                              </td>
                              <td className="px-6 py-3 font-medium text-emerald-500">{d.currency} {d.value.toLocaleString()}</td>
                              <td className="px-6 py-3">
                                <span className="inline-flex px-2 py-0.5 rounded-full font-semibold bg-[color-mix(in_oklab,var(--secondary)_25%,transparent)] border border-[var(--border)] text-[var(--foreground)] text-[10px]">
                                  {d.stage}
                                </span>
                              </td>
                            </tr>
                          ))
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal (Glassmorphic Dialog) */}
      {showDeleteModal && (
        <div 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm transition-all"
          onClick={() => {
            if (!deleting) {
              setShowDeleteModal(false);
              setDeleteError(null);
            }
          }}
        >
          <div 
            className="bg-[var(--card)] rounded-xl shadow-2xl max-w-md w-full overflow-hidden border border-[var(--border)] animate-in fade-in zoom-in-95 duration-200"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="px-6 py-5 border-b border-[var(--border)]">
              <h3 className="text-base font-semibold text-[var(--foreground)] flex items-center gap-2">
                <AlertCircle className="w-5 h-5 text-[var(--destructive)]" />
                <span>Confirm Delete</span>
              </h3>
              <p className="text-xs text-[var(--muted-foreground)] mt-1">
                Are you absolutely sure you want to delete this {type}?
              </p>
            </div>

            {deleteError && (
              <div className="mx-6 mt-4 flex items-start gap-2 rounded-md border border-[color-mix(in_oklab,var(--destructive)_30%,transparent)] bg-[color-mix(in_oklab,var(--destructive)_8%,transparent)] px-3 py-2 text-xs text-[var(--destructive)]">
                <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                <span>{deleteError}</span>
              </div>
            )}

            <div className="p-6 text-sm text-[var(--foreground)]">
              This action is permanent and cannot be undone. All related data and activities for <strong className="text-[var(--foreground)]">"{recordName}"</strong> will be permanently removed.
            </div>

            <div className="pt-4 border-t border-[var(--border)] flex justify-end gap-2 bg-[color-mix(in_oklab,var(--secondary)_30%,transparent)] p-4">
              <button 
                onClick={() => {
                  setShowDeleteModal(false);
                  setDeleteError(null);
                }} 
                className="inline-flex items-center justify-center border border-[var(--border)] bg-[var(--background)] hover:bg-[var(--accent)] text-[var(--foreground)] rounded-md px-3.5 text-xs h-9 cursor-pointer transition-colors font-medium"
                disabled={deleting}
              >
                Cancel
              </button>
              <button 
                onClick={handleDelete}
                className="inline-flex items-center justify-center bg-[var(--destructive)] text-white hover:bg-[color-mix(in_oklab,var(--destructive)_90%,transparent)] rounded-md px-3.5 text-xs h-9 cursor-pointer transition-colors font-medium"
                disabled={deleting}
              >
                {deleting ? 'Deleting...' : 'Delete Permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
