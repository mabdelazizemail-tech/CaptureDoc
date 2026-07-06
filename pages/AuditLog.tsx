import React, { useState, useEffect } from 'react';
import { supabase } from '../services/supabaseClient';
import { User } from '../services/types';

interface AuditEntry {
    id: number;
    happened_at: string;
    table_name: string;
    operation: 'INSERT' | 'UPDATE' | 'DELETE';
    record_id: string | null;
    user_id: string | null;
    user_email: string | null;
    user_role: string | null;
    ip_address: string | null;
    user_agent: string | null;
    old_data: Record<string, any> | null;
    new_data: Record<string, any> | null;
    changed_fields: string[] | null;
}

interface AuditLogProps {
    user: User;
}

const PAGE_SIZE = 50;

const TABLE_LABELS: Record<string, string> = {
    hr_employees: 'الموظفين',
    hr_attendance: 'الحضور',
    hr_leave_requests: 'طلبات الإجازة',
    hr_leave_balances: 'أرصدة الإجازات',
    hr_payroll: 'الرواتب',
    hr_kpis: 'مؤشرات الأداء',
    hr_project_kpis: 'مؤشرات المشاريع',
    hr_holidays: 'العطلات',
    hr_employee_evaluations: 'تقييمات الموظفين',
    profiles: 'المستخدمين',
    projects: 'المشاريع',
    operators: 'المشغلين',
    kpi_logs: 'سجلات الإنتاجية',
    unlock_requests: 'طلبات فتح القفل',
    assets: 'الأصول',
    maintenance_requests: 'طلبات الصيانة',
    tickets: 'تذاكر الدعم',
    operator_settings: 'إعدادات المشغلين',
    collections_invoices: 'فواتير التحصيلات',
    collection_payments: 'دفعات التحصيل',
    collection_credit_notes: 'إشعارات دائنة',
    payables_invoices: 'فواتير المدفوعات',
    payable_payments: 'دفعات الموردين',
    payable_deductions: 'خصومات الموردين',
    journal_entries: 'القيود المحاسبية',
    journal_entry_lines: 'بنود القيود',
    journal_approval_history: 'اعتمادات القيود',
    journal_attachments: 'مرفقات القيود',
    receivable_monthly_tasks: 'مهام التحصيل الشهرية',
    leads: 'العملاء المحتملين (CRM)',
    contacts: 'جهات الاتصال (CRM)',
    companies: 'الشركات (CRM)',
    deals: 'الصفقات (CRM)',
    tasks: 'المهام (CRM)',
    pm_site_logs: 'سجلات المواقع',
    pm_inventory: 'المخزون',
    pm_expenses: 'المصروفات',
    pm_timesheets: 'سجلات الدوام'
};

const OPERATION_META: Record<string, { label: string; cls: string; icon: string }> = {
    INSERT: { label: 'إضافة', cls: 'bg-green-50 text-green-600', icon: 'add_circle' },
    UPDATE: { label: 'تعديل', cls: 'bg-blue-50 text-blue-600', icon: 'edit' },
    DELETE: { label: 'حذف', cls: 'bg-red-50 text-red-600', icon: 'delete' }
};

const ROLE_LABELS: Record<string, string> = {
    super_admin: 'مدير النظام',
    power_admin: 'مدير تنفيذي',
    admin: 'مدير',
    project_manager: 'مدير مشروع',
    supervisor: 'مشرف',
    it_specialist: 'دعم فني',
    hr_admin: 'موارد بشرية'
};

const tableLabel = (name: string) => TABLE_LABELS[name] || name;

const formatValue = (v: any): string => {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'object') return JSON.stringify(v);
    const s = String(v);
    return s.length > 120 ? s.slice(0, 120) + '…' : s;
};

const AuditLog: React.FC<AuditLogProps> = ({ user }) => {
    const [entries, setEntries] = useState<AuditEntry[]>([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [page, setPage] = useState(0);
    const [expandedId, setExpandedId] = useState<number | null>(null);

    // Filters
    const [tableFilter, setTableFilter] = useState('all');
    const [opFilter, setOpFilter] = useState('all');
    const [search, setSearch] = useState('');
    const [searchInput, setSearchInput] = useState('');
    const [dateFrom, setDateFrom] = useState('');
    const [dateTo, setDateTo] = useState('');

    useEffect(() => {
        fetchLogs();
    }, [page, tableFilter, opFilter, search, dateFrom, dateTo]);

    const fetchLogs = async () => {
        setLoading(true);
        try {
            let query = supabase
                .from('audit_logs')
                .select('*', { count: 'exact' })
                .order('happened_at', { ascending: false })
                .range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

            if (tableFilter !== 'all') query = query.eq('table_name', tableFilter);
            if (opFilter !== 'all') query = query.eq('operation', opFilter);
            if (search.trim()) {
                const term = search.trim().replace(/[%,()]/g, '');
                query = query.or(`user_email.ilike.%${term}%,record_id.ilike.%${term}%,ip_address.ilike.%${term}%`);
            }
            if (dateFrom) query = query.gte('happened_at', dateFrom);
            if (dateTo) query = query.lte('happened_at', dateTo + 'T23:59:59');

            const { data, count, error } = await query;
            if (error) throw error;
            setEntries(data || []);
            setTotalCount(count || 0);
        } catch (err) {
            console.error('Error fetching audit logs:', err);
            setEntries([]);
            setTotalCount(0);
        } finally {
            setLoading(false);
        }
    };

    const applySearch = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(0);
        setSearch(searchInput);
    };

    const formatTime = (iso: string) => {
        const d = new Date(iso);
        return `${d.toLocaleDateString('en-GB')} ${d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}`;
    };

    const renderDetails = (entry: AuditEntry) => {
        if (entry.operation === 'UPDATE') {
            const fields = (entry.changed_fields || []).filter(f => f !== 'updated_at');
            if (fields.length === 0) return <p className="text-xs text-gray-400">لا توجد تغييرات فعلية في البيانات</p>;
            return (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-gray-400">
                            <th className="text-right p-1 font-bold">الحقل</th>
                            <th className="text-right p-1 font-bold">القيمة السابقة</th>
                            <th className="text-right p-1 font-bold">القيمة الجديدة</th>
                        </tr>
                    </thead>
                    <tbody>
                        {fields.map(f => (
                            <tr key={f} className="border-t border-gray-100">
                                <td className="p-1 font-bold text-gray-700">{f}</td>
                                <td className="p-1 text-red-500 break-all">{formatValue(entry.old_data?.[f])}</td>
                                <td className="p-1 text-green-600 break-all">{formatValue(entry.new_data?.[f])}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            );
        }
        const data = entry.operation === 'INSERT' ? entry.new_data : entry.old_data;
        if (!data) return null;
        return (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-1 text-xs">
                {Object.entries(data).map(([k, v]) => (
                    <div key={k} className="flex gap-2">
                        <span className="font-bold text-gray-600 whitespace-nowrap">{k}:</span>
                        <span className="text-gray-500 break-all">{formatValue(v)}</span>
                    </div>
                ))}
            </div>
        );
    };

    if (user.role !== 'super_admin') {
        return (
            <div className="p-8 text-center text-gray-500">
                هذه الصفحة متاحة لمدير النظام فقط
            </div>
        );
    }

    const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));

    return (
        <div className="space-y-6 animate-fade-in">
            {/* Header + filters */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-3">
                    <h2 className="font-bold text-gray-800 flex items-center gap-2">
                        <span className="material-icons text-primary">history_edu</span>
                        سجل العمليات
                        <span className="bg-gray-100 text-gray-500 text-xs font-bold px-2 py-0.5 rounded-full">{totalCount.toLocaleString('en-US')}</span>
                    </h2>
                    <button onClick={() => fetchLogs()} className="flex items-center gap-1 text-xs font-bold text-gray-500 hover:text-primary transition-colors">
                        <span className="material-icons text-[16px]">refresh</span>
                        تحديث
                    </button>
                </div>

                <div className="flex items-center gap-3 flex-wrap">
                    <select
                        className="border rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 bg-white"
                        value={tableFilter}
                        onChange={(e) => { setPage(0); setTableFilter(e.target.value); }}
                    >
                        <option value="all">كل الجداول</option>
                        {Object.entries(TABLE_LABELS).map(([name, label]) => (
                            <option key={name} value={name}>{label}</option>
                        ))}
                    </select>

                    <select
                        className="border rounded-lg px-3 py-1.5 text-xs font-bold text-gray-800 bg-white"
                        value={opFilter}
                        onChange={(e) => { setPage(0); setOpFilter(e.target.value); }}
                    >
                        <option value="all">كل العمليات</option>
                        <option value="INSERT">إضافة</option>
                        <option value="UPDATE">تعديل</option>
                        <option value="DELETE">حذف</option>
                    </select>

                    <input
                        type="date"
                        className="border rounded-lg px-3 py-1.5 text-xs text-gray-800"
                        value={dateFrom}
                        onChange={(e) => { setPage(0); setDateFrom(e.target.value); }}
                        title="من تاريخ"
                    />
                    <input
                        type="date"
                        className="border rounded-lg px-3 py-1.5 text-xs text-gray-800"
                        value={dateTo}
                        onChange={(e) => { setPage(0); setDateTo(e.target.value); }}
                        title="إلى تاريخ"
                    />

                    <form onSubmit={applySearch} className="flex items-center gap-2 flex-1 min-w-[200px]">
                        <input
                            type="text"
                            className="border rounded-lg px-3 py-1.5 text-xs flex-1"
                            placeholder="بحث بالبريد الإلكتروني، معرف السجل، أو عنوان IP..."
                            value={searchInput}
                            onChange={(e) => setSearchInput(e.target.value)}
                        />
                        <button type="submit" className="px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-bold">بحث</button>
                    </form>
                </div>
            </div>

            {/* Log table */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
                ) : entries.length === 0 ? (
                    <div className="p-8 text-center text-gray-400 text-sm">لا توجد عمليات مسجلة</div>
                ) : (
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                            <thead className="bg-gray-50 text-gray-500 text-xs">
                                <tr>
                                    <th className="p-3 text-right font-bold">الوقت</th>
                                    <th className="p-3 text-right font-bold">المستخدم</th>
                                    <th className="p-3 text-center font-bold">العملية</th>
                                    <th className="p-3 text-right font-bold">الجدول</th>
                                    <th className="p-3 text-right font-bold">معرف السجل</th>
                                    <th className="p-3 text-right font-bold">عنوان IP</th>
                                    <th className="p-3 text-center font-bold">تفاصيل</th>
                                </tr>
                            </thead>
                            <tbody>
                                {entries.map(entry => {
                                    const op = OPERATION_META[entry.operation];
                                    const expanded = expandedId === entry.id;
                                    return (
                                        <React.Fragment key={entry.id}>
                                            <tr className="border-t border-gray-50 hover:bg-gray-50 transition-colors">
                                                <td className="p-3 text-gray-600 whitespace-nowrap text-xs">{formatTime(entry.happened_at)}</td>
                                                <td className="p-3">
                                                    <div className="font-bold text-gray-800 text-xs">{entry.user_email || 'غير معروف'}</div>
                                                    {entry.user_role && (
                                                        <div className="text-[10px] text-gray-400">{ROLE_LABELS[entry.user_role] || entry.user_role}</div>
                                                    )}
                                                </td>
                                                <td className="p-3 text-center">
                                                    <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-bold ${op.cls}`}>
                                                        <span className="material-icons text-[13px]">{op.icon}</span>
                                                        {op.label}
                                                    </span>
                                                </td>
                                                <td className="p-3 text-gray-700 font-bold text-xs">{tableLabel(entry.table_name)}</td>
                                                <td className="p-3 text-gray-400 text-[10px] font-mono" dir="ltr">{entry.record_id ? entry.record_id.slice(0, 8) : '—'}</td>
                                                <td className="p-3 text-gray-500 text-xs" dir="ltr">{entry.ip_address ? entry.ip_address.split(',')[0] : '—'}</td>
                                                <td className="p-3 text-center">
                                                    <button
                                                        onClick={() => setExpandedId(expanded ? null : entry.id)}
                                                        className="text-gray-400 hover:text-primary p-1 rounded transition-colors"
                                                    >
                                                        <span className="material-icons text-[18px]">{expanded ? 'expand_less' : 'expand_more'}</span>
                                                    </button>
                                                </td>
                                            </tr>
                                            {expanded && (
                                                <tr className="bg-gray-50/60">
                                                    <td colSpan={7} className="p-4">
                                                        <div className="space-y-3">
                                                            {renderDetails(entry)}
                                                            {entry.user_agent && (
                                                                <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2" dir="ltr">
                                                                    {entry.user_agent}
                                                                </p>
                                                            )}
                                                        </div>
                                                    </td>
                                                </tr>
                                            )}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>
                )}

                {/* Pagination */}
                {totalCount > PAGE_SIZE && (
                    <div className="p-3 border-t border-gray-100 flex items-center justify-between">
                        <button
                            onClick={() => setPage(p => Math.max(0, p - 1))}
                            disabled={page === 0}
                            className="px-3 py-1.5 border rounded-lg text-xs font-bold text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                        >
                            السابق
                        </button>
                        <span className="text-xs font-bold text-gray-500">صفحة {page + 1} من {totalPages}</span>
                        <button
                            onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))}
                            disabled={page >= totalPages - 1}
                            className="px-3 py-1.5 border rounded-lg text-xs font-bold text-gray-600 disabled:opacity-40 hover:bg-gray-50"
                        >
                            التالي
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default AuditLog;
