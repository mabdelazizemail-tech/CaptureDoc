import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import * as XLSX from 'xlsx';
import { User } from '../services/types';
import { loadJournalEntries, upsertJournalEntry, deleteJournalEntries } from '../services/journalStorage';

// ─── Types ────────────────────────────────────────────────────────────────────

type JEStatus = 'Draft' | 'Pending Approval' | 'Approved' | 'Posted' | 'Reversed' | 'Cancelled';
type JEType =
  | 'يدوي'
  | 'فاتورة مبيعات'
  | 'تحصيل عميل'
  | 'فاتورة مورد'
  | 'سداد مورد'
  | 'إشعار دائن/مدين'
  | 'استحقاق/دفعة مقدمة'
  | 'قيد عكسي'
  | 'أرصدة افتتاحية'
  | 'تسوية نهاية السنة';

type SourceModule = 'يدوي' | 'التحصيلات' | 'المدفوعات' | 'المحاسبة العامة';
type Currency = 'EGP' | 'USD';
type Screen =
  | 'dashboard'
  | 'list'
  | 'create'
  | 'edit'
  | 'details'
  | 'approval-inbox'
  | 'reversal'
  | 'bank-import';

// ─── Bank Import Types ────────────────────────────────────────────────────────

type BankImportStep = 'upload' | 'map' | 'review' | 'done';
type TxType = 'debit' | 'credit' | 'auto';

interface RawBankRow {
  [key: string]: string | number | undefined;
}

interface MappedTransaction {
  id: string;
  date: string;
  description: string;
  reference: string;
  debit: number;
  credit: number;
  balance: number;
  selected: boolean;
  debitAccount: string;
  debitAccountName: string;
  creditAccount: string;
  creditAccountName: string;
  jeCreated: boolean;
}

interface ColumnMapping {
  date: string;
  description: string;
  reference: string;
  debit: string;
  credit: string;
  balance: string;
  amount: string;        // single amount column (some banks)
  txType: string;        // debit/credit indicator column (some banks)
}

// Known Egyptian bank CSV column headers (normalized to lowercase for matching)
const BANK_COLUMN_HINTS: Record<string, keyof ColumnMapping> = {
  'date': 'date', 'تاريخ': 'date', 'transaction date': 'date', 'value date': 'date',
  'تاريخ المعاملة': 'date', 'تاريخ القيد': 'date',
  'description': 'description', 'بيان': 'description', 'وصف': 'description',
  'particulars': 'description', 'narrative': 'description', 'details': 'description',
  'البيان': 'description', 'الوصف': 'description', 'transaction details': 'description',
  'reference': 'reference', 'ref': 'reference', 'reference no': 'reference',
  'ref no': 'reference', 'رقم مرجعي': 'reference', 'المرجع': 'reference',
  'debit': 'debit', 'مدين': 'debit', 'سحب': 'debit', 'withdrawals': 'debit',
  'withdrawal': 'debit', 'dr': 'debit', 'debit amount': 'debit',
  'credit': 'credit', 'دائن': 'credit', 'إيداع': 'credit', 'deposits': 'credit',
  'deposit': 'credit', 'cr': 'credit', 'credit amount': 'credit',
  'balance': 'balance', 'رصيد': 'balance', 'الرصيد': 'balance', 'running balance': 'balance',
  'amount': 'amount', 'مبلغ': 'amount', 'القيمة': 'amount',
  'type': 'txType', 'نوع': 'txType', 'dr/cr': 'txType', 'transaction type': 'txType',
};

interface JournalEntryLine {
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

interface ApprovalHistoryItem {
  id: string;
  action: 'submitted' | 'approved' | 'rejected' | 'posted' | 'reversed';
  performed_by: string;
  performed_at: string;
  comment?: string;
}

interface JournalEntry {
  id: string;
  journal_number: string;
  entry_type: JEType;
  source_module: SourceModule;
  source_document_no?: string;
  source_document_id?: string;
  reference_no?: string;
  entry_date: string;
  posting_date: string;
  fiscal_period: string;
  currency: Currency;
  exchange_rate?: number;
  description: string;
  status: JEStatus;
  auto_generated_flag: boolean;
  reversal_of_entry_id?: string;
  created_by: string;
  created_at: string;
  approved_by?: string;
  approved_at?: string;
  posted_by?: string;
  posted_at?: string;
  lines: JournalEntryLine[];
  approval_history: ApprovalHistoryItem[];
  attachments: { name: string; size: string }[];
}

interface ChartOfAccount {
  code: string;
  name: string;
  type: 'أصول' | 'خصوم' | 'حقوق ملكية' | 'إيرادات' | 'مصروفات';
  normal_balance: 'debit' | 'credit';
}

// ─── Chart of Accounts ────────────────────────────────────────────────────────

const CHART_OF_ACCOUNTS: ChartOfAccount[] = [
  { code: '1100', name: 'النقدية والبنوك', type: 'أصول', normal_balance: 'debit' },
  { code: '1110', name: 'الصندوق', type: 'أصول', normal_balance: 'debit' },
  { code: '1120', name: 'البنك الأهلي المصري', type: 'أصول', normal_balance: 'debit' },
  { code: '1130', name: 'بنك QNB', type: 'أصول', normal_balance: 'debit' },
  { code: '1200', name: 'الذمم المدينة - عملاء', type: 'أصول', normal_balance: 'debit' },
  { code: '1210', name: 'مديونية العملاء المحليين', type: 'أصول', normal_balance: 'debit' },
  { code: '1220', name: 'مديونية العملاء الخارجيين', type: 'أصول', normal_balance: 'debit' },
  { code: '1300', name: 'المخزون', type: 'أصول', normal_balance: 'debit' },
  { code: '1400', name: 'المصروفات المدفوعة مقدماً', type: 'أصول', normal_balance: 'debit' },
  { code: '1500', name: 'الأصول الثابتة', type: 'أصول', normal_balance: 'debit' },
  { code: '1510', name: 'الأثاث والمعدات', type: 'أصول', normal_balance: 'debit' },
  { code: '1520', name: 'أجهزة الحاسب الآلي', type: 'أصول', normal_balance: 'debit' },
  { code: '2100', name: 'الذمم الدائنة - موردين', type: 'خصوم', normal_balance: 'credit' },
  { code: '2110', name: 'مستحقات الموردين المحليين', type: 'خصوم', normal_balance: 'credit' },
  { code: '2200', name: 'ضريبة القيمة المضافة المستحقة', type: 'خصوم', normal_balance: 'credit' },
  { code: '2210', name: 'ضريبة المبيعات المستحقة', type: 'خصوم', normal_balance: 'credit' },
  { code: '2220', name: 'ضريبة الخصم والإضافة', type: 'خصوم', normal_balance: 'credit' },
  { code: '2300', name: 'المصروفات المستحقة', type: 'خصوم', normal_balance: 'credit' },
  { code: '2400', name: 'الدفعات المقدمة من العملاء', type: 'خصوم', normal_balance: 'credit' },
  { code: '3100', name: 'رأس المال', type: 'حقوق ملكية', normal_balance: 'credit' },
  { code: '3200', name: 'الأرباح المحتجزة', type: 'حقوق ملكية', normal_balance: 'credit' },
  { code: '4100', name: 'إيرادات المبيعات', type: 'إيرادات', normal_balance: 'credit' },
  { code: '4110', name: 'إيرادات الخدمات', type: 'إيرادات', normal_balance: 'credit' },
  { code: '4120', name: 'إيرادات المشاريع', type: 'إيرادات', normal_balance: 'credit' },
  { code: '4200', name: 'إيرادات أخرى', type: 'إيرادات', normal_balance: 'credit' },
  { code: '5100', name: 'تكلفة المبيعات', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5200', name: 'مصروفات الرواتب والأجور', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5300', name: 'مصروفات الإيجار', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5400', name: 'مصروفات المرافق', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5500', name: 'مصروفات الإهلاك', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5600', name: 'مصروفات تشغيلية أخرى', type: 'مصروفات', normal_balance: 'debit' },
  { code: '5700', name: 'مردودات المبيعات', type: 'مصروفات', normal_balance: 'debit' },
];

// ─── Accounting Periods ───────────────────────────────────────────────────────

const ACCOUNTING_PERIODS = [
  { id: 'FY2025-01', label: 'يناير 2025', start: '2025-01-01', end: '2025-01-31' },
  { id: 'FY2025-02', label: 'فبراير 2025', start: '2025-02-01', end: '2025-02-28' },
  { id: 'FY2025-03', label: 'مارس 2025', start: '2025-03-01', end: '2025-03-31' },
  { id: 'FY2025-04', label: 'أبريل 2025', start: '2025-04-01', end: '2025-04-30' },
  { id: 'FY2025-05', label: 'مايو 2025', start: '2025-05-01', end: '2025-05-31' },
  { id: 'FY2025-06', label: 'يونيو 2025', start: '2025-06-01', end: '2025-06-30' },
  { id: 'FY2025-07', label: 'يوليو 2025', start: '2025-07-01', end: '2025-07-31' },
  { id: 'FY2025-08', label: 'أغسطس 2025', start: '2025-08-01', end: '2025-08-31' },
  { id: 'FY2025-09', label: 'سبتمبر 2025', start: '2025-09-01', end: '2025-09-30' },
  { id: 'FY2025-10', label: 'أكتوبر 2025', start: '2025-10-01', end: '2025-10-31' },
  { id: 'FY2025-11', label: 'نوفمبر 2025', start: '2025-11-01', end: '2025-11-30' },
  { id: 'FY2025-12', label: 'ديسمبر 2025', start: '2025-12-01', end: '2025-12-31' },
  { id: 'FY2026-01', label: 'يناير 2026', start: '2026-01-01', end: '2026-01-31' },
  { id: 'FY2026-02', label: 'فبراير 2026', start: '2026-02-01', end: '2026-02-28' },
  { id: 'FY2026-03', label: 'مارس 2026', start: '2026-03-01', end: '2026-03-31' },
  { id: 'FY2026-04', label: 'أبريل 2026', start: '2026-04-01', end: '2026-04-30' },
];

// ─── Mock Data ────────────────────────────────────────────────────────────────

const MOCK_ENTRIES: JournalEntry[] = [
  {
    id: 'je-001', journal_number: 'JE-2026-0001', entry_type: 'فاتورة مبيعات',
    source_module: 'التحصيلات', source_document_no: 'INV-2026-0045', source_document_id: 'inv-045',
    reference_no: 'INV-2026-0045', entry_date: '2026-04-01', posting_date: '2026-04-01',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد فاتورة مبيعات - عميل شركة الفجر للتكنولوجيا',
    status: 'Posted', auto_generated_flag: true, created_by: 'النظام', created_at: '2026-04-01T09:00:00',
    approved_by: 'أحمد محمد', approved_at: '2026-04-01T09:30:00',
    posted_by: 'أحمد محمد', posted_at: '2026-04-01T09:35:00',
    lines: [
      { line_no: 1, account_code: '1210', account_name: 'مديونية العملاء المحليين', line_description: 'مديونية شركة الفجر للتكنولوجيا', debit_amount: 57720, credit_amount: 0 },
      { line_no: 2, account_code: '4110', account_name: 'إيرادات الخدمات', line_description: 'إيراد خدمات تقنية المعلومات', debit_amount: 0, credit_amount: 51000 },
      { line_no: 3, account_code: '2210', account_name: 'ضريبة المبيعات المستحقة', line_description: 'ضريبة القيمة المضافة 14%', debit_amount: 0, credit_amount: 6720 },
    ],
    approval_history: [
      { id: 'ah-1', action: 'submitted', performed_by: 'النظام', performed_at: '2026-04-01T09:00:00' },
      { id: 'ah-2', action: 'approved', performed_by: 'أحمد محمد', performed_at: '2026-04-01T09:30:00' },
      { id: 'ah-3', action: 'posted', performed_by: 'أحمد محمد', performed_at: '2026-04-01T09:35:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-002', journal_number: 'JE-2026-0002', entry_type: 'تحصيل عميل',
    source_module: 'التحصيلات', source_document_no: 'PAY-2026-0012', source_document_id: 'pay-012',
    reference_no: 'PAY-2026-0012', entry_date: '2026-04-03', posting_date: '2026-04-03',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد تحصيل دفعة من شركة الفجر للتكنولوجيا',
    status: 'Posted', auto_generated_flag: true, created_by: 'النظام', created_at: '2026-04-03T11:00:00',
    approved_by: 'أحمد محمد', approved_at: '2026-04-03T11:30:00',
    posted_by: 'أحمد محمد', posted_at: '2026-04-03T11:35:00',
    lines: [
      { line_no: 1, account_code: '1120', account_name: 'البنك الأهلي المصري', line_description: 'تحويل بنكي وارد', debit_amount: 30000, credit_amount: 0 },
      { line_no: 2, account_code: '1210', account_name: 'مديونية العملاء المحليين', line_description: 'تسوية مديونية شركة الفجر', debit_amount: 0, credit_amount: 30000 },
    ],
    approval_history: [
      { id: 'ah-4', action: 'submitted', performed_by: 'النظام', performed_at: '2026-04-03T11:00:00' },
      { id: 'ah-5', action: 'posted', performed_by: 'أحمد محمد', performed_at: '2026-04-03T11:35:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-003', journal_number: 'JE-2026-0003', entry_type: 'فاتورة مورد',
    source_module: 'المدفوعات', source_document_no: 'SUP-2026-0089', source_document_id: 'sup-089',
    reference_no: 'SUP-2026-0089', entry_date: '2026-04-05', posting_date: '2026-04-05',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد فاتورة مورد - شركة الرياض للاستشارات',
    status: 'Posted', auto_generated_flag: true, created_by: 'النظام', created_at: '2026-04-05T10:00:00',
    approved_by: 'سارة حسن', approved_at: '2026-04-05T10:30:00',
    posted_by: 'سارة حسن', posted_at: '2026-04-05T10:40:00',
    lines: [
      { line_no: 1, account_code: '5600', account_name: 'مصروفات تشغيلية أخرى', line_description: 'مصروف استشارات إدارية', debit_amount: 25000, credit_amount: 0 },
      { line_no: 2, account_code: '1400', account_name: 'ضريبة القيمة المضافة القابلة للاسترداد', line_description: 'ضريبة القيمة المضافة 14%', debit_amount: 3500, credit_amount: 0 },
      { line_no: 3, account_code: '2110', account_name: 'مستحقات الموردين المحليين', line_description: 'مستحقات شركة الرياض للاستشارات', debit_amount: 0, credit_amount: 28500 },
    ],
    approval_history: [
      { id: 'ah-6', action: 'submitted', performed_by: 'النظام', performed_at: '2026-04-05T10:00:00' },
      { id: 'ah-7', action: 'approved', performed_by: 'سارة حسن', performed_at: '2026-04-05T10:30:00' },
      { id: 'ah-8', action: 'posted', performed_by: 'سارة حسن', performed_at: '2026-04-05T10:40:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-004', journal_number: 'JE-2026-0004', entry_type: 'يدوي',
    source_module: 'يدوي', reference_no: 'MAN-2026-0004',
    entry_date: '2026-04-10', posting_date: '2026-04-10',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد استحقاق مصروف الإيجار - أبريل 2026',
    status: 'Posted', auto_generated_flag: false, created_by: 'محمد علي', created_at: '2026-04-10T08:00:00',
    approved_by: 'أحمد محمد', approved_at: '2026-04-10T08:30:00',
    posted_by: 'أحمد محمد', posted_at: '2026-04-10T08:35:00',
    lines: [
      { line_no: 1, account_code: '5300', account_name: 'مصروفات الإيجار', line_description: 'إيجار المكتب الرئيسي - أبريل 2026', debit_amount: 18000, credit_amount: 0 },
      { line_no: 2, account_code: '2300', account_name: 'المصروفات المستحقة', line_description: 'مستحق إيجار أبريل 2026', debit_amount: 0, credit_amount: 18000 },
    ],
    approval_history: [
      { id: 'ah-9', action: 'submitted', performed_by: 'محمد علي', performed_at: '2026-04-10T08:00:00' },
      { id: 'ah-10', action: 'approved', performed_by: 'أحمد محمد', performed_at: '2026-04-10T08:30:00' },
      { id: 'ah-11', action: 'posted', performed_by: 'أحمد محمد', performed_at: '2026-04-10T08:35:00' },
    ],
    attachments: [{ name: 'عقد_الإيجار.pdf', size: '245 KB' }],
  },
  {
    id: 'je-005', journal_number: 'JE-2026-0005', entry_type: 'سداد مورد',
    source_module: 'المدفوعات', source_document_no: 'PMNT-2026-0033', source_document_id: 'pmnt-033',
    reference_no: 'PMNT-2026-0033', entry_date: '2026-04-12', posting_date: '2026-04-12',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد سداد دفعة لمورد شركة الرياض للاستشارات',
    status: 'Posted', auto_generated_flag: true, created_by: 'النظام', created_at: '2026-04-12T13:00:00',
    approved_by: 'سارة حسن', approved_at: '2026-04-12T13:20:00',
    posted_by: 'سارة حسن', posted_at: '2026-04-12T13:25:00',
    lines: [
      { line_no: 1, account_code: '2110', account_name: 'مستحقات الموردين المحليين', line_description: 'تسوية مستحقات شركة الرياض', debit_amount: 28500, credit_amount: 0 },
      { line_no: 2, account_code: '1120', account_name: 'البنك الأهلي المصري', line_description: 'تحويل بنكي صادر', debit_amount: 0, credit_amount: 28500 },
    ],
    approval_history: [
      { id: 'ah-12', action: 'submitted', performed_by: 'النظام', performed_at: '2026-04-12T13:00:00' },
      { id: 'ah-13', action: 'posted', performed_by: 'سارة حسن', performed_at: '2026-04-12T13:25:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-006', journal_number: 'JE-2026-0006', entry_type: 'يدوي',
    source_module: 'يدوي', reference_no: 'MAN-2026-0006',
    entry_date: '2026-04-15', posting_date: '2026-04-15',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد إهلاك شهري - أبريل 2026',
    status: 'Pending Approval', auto_generated_flag: false, created_by: 'محمد علي', created_at: '2026-04-15T09:00:00',
    lines: [
      { line_no: 1, account_code: '5500', account_name: 'مصروفات الإهلاك', line_description: 'إهلاك أجهزة الحاسب الآلي', debit_amount: 4200, credit_amount: 0 },
      { line_no: 2, account_code: '1520', account_name: 'أجهزة الحاسب الآلي', line_description: 'مجمع إهلاك أجهزة الحاسب', debit_amount: 0, credit_amount: 4200 },
    ],
    approval_history: [
      { id: 'ah-14', action: 'submitted', performed_by: 'محمد علي', performed_at: '2026-04-15T09:00:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-007', journal_number: 'JE-2026-0007', entry_type: 'يدوي',
    source_module: 'يدوي', reference_no: 'MAN-2026-0007',
    entry_date: '2026-04-18', posting_date: '',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد توزيع مصروف الكهرباء على مراكز التكلفة',
    status: 'Draft', auto_generated_flag: false, created_by: 'محمد علي', created_at: '2026-04-18T10:00:00',
    lines: [
      { line_no: 1, account_code: '5400', account_name: 'مصروفات المرافق', line_description: 'مصروف الكهرباء - المبنى الرئيسي', cost_center: 'CC-01', debit_amount: 5000, credit_amount: 0 },
      { line_no: 2, account_code: '5400', account_name: 'مصروفات المرافق', line_description: 'مصروف الكهرباء - المستودع', cost_center: 'CC-02', debit_amount: 2500, credit_amount: 0 },
      { line_no: 3, account_code: '2300', account_name: 'المصروفات المستحقة', line_description: 'مستحق كهرباء أبريل 2026', debit_amount: 0, credit_amount: 7500 },
    ],
    approval_history: [],
    attachments: [],
  },
  {
    id: 'je-008', journal_number: 'JE-2026-0008', entry_type: 'إشعار دائن/مدين',
    source_module: 'التحصيلات', source_document_no: 'CN-2026-0003', source_document_id: 'cn-003',
    reference_no: 'CN-2026-0003', entry_date: '2026-04-20', posting_date: '2026-04-20',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد إشعار دائن - إرجاع جزئي لفاتورة شركة الفجر',
    status: 'Posted', auto_generated_flag: true, created_by: 'النظام', created_at: '2026-04-20T14:00:00',
    approved_by: 'أحمد محمد', approved_at: '2026-04-20T14:20:00',
    posted_by: 'أحمد محمد', posted_at: '2026-04-20T14:25:00',
    lines: [
      { line_no: 1, account_code: '5700', account_name: 'مردودات المبيعات', line_description: 'مرتجع خدمات - شركة الفجر', debit_amount: 10000, credit_amount: 0 },
      { line_no: 2, account_code: '2210', account_name: 'ضريبة المبيعات المستحقة', line_description: 'تسوية ضريبة المرتجع', debit_amount: 1400, credit_amount: 0 },
      { line_no: 3, account_code: '1210', account_name: 'مديونية العملاء المحليين', line_description: 'تخفيض مديونية شركة الفجر', debit_amount: 0, credit_amount: 11400 },
    ],
    approval_history: [
      { id: 'ah-15', action: 'submitted', performed_by: 'النظام', performed_at: '2026-04-20T14:00:00' },
      { id: 'ah-16', action: 'posted', performed_by: 'أحمد محمد', performed_at: '2026-04-20T14:25:00' },
    ],
    attachments: [],
  },
  {
    id: 'je-009', journal_number: 'JE-2026-0009', entry_type: 'يدوي',
    source_module: 'يدوي', reference_no: 'MAN-2026-0009',
    entry_date: '2026-04-22', posting_date: '',
    fiscal_period: 'FY2026-04', currency: 'USD', exchange_rate: 50.5,
    description: 'قيد استحقاق رواتب أبريل 2026',
    status: 'Draft', auto_generated_flag: false, created_by: 'هانى إبراهيم', created_at: '2026-04-22T07:00:00',
    lines: [
      { line_no: 1, account_code: '5200', account_name: 'مصروفات الرواتب والأجور', line_description: 'رواتب فريق تقنية المعلومات', debit_amount: 15000, credit_amount: 0 },
      { line_no: 2, account_code: '2300', account_name: 'المصروفات المستحقة', line_description: 'رواتب مستحقة - أبريل 2026', debit_amount: 0, credit_amount: 15000 },
    ],
    approval_history: [],
    attachments: [],
  },
  {
    id: 'je-010', journal_number: 'JE-2026-0010', entry_type: 'قيد عكسي',
    source_module: 'المحاسبة العامة', reversal_of_entry_id: 'je-004',
    reference_no: 'REV-JE-2026-0004', entry_date: '2026-04-25', posting_date: '2026-04-25',
    fiscal_period: 'FY2026-04', currency: 'EGP', description: 'قيد عكسي للقيد JE-2026-0004 - استحقاق إيجار',
    status: 'Posted', auto_generated_flag: false, created_by: 'أحمد محمد', created_at: '2026-04-25T08:00:00',
    approved_by: 'أحمد محمد', approved_at: '2026-04-25T08:10:00',
    posted_by: 'أحمد محمد', posted_at: '2026-04-25T08:15:00',
    lines: [
      { line_no: 1, account_code: '2300', account_name: 'المصروفات المستحقة', line_description: 'عكس مستحق إيجار أبريل 2026', debit_amount: 18000, credit_amount: 0 },
      { line_no: 2, account_code: '5300', account_name: 'مصروفات الإيجار', line_description: 'عكس مصروف إيجار أبريل 2026', debit_amount: 0, credit_amount: 18000 },
    ],
    approval_history: [
      { id: 'ah-17', action: 'submitted', performed_by: 'أحمد محمد', performed_at: '2026-04-25T08:00:00' },
      { id: 'ah-18', action: 'posted', performed_by: 'أحمد محمد', performed_at: '2026-04-25T08:15:00' },
    ],
    attachments: [],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2);

const fmt = (n: number) =>
  n.toLocaleString('en-EG', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const totalDebit = (lines: JournalEntryLine[]) => lines.reduce((s, l) => s + l.debit_amount, 0);
const totalCredit = (lines: JournalEntryLine[]) => lines.reduce((s, l) => s + l.credit_amount, 0);
const isBalanced = (lines: JournalEntryLine[]) =>
  Math.abs(totalDebit(lines) - totalCredit(lines)) < 0.01;

const nextJournalNumber = (entries: JournalEntry[]) => {
  const year = new Date().getFullYear();
  const max = entries
    .map(e => parseInt(e.journal_number.split('-')[2] || '0'))
    .reduce((a, b) => Math.max(a, b), 0);
  return `JE-${year}-${String(max + 1).padStart(4, '0')}`;
};

const currentPeriod = () => {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  return `FY${d.getFullYear()}-${m}`;
};

// ─── Status Config ────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<JEStatus, string> = {
  'Draft':            'bg-gray-600/50 text-gray-300',
  'Pending Approval': 'bg-yellow-900/50 text-yellow-300',
  'Approved':         'bg-blue-900/50 text-blue-300',
  'Posted':           'bg-green-900/50 text-green-400',
  'Reversed':         'bg-purple-900/50 text-purple-300',
  'Cancelled':        'bg-red-900/40 text-red-400',
};

const STATUS_AR: Record<JEStatus, string> = {
  'Draft':            'مسودة',
  'Pending Approval': 'بانتظار الاعتماد',
  'Approved':         'معتمد',
  'Posted':           'مُرحَّل',
  'Reversed':         'معكوس',
  'Cancelled':        'ملغى',
};

const TYPE_AR: Record<JEType, string> = {
  'يدوي':                   'يدوي',
  'فاتورة مبيعات':          'فاتورة مبيعات',
  'تحصيل عميل':             'تحصيل عميل',
  'فاتورة مورد':            'فاتورة مورد',
  'سداد مورد':              'سداد مورد',
  'إشعار دائن/مدين':        'إشعار دائن/مدين',
  'استحقاق/دفعة مقدمة':    'استحقاق/دفعة مقدمة',
  'قيد عكسي':               'قيد عكسي',
  'أرصدة افتتاحية':         'أرصدة افتتاحية',
  'تسوية نهاية السنة':      'تسوية نهاية السنة',
};

const SOURCE_COLOR: Record<SourceModule, string> = {
  'يدوي':              'bg-gray-700 text-gray-300',
  'التحصيلات':         'bg-sky-900/50 text-sky-300',
  'المدفوعات':          'bg-orange-900/50 text-orange-300',
  'المحاسبة العامة':   'bg-teal-900/50 text-teal-300',
};

// ─── Sub-components ───────────────────────────────────────────────────────────

const StatusBadge: React.FC<{ status: JEStatus }> = ({ status }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${STATUS_COLOR[status]}`}>
    {STATUS_AR[status]}
  </span>
);

const SourceBadge: React.FC<{ src: SourceModule }> = ({ src }) => (
  <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${SOURCE_COLOR[src]}`}>
    {src}
  </span>
);

const BalanceBadge: React.FC<{ lines: JournalEntryLine[] }> = ({ lines }) => {
  const balanced = isBalanced(lines);
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold ${balanced ? 'bg-green-900/50 text-green-400' : 'bg-red-900/50 text-red-400'}`}>
      <span className="material-icons text-xs">{balanced ? 'check_circle' : 'error'}</span>
      {balanced ? 'متوازن' : 'غير متوازن'}
    </span>
  );
};

const Th: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <th className={`px-3 py-2.5 text-right text-xs font-semibold text-gray-400 uppercase tracking-wider whitespace-nowrap ${className}`}>
    {children}
  </th>
);

const Td: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className = '' }) => (
  <td className={`px-3 py-2.5 text-sm text-gray-300 ${className}`}>
    {children}
  </td>
);

// ─── Empty Line Factory ───────────────────────────────────────────────────────

const emptyLine = (n: number): JournalEntryLine => ({
  line_no: n,
  account_code: '',
  account_name: '',
  line_description: '',
  debit_amount: 0,
  credit_amount: 0,
});

const emptyEntry = (entries: JournalEntry[], user: User): JournalEntry => ({
  id: uid(),
  journal_number: nextJournalNumber(entries),
  entry_type: 'يدوي',
  source_module: 'يدوي',
  reference_no: '',
  entry_date: new Date().toISOString().split('T')[0],
  posting_date: '',
  fiscal_period: currentPeriod(),
  currency: 'EGP',
  description: '',
  status: 'Draft',
  auto_generated_flag: false,
  created_by: user.name,
  created_at: new Date().toISOString(),
  lines: [emptyLine(1), emptyLine(2)],
  approval_history: [],
  attachments: [],
});

// ─── Main Component ───────────────────────────────────────────────────────────

interface Props { user: User; }

const JournalEntriesDashboard: React.FC<Props> = ({ user }) => {
  const [entries, setEntries] = useState<JournalEntry[]>(MOCK_ENTRIES);
  const [screen, setScreen] = useState<Screen>('dashboard');
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [editEntry, setEditEntry] = useState<JournalEntry | null>(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' } | null>(null);

  // Filters
  const [filterStatus, setFilterStatus] = useState('');
  const [filterSource, setFilterSource] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterPeriod, setFilterPeriod] = useState('');
  const [filterRef, setFilterRef] = useState('');
  const [filterCreatedBy, setFilterCreatedBy] = useState('');
  const [filterDateFrom, setFilterDateFrom] = useState('');
  const [filterDateTo, setFilterDateTo] = useState('');

  // Reversal modal
  const [reversalEntry, setReversalEntry] = useState<JournalEntry | null>(null);
  const [reversalDate, setReversalDate] = useState(new Date().toISOString().split('T')[0]);
  const [reversalReason, setReversalReason] = useState('');

  // Account lookup modal
  const [accountSearchOpen, setAccountSearchOpen] = useState(false);
  const [accountSearchQuery, setAccountSearchQuery] = useState('');
  const [accountTargetLineNo, setAccountTargetLineNo] = useState(0);

  // Approval comment
  const [approvalComment, setApprovalComment] = useState('');
  const [approvalAction, setApprovalAction] = useState<'approve' | 'reject' | null>(null);

  // Bank Import state
  const [importStep, setImportStep] = useState<BankImportStep>('upload');
  const [importFileName, setImportFileName] = useState('');
  const [importRawRows, setImportRawRows] = useState<RawBankRow[]>([]);
  const [importColumns, setImportColumns] = useState<string[]>([]);
  const [importMapping, setImportMapping] = useState<ColumnMapping>({ date: '', description: '', reference: '', debit: '', credit: '', balance: '', amount: '', txType: '' });
  const [importTransactions, setImportTransactions] = useState<MappedTransaction[]>([]);
  const [importBankAccount, setImportBankAccount] = useState<{ code: string; name: string }>({ code: '1120', name: 'البنك الأهلي المصري' });
  const [importDefaultDebit, setImportDefaultDebit] = useState<{ code: string; name: string }>({ code: '5600', name: 'مصروفات تشغيلية أخرى' });
  const [importDefaultCredit, setImportDefaultCredit] = useState<{ code: string; name: string }>({ code: '4200', name: 'إيرادات أخرى' });
  const [importPostedCount, setImportPostedCount] = useState(0);
  const importFileRef = useRef<HTMLInputElement>(null);

  const showToast = (msg: string, type: 'success' | 'error' = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Persistence (load from Supabase on mount, fall back to mock) ──
  useEffect(() => {
    loadJournalEntries()
      .then(data => { if (data.length > 0) setEntries(data as JournalEntry[]); })
      .catch(() => { /* stay with mock data */ });
  }, []);

  const persist = useCallback(async (updated: JournalEntry[]) => {
    setEntries(updated);
    try {
      await Promise.all(updated.map(e => upsertJournalEntry(e)));
    } catch { /* local state still updated */ }
  }, []);

  // ── Filtered list ──────────────────────────────────────────────────
  const filteredEntries = useMemo(() => {
    return entries.filter(e => {
      if (filterStatus && e.status !== filterStatus) return false;
      if (filterSource && e.source_module !== filterSource) return false;
      if (filterType && e.entry_type !== filterType) return false;
      if (filterPeriod && e.fiscal_period !== filterPeriod) return false;
      if (filterRef && !e.reference_no?.toLowerCase().includes(filterRef.toLowerCase()) &&
          !e.journal_number.toLowerCase().includes(filterRef.toLowerCase())) return false;
      if (filterCreatedBy && !e.created_by.includes(filterCreatedBy)) return false;
      if (filterDateFrom && e.entry_date < filterDateFrom) return false;
      if (filterDateTo && e.entry_date > filterDateTo) return false;
      return true;
    });
  }, [entries, filterStatus, filterSource, filterType, filterPeriod, filterRef, filterCreatedBy, filterDateFrom, filterDateTo]);

  // ── KPIs ────────────────────────────────────────────────────────────
  const kpis = useMemo(() => {
    const now = new Date();
    const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    return {
      draft: entries.filter(e => e.status === 'Draft').length,
      pending: entries.filter(e => e.status === 'Pending Approval').length,
      postedThisMonth: entries.filter(e => e.status === 'Posted' && e.posting_date?.startsWith(thisMonth)).length,
      reversedThisMonth: entries.filter(e => e.status === 'Reversed' && e.posting_date?.startsWith(thisMonth)).length,
      unbalanced: entries.filter(e => e.status === 'Draft' && !isBalanced(e.lines)).length,
      totalPosted: entries.filter(e => e.status === 'Posted').length,
      autoGenerated: entries.filter(e => e.auto_generated_flag).length,
      manualEntries: entries.filter(e => !e.auto_generated_flag).length,
    };
  }, [entries]);

  // ── Actions ──────────────────────────────────────────────────────────

  const saveEntry = async (entry: JournalEntry) => {
    const updated = entries.some(e => e.id === entry.id)
      ? entries.map(e => e.id === entry.id ? entry : e)
      : [entry, ...entries];
    await persist(updated);
  };

  const submitEntry = async (entry: JournalEntry) => {
    if (!isBalanced(entry.lines)) { showToast('القيد غير متوازن — لا يمكن الإرسال للاعتماد', 'error'); return; }
    if (entry.lines.length < 2) { showToast('يجب أن يحتوي القيد على سطرين على الأقل', 'error'); return; }
    const updated: JournalEntry = {
      ...entry, status: 'Pending Approval',
      approval_history: [...entry.approval_history, {
        id: uid(), action: 'submitted', performed_by: user.name, performed_at: new Date().toISOString(),
      }],
    };
    await saveEntry(updated);
    showToast('تم إرسال القيد للاعتماد بنجاح');
    setScreen('list');
  };

  const approveEntry = async (entry: JournalEntry, comment?: string) => {
    const updated: JournalEntry = {
      ...entry, status: 'Approved',
      approved_by: user.name, approved_at: new Date().toISOString(),
      approval_history: [...entry.approval_history, {
        id: uid(), action: 'approved', performed_by: user.name, performed_at: new Date().toISOString(), comment,
      }],
    };
    await saveEntry(updated);
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
    showToast('تم اعتماد القيد بنجاح');
  };

  const rejectEntry = async (entry: JournalEntry, comment: string) => {
    const updated: JournalEntry = {
      ...entry, status: 'Draft',
      approval_history: [...entry.approval_history, {
        id: uid(), action: 'rejected', performed_by: user.name, performed_at: new Date().toISOString(), comment,
      }],
    };
    await saveEntry(updated);
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
    showToast('تم رد القيد للمحاسب', 'error');
  };

  const postEntry = async (entry: JournalEntry) => {
    if (entry.status !== 'Approved') { showToast('لا يمكن ترحيل القيد قبل الاعتماد', 'error'); return; }
    if (!isBalanced(entry.lines)) { showToast('القيد غير متوازن', 'error'); return; }
    const updated: JournalEntry = {
      ...entry, status: 'Posted',
      posting_date: entry.posting_date || new Date().toISOString().split('T')[0],
      posted_by: user.name, posted_at: new Date().toISOString(),
      approval_history: [...entry.approval_history, {
        id: uid(), action: 'posted', performed_by: user.name, performed_at: new Date().toISOString(),
      }],
    };
    await saveEntry(updated);
    setEntries(prev => prev.map(e => e.id === updated.id ? updated : e));
    showToast('تم ترحيل القيد بنجاح');
  };

  const executeReversal = async () => {
    if (!reversalEntry) return;
    if (!reversalDate) { showToast('يجب تحديد تاريخ القيد العكسي', 'error'); return; }
    const reversedOriginal: JournalEntry = {
      ...reversalEntry, status: 'Reversed',
      approval_history: [...reversalEntry.approval_history, {
        id: uid(), action: 'reversed', performed_by: user.name, performed_at: new Date().toISOString(), comment: reversalReason,
      }],
    };
    const reversalNew: JournalEntry = {
      id: uid(),
      journal_number: nextJournalNumber([...entries, reversedOriginal]),
      entry_type: 'قيد عكسي',
      source_module: 'المحاسبة العامة',
      reversal_of_entry_id: reversalEntry.id,
      reference_no: `REV-${reversalEntry.journal_number}`,
      entry_date: reversalDate,
      posting_date: reversalDate,
      fiscal_period: currentPeriod(),
      currency: reversalEntry.currency,
      exchange_rate: reversalEntry.exchange_rate,
      description: `قيد عكسي للقيد ${reversalEntry.journal_number}${reversalReason ? ' — ' + reversalReason : ''}`,
      status: 'Posted',
      auto_generated_flag: false,
      created_by: user.name,
      created_at: new Date().toISOString(),
      approved_by: user.name, approved_at: new Date().toISOString(),
      posted_by: user.name, posted_at: new Date().toISOString(),
      lines: reversalEntry.lines.map(l => ({
        ...l, debit_amount: l.credit_amount, credit_amount: l.debit_amount,
        line_description: `عكس: ${l.line_description}`,
      })),
      approval_history: [
        { id: uid(), action: 'submitted', performed_by: user.name, performed_at: new Date().toISOString() },
        { id: uid(), action: 'posted', performed_by: user.name, performed_at: new Date().toISOString(), comment: reversalReason },
      ],
      attachments: [],
    };
    const updated = entries.map(e => e.id === reversedOriginal.id ? reversedOriginal : e);
    updated.unshift(reversalNew);
    await persist(updated);
    setReversalEntry(null);
    setReversalReason('');
    showToast(`تم إنشاء القيد العكسي ${reversalNew.journal_number} بنجاح`);
    setScreen('list');
  };

  // ── Line editing helpers ─────────────────────────────────────────────

  const updateLine = (lineNo: number, field: keyof JournalEntryLine, value: string | number) => {
    if (!editEntry) return;
    setEditEntry({
      ...editEntry,
      lines: editEntry.lines.map(l =>
        l.line_no === lineNo ? { ...l, [field]: value } : l
      ),
    });
  };

  const addLine = () => {
    if (!editEntry) return;
    const maxNo = Math.max(...editEntry.lines.map(l => l.line_no), 0);
    setEditEntry({ ...editEntry, lines: [...editEntry.lines, emptyLine(maxNo + 1)] });
  };

  const removeLine = (lineNo: number) => {
    if (!editEntry || editEntry.lines.length <= 2) return;
    setEditEntry({ ...editEntry, lines: editEntry.lines.filter(l => l.line_no !== lineNo) });
  };

  const selectAccount = (account: ChartOfAccount) => {
    if (!editEntry) return;
    updateLine(accountTargetLineNo, 'account_code', account.code);
    setEditEntry(prev => prev ? {
      ...prev,
      lines: prev.lines.map(l =>
        l.line_no === accountTargetLineNo ? { ...l, account_code: account.code, account_name: account.name } : l
      ),
    } : prev);
    setAccountSearchOpen(false);
  };

  // ─── Screens ──────────────────────────────────────────────────────────────

  const openCreate = () => {
    setEditEntry(emptyEntry(entries, user));
    setScreen('create');
  };

  const openEdit = (entry: JournalEntry) => {
    setEditEntry({ ...entry, lines: entry.lines.map(l => ({ ...l })) });
    setScreen('edit');
  };

  const openDetails = (entry: JournalEntry) => {
    setSelectedEntry(entry);
    setScreen('details');
  };

  const openReversal = (entry: JournalEntry) => {
    setReversalEntry(entry);
    setReversalDate(new Date().toISOString().split('T')[0]);
    setReversalReason('');
    setScreen('reversal');
  };

  // ─── RENDER: Dashboard ────────────────────────────────────────────────────

  const renderDashboard = () => (
    <div className="space-y-6" dir="rtl">
      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'مسودات', value: kpis.draft, icon: 'edit_note', color: 'text-gray-400', bg: 'bg-gray-800' },
          { label: 'بانتظار الاعتماد', value: kpis.pending, icon: 'pending_actions', color: 'text-yellow-400', bg: 'bg-yellow-900/20' },
          { label: 'مُرحَّل هذا الشهر', value: kpis.postedThisMonth, icon: 'check_circle', color: 'text-green-400', bg: 'bg-green-900/20' },
          { label: 'معكوس هذا الشهر', value: kpis.reversedThisMonth, icon: 'undo', color: 'text-purple-400', bg: 'bg-purple-900/20' },
          { label: 'مسودات غير متوازنة', value: kpis.unbalanced, icon: 'error_outline', color: 'text-red-400', bg: 'bg-red-900/20' },
          { label: 'إجمالي المُرحَّل', value: kpis.totalPosted, icon: 'library_books', color: 'text-blue-400', bg: 'bg-blue-900/20' },
          { label: 'قيود تلقائية', value: kpis.autoGenerated, icon: 'auto_awesome', color: 'text-cyan-400', bg: 'bg-cyan-900/20' },
          { label: 'قيود يدوية', value: kpis.manualEntries, icon: 'create', color: 'text-orange-400', bg: 'bg-orange-900/20' },
        ].map(k => (
          <div key={k.label} className={`${k.bg} rounded-xl p-4 border border-gray-700/50`}>
            <div className="flex items-center justify-between mb-2">
              <span className={`material-icons ${k.color}`}>{k.icon}</span>
              <span className={`text-2xl font-bold ${k.color}`}>{k.value}</span>
            </div>
            <p className="text-xs text-gray-400">{k.label}</p>
          </div>
        ))}
      </div>

      {/* Source module breakdown */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
          <h3 className="text-sm font-bold text-white mb-4">توزيع القيود حسب المصدر</h3>
          <div className="space-y-3">
            {(['يدوي', 'التحصيلات', 'المدفوعات', 'المحاسبة العامة'] as SourceModule[]).map(src => {
              const count = entries.filter(e => e.source_module === src).length;
              const pct = entries.length ? Math.round(count / entries.length * 100) : 0;
              return (
                <div key={src}>
                  <div className="flex justify-between text-xs text-gray-400 mb-1">
                    <span>{src}</span><span>{count} قيد ({pct}%)</span>
                  </div>
                  <div className="h-1.5 rounded-full bg-gray-700">
                    <div className="h-1.5 rounded-full bg-primary transition-all" style={{ width: `${pct}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
          <h3 className="text-sm font-bold text-white mb-4">آخر القيود اليدوية</h3>
          <div className="space-y-2">
            {entries.filter(e => !e.auto_generated_flag).slice(0, 5).map(e => (
              <button
                key={e.id}
                onClick={() => openDetails(e)}
                className="w-full flex items-center justify-between text-xs p-2 hover:bg-gray-700/50 rounded-lg transition-colors"
              >
                <div className="flex items-center gap-2">
                  <span className="text-gray-500 font-mono">{e.journal_number}</span>
                  <span className="text-gray-300 truncate max-w-[180px]">{e.description}</span>
                </div>
                <StatusBadge status={e.status} />
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div className="flex gap-3 flex-wrap">
        <button onClick={openCreate}
          className="flex items-center gap-2 px-4 py-2.5 bg-primary text-white rounded-lg hover:bg-primary/90 text-sm font-medium transition-colors">
          <span className="material-icons text-base">add</span>قيد محاسبي جديد
        </button>
        <button onClick={() => setScreen('list')}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#1e2736] text-gray-300 rounded-lg hover:bg-gray-700 text-sm font-medium border border-gray-600 transition-colors">
          <span className="material-icons text-base">list</span>قائمة القيود
        </button>
        <button onClick={() => setScreen('approval-inbox')}
          className="flex items-center gap-2 px-4 py-2.5 bg-yellow-900/40 text-yellow-300 rounded-lg hover:bg-yellow-900/60 text-sm font-medium border border-yellow-700/50 transition-colors">
          <span className="material-icons text-base">inbox</span>
          صندوق الاعتماد {kpis.pending > 0 && <span className="bg-yellow-500 text-black rounded-full w-5 h-5 flex items-center justify-center text-xs font-bold">{kpis.pending}</span>}
        </button>
        <button onClick={() => { resetImport(); setScreen('bank-import'); }}
          className="flex items-center gap-2 px-4 py-2.5 bg-teal-900/40 text-teal-300 rounded-lg hover:bg-teal-900/60 text-sm font-medium border border-teal-700/50 transition-colors">
          <span className="material-icons text-base">account_balance</span>استيراد كشف بنكي
        </button>
      </div>

      {/* Recent entries table */}
      <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-700/50 flex items-center justify-between">
          <h3 className="text-sm font-bold text-white">آخر القيود المحاسبية</h3>
          <button onClick={() => setScreen('list')} className="text-xs text-primary hover:text-primary/80">عرض الكل</button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#161d2b]">
              <tr>
                <Th>رقم القيد</Th><Th>التاريخ</Th><Th>النوع</Th>
                <Th>المصدر</Th><Th>الوصف</Th>
                <Th className="text-left">إجمالي مدين</Th>
                <Th className="text-left">إجمالي دائن</Th>
                <Th>الحالة</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {entries.slice(0, 8).map(e => {
                const td = totalDebit(e.lines); const tc = totalCredit(e.lines);
                return (
                  <tr key={e.id} onClick={() => openDetails(e)} className="hover:bg-gray-700/30 cursor-pointer transition-colors">
                    <Td><span className="font-mono text-xs text-primary">{e.journal_number}</span></Td>
                    <Td>{e.entry_date}</Td>
                    <Td><span className="text-xs text-gray-300">{e.entry_type}</span></Td>
                    <Td><SourceBadge src={e.source_module} /></Td>
                    <Td><span className="truncate max-w-[200px] block text-xs">{e.description}</span></Td>
                    <Td className="text-left font-mono text-green-400">{fmt(td)}</Td>
                    <Td className="text-left font-mono text-red-400">{fmt(tc)}</Td>
                    <Td><StatusBadge status={e.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: List ─────────────────────────────────────────────────────────

  const renderList = () => (
    <div className="space-y-4" dir="rtl">
      {/* Filters */}
      <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-4">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary focus:border-primary">
            <option value="">كل الحالات</option>
            {(['Draft','Pending Approval','Approved','Posted','Reversed','Cancelled'] as JEStatus[]).map(s =>
              <option key={s} value={s}>{STATUS_AR[s]}</option>)}
          </select>
          <select value={filterSource} onChange={e => setFilterSource(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
            <option value="">كل المصادر</option>
            {(['يدوي','التحصيلات','المدفوعات','المحاسبة العامة'] as SourceModule[]).map(s =>
              <option key={s} value={s}>{s}</option>)}
          </select>
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
            <option value="">كل الأنواع</option>
            {Object.keys(TYPE_AR).map(t =>
              <option key={t} value={t}>{t}</option>)}
          </select>
          <select value={filterPeriod} onChange={e => setFilterPeriod(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
            <option value="">كل الفترات</option>
            {ACCOUNTING_PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
          <input value={filterRef} onChange={e => setFilterRef(e.target.value)} placeholder="رقم مرجعي / رقم قيد"
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
          <input value={filterCreatedBy} onChange={e => setFilterCreatedBy(e.target.value)} placeholder="أُنشئ بواسطة"
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
          <input type="date" value={filterDateFrom} onChange={e => setFilterDateFrom(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
          <input type="date" value={filterDateTo} onChange={e => setFilterDateTo(e.target.value)}
            className="bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
            <span className="material-icons text-base">add</span>قيد جديد
          </button>
          <button onClick={() => { setFilterStatus(''); setFilterSource(''); setFilterType(''); setFilterPeriod(''); setFilterRef(''); setFilterCreatedBy(''); setFilterDateFrom(''); setFilterDateTo(''); }}
            className="flex items-center gap-1.5 px-3 py-2 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors">
            <span className="material-icons text-base">clear</span>مسح الفلاتر
          </button>
          <span className="mr-auto text-xs text-gray-500 self-center">{filteredEntries.length} قيد</span>
        </div>
      </div>

      {/* Table */}
      <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-[#161d2b]">
              <tr>
                <Th>رقم القيد</Th><Th>تاريخ القيد</Th><Th>تاريخ الترحيل</Th>
                <Th>النوع</Th><Th>المصدر</Th><Th>رقم مرجعي</Th>
                <Th className="min-w-[200px]">الوصف</Th>
                <Th className="text-left">مدين</Th><Th className="text-left">دائن</Th>
                <Th>الحالة</Th><Th>أُنشئ بواسطة</Th><Th>إجراءات</Th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-700/50">
              {filteredEntries.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-8 text-center text-gray-500 text-sm">لا توجد قيود مطابقة للفلاتر</td></tr>
              )}
              {filteredEntries.map(e => {
                const td = totalDebit(e.lines); const tc = totalCredit(e.lines);
                return (
                  <tr key={e.id} className="hover:bg-gray-700/20 transition-colors">
                    <Td>
                      <button onClick={() => openDetails(e)} className="font-mono text-xs text-primary hover:text-primary/80 font-semibold">
                        {e.journal_number}
                      </button>
                    </Td>
                    <Td>{e.entry_date}</Td>
                    <Td className="text-gray-500">{e.posting_date || '—'}</Td>
                    <Td><span className="text-xs">{e.entry_type}</span></Td>
                    <Td><SourceBadge src={e.source_module} /></Td>
                    <Td><span className="text-xs text-gray-400">{e.reference_no || '—'}</span></Td>
                    <Td><span className="text-xs block max-w-[200px] truncate">{e.description}</span></Td>
                    <Td className="text-left font-mono text-green-400 text-xs">{fmt(td)}</Td>
                    <Td className="text-left font-mono text-red-400 text-xs">{fmt(tc)}</Td>
                    <Td><StatusBadge status={e.status} /></Td>
                    <Td><span className="text-xs text-gray-500">{e.created_by}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <button onClick={() => openDetails(e)} title="عرض" className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white transition-colors">
                          <span className="material-icons text-base">visibility</span>
                        </button>
                        {e.status === 'Draft' && (
                          <button onClick={() => openEdit(e)} title="تعديل" className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white transition-colors">
                            <span className="material-icons text-base">edit</span>
                          </button>
                        )}
                        {e.status === 'Draft' && isBalanced(e.lines) && (
                          <button onClick={() => submitEntry(e)} title="إرسال للاعتماد" className="p-1 hover:bg-yellow-900/50 rounded text-yellow-400 transition-colors">
                            <span className="material-icons text-base">send</span>
                          </button>
                        )}
                        {e.status === 'Approved' && (
                          <button onClick={() => postEntry(e)} title="ترحيل" className="p-1 hover:bg-green-900/50 rounded text-green-400 transition-colors">
                            <span className="material-icons text-base">publish</span>
                          </button>
                        )}
                        {e.status === 'Posted' && (
                          <button onClick={() => openReversal(e)} title="عكس القيد" className="p-1 hover:bg-purple-900/50 rounded text-purple-400 transition-colors">
                            <span className="material-icons text-base">undo</span>
                          </button>
                        )}
                      </div>
                    </Td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  // ─── RENDER: Create / Edit Form ───────────────────────────────────────────

  const renderForm = () => {
    if (!editEntry) return null;
    const td = totalDebit(editEntry.lines);
    const tc = totalCredit(editEntry.lines);
    const balanced = isBalanced(editEntry.lines);
    const canSave = editEntry.description.trim() && editEntry.entry_date;

    const handleSaveAsDraft = async () => {
      if (!canSave) { showToast('يجب تعبئة الوصف وتاريخ القيد', 'error'); return; }
      const draft = { ...editEntry, status: 'Draft' as JEStatus };
      await saveEntry(draft);
      showToast('تم حفظ المسودة بنجاح');
      setScreen('list');
    };

    const handleSubmitForApproval = async () => {
      if (!canSave) { showToast('يجب تعبئة الوصف وتاريخ القيد', 'error'); return; }
      await submitEntry(editEntry);
    };

    return (
      <div className="space-y-5" dir="rtl">
        {/* Header Section */}
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="material-icons text-primary text-base">article</span>بيانات القيد الرئيسية
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs text-gray-400 mb-1">رقم القيد</label>
              <input value={editEntry.journal_number} readOnly
                className="w-full bg-gray-700/40 border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-400 font-mono" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">نوع القيد <span className="text-red-400">*</span></label>
              <select value={editEntry.entry_type}
                onChange={e => setEditEntry({ ...editEntry, entry_type: e.target.value as JEType })}
                disabled={editEntry.auto_generated_flag}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary disabled:opacity-50">
                {Object.keys(TYPE_AR).map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">تاريخ القيد <span className="text-red-400">*</span></label>
              <input type="date" value={editEntry.entry_date}
                onChange={e => setEditEntry({ ...editEntry, entry_date: e.target.value })}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">تاريخ الترحيل</label>
              <input type="date" value={editEntry.posting_date}
                onChange={e => setEditEntry({ ...editEntry, posting_date: e.target.value })}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">الفترة المحاسبية</label>
              <select value={editEntry.fiscal_period}
                onChange={e => setEditEntry({ ...editEntry, fiscal_period: e.target.value })}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                {ACCOUNTING_PERIODS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">العملة</label>
              <select value={editEntry.currency}
                onChange={e => setEditEntry({ ...editEntry, currency: e.target.value as Currency })}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                <option value="EGP">جنيه مصري (EGP)</option>
                <option value="USD">دولار أمريكي (USD)</option>
              </select>
            </div>
            {editEntry.currency === 'USD' && (
              <div>
                <label className="block text-xs text-gray-400 mb-1">سعر الصرف</label>
                <input type="number" step="0.01" value={editEntry.exchange_rate || ''}
                  onChange={e => setEditEntry({ ...editEntry, exchange_rate: parseFloat(e.target.value) || undefined })}
                  className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-400 mb-1">الرقم المرجعي</label>
              <input value={editEntry.reference_no || ''}
                onChange={e => setEditEntry({ ...editEntry, reference_no: e.target.value })}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
            </div>
            <div className="md:col-span-2">
              <label className="block text-xs text-gray-400 mb-1">الوصف <span className="text-red-400">*</span></label>
              <input value={editEntry.description}
                onChange={e => setEditEntry({ ...editEntry, description: e.target.value })}
                placeholder="وصف القيد المحاسبي..."
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
            </div>
          </div>
        </div>

        {/* Lines Grid */}
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <span className="material-icons text-primary text-base">table_rows</span>سطور القيد
            </h3>
            <BalanceBadge lines={editEntry.lines} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#161d2b]">
                <tr>
                  <Th className="w-10">#</Th>
                  <Th className="min-w-[160px]">كود الحساب</Th>
                  <Th className="min-w-[180px]">اسم الحساب</Th>
                  <Th className="min-w-[120px]">مركز التكلفة</Th>
                  <Th className="min-w-[200px]">البيان</Th>
                  <Th className="min-w-[130px] text-left">مدين</Th>
                  <Th className="min-w-[130px] text-left">دائن</Th>
                  <Th className="w-10"></Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {editEntry.lines.map(line => (
                  <tr key={line.line_no} className="hover:bg-gray-700/10">
                    <Td><span className="text-gray-500 text-xs">{line.line_no}</span></Td>
                    <Td>
                      <div className="flex items-center gap-1">
                        <input value={line.account_code} readOnly
                          className="w-20 bg-gray-700/40 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 font-mono" />
                        <button onClick={() => { setAccountTargetLineNo(line.line_no); setAccountSearchQuery(''); setAccountSearchOpen(true); }}
                          className="p-1 hover:bg-primary/20 rounded text-primary transition-colors">
                          <span className="material-icons text-sm">search</span>
                        </button>
                      </div>
                    </Td>
                    <Td>
                      <input value={line.account_name} readOnly
                        className="w-full bg-gray-700/40 border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 min-w-[160px]" />
                    </Td>
                    <Td>
                      <input value={line.cost_center || ''}
                        onChange={e => updateLine(line.line_no, 'cost_center', e.target.value)}
                        placeholder="اختياري"
                        className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-1 focus:ring-primary" />
                    </Td>
                    <Td>
                      <input value={line.line_description}
                        onChange={e => updateLine(line.line_no, 'line_description', e.target.value)}
                        placeholder="بيان السطر"
                        className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-1 focus:ring-primary min-w-[180px]" />
                    </Td>
                    <Td>
                      <input type="number" min="0" step="0.01" value={line.debit_amount || ''}
                        onChange={e => updateLine(line.line_no, 'debit_amount', parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-green-300 text-left font-mono focus:ring-1 focus:ring-primary" />
                    </Td>
                    <Td>
                      <input type="number" min="0" step="0.01" value={line.credit_amount || ''}
                        onChange={e => updateLine(line.line_no, 'credit_amount', parseFloat(e.target.value) || 0)}
                        className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-red-300 text-left font-mono focus:ring-1 focus:ring-primary" />
                    </Td>
                    <Td>
                      <button onClick={() => removeLine(line.line_no)} disabled={editEntry.lines.length <= 2}
                        className="p-1 hover:bg-red-900/40 rounded text-red-400 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
                        <span className="material-icons text-sm">delete_outline</span>
                      </button>
                    </Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#161d2b]">
                <tr>
                  <td colSpan={5} className="px-3 py-2.5 text-right">
                    <button onClick={addLine}
                      className="flex items-center gap-1 text-xs text-primary hover:text-primary/80 transition-colors">
                      <span className="material-icons text-sm">add_circle_outline</span>إضافة سطر
                    </button>
                  </td>
                  <td className="px-3 py-2.5 font-mono font-bold text-green-400 text-left text-sm">{fmt(td)}</td>
                  <td className="px-3 py-2.5 font-mono font-bold text-red-400 text-left text-sm">{fmt(tc)}</td>
                  <td></td>
                </tr>
                {!balanced && (
                  <tr>
                    <td colSpan={8} className="px-3 py-2 bg-red-900/20">
                      <span className="text-xs text-red-400 flex items-center gap-1">
                        <span className="material-icons text-sm">warning</span>
                        الفرق: {fmt(Math.abs(td - tc))} — يجب أن يكون إجمالي المدين مساوياً لإجمالي الدائن
                      </span>
                    </td>
                  </tr>
                )}
              </tfoot>
            </table>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-3 flex-wrap">
          <button onClick={handleSaveAsDraft} disabled={!canSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 text-white rounded-lg hover:bg-gray-600 text-sm font-medium transition-colors disabled:opacity-50">
            <span className="material-icons text-base">save</span>حفظ كمسودة
          </button>
          <button onClick={handleSubmitForApproval} disabled={!balanced || !canSave}
            className="flex items-center gap-2 px-4 py-2.5 bg-yellow-600 text-white rounded-lg hover:bg-yellow-500 text-sm font-medium transition-colors disabled:opacity-50">
            <span className="material-icons text-base">send</span>إرسال للاعتماد
          </button>
          <button onClick={() => setScreen('list')}
            className="flex items-center gap-2 px-4 py-2.5 bg-transparent text-gray-400 hover:text-white rounded-lg text-sm transition-colors border border-gray-600 hover:border-gray-400">
            <span className="material-icons text-base">close</span>إلغاء
          </button>
        </div>
      </div>
    );
  };

  // ─── RENDER: Details ──────────────────────────────────────────────────────

  const renderDetails = () => {
    const e = selectedEntry;
    if (!e) return null;
    const td = totalDebit(e.lines); const tc = totalCredit(e.lines);

    const actionHistory: Record<ApprovalHistoryItem['action'], string> = {
      submitted: 'تم الإرسال للاعتماد',
      approved: 'تم الاعتماد',
      rejected: 'تم الرد',
      posted: 'تم الترحيل',
      reversed: 'تم العكس',
    };

    return (
      <div className="space-y-5" dir="rtl">
        {/* Header info */}
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-3">
                <h2 className="text-lg font-bold text-white font-mono">{e.journal_number}</h2>
                <StatusBadge status={e.status} />
                <SourceBadge src={e.source_module} />
                {e.auto_generated_flag && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs bg-cyan-900/40 text-cyan-300">
                    <span className="material-icons text-xs">auto_awesome</span>تلقائي
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400 mt-1">{e.description}</p>
            </div>
            <div className="flex items-center gap-2">
              {e.status === 'Draft' && (
                <button onClick={() => openEdit(e)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-gray-700 text-white rounded-lg text-xs hover:bg-gray-600 transition-colors">
                  <span className="material-icons text-sm">edit</span>تعديل
                </button>
              )}
              {e.status === 'Draft' && isBalanced(e.lines) && (
                <button onClick={() => submitEntry(e)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-yellow-600 text-white rounded-lg text-xs hover:bg-yellow-500 transition-colors">
                  <span className="material-icons text-sm">send</span>إرسال للاعتماد
                </button>
              )}
              {e.status === 'Pending Approval' && (
                <>
                  <button onClick={() => { setApprovalAction('approve'); setApprovalComment(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs hover:bg-green-600 transition-colors">
                    <span className="material-icons text-sm">check</span>اعتماد
                  </button>
                  <button onClick={() => { setApprovalAction('reject'); setApprovalComment(''); }}
                    className="flex items-center gap-1 px-3 py-1.5 bg-red-700 text-white rounded-lg text-xs hover:bg-red-600 transition-colors">
                    <span className="material-icons text-sm">close</span>رد
                  </button>
                </>
              )}
              {e.status === 'Approved' && (
                <button onClick={() => postEntry(e)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-green-700 text-white rounded-lg text-xs hover:bg-green-600 transition-colors">
                  <span className="material-icons text-sm">publish</span>ترحيل
                </button>
              )}
              {e.status === 'Posted' && (
                <button onClick={() => openReversal(e)}
                  className="flex items-center gap-1 px-3 py-1.5 bg-purple-700 text-white rounded-lg text-xs hover:bg-purple-600 transition-colors">
                  <span className="material-icons text-sm">undo</span>عكس القيد
                </button>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { label: 'نوع القيد', value: e.entry_type },
              { label: 'تاريخ القيد', value: e.entry_date },
              { label: 'تاريخ الترحيل', value: e.posting_date || '—' },
              { label: 'الفترة المحاسبية', value: ACCOUNTING_PERIODS.find(p => p.id === e.fiscal_period)?.label || e.fiscal_period },
              { label: 'العملة', value: e.currency + (e.exchange_rate ? ` (1 USD = ${e.exchange_rate} EGP)` : '') },
              { label: 'الرقم المرجعي', value: e.reference_no || '—' },
              { label: 'رقم المستند المصدر', value: e.source_document_no || '—' },
              { label: 'أُنشئ بواسطة', value: e.created_by },
              { label: 'تاريخ الإنشاء', value: new Date(e.created_at).toLocaleString('ar-EG') },
              { label: 'معتمد بواسطة', value: e.approved_by || '—' },
              { label: 'مُرحَّل بواسطة', value: e.posted_by || '—' },
              { label: 'تاريخ الترحيل الفعلي', value: e.posted_at ? new Date(e.posted_at).toLocaleString('ar-EG') : '—' },
            ].map(f => (
              <div key={f.label}>
                <p className="text-xs text-gray-500">{f.label}</p>
                <p className="text-sm text-gray-200 mt-0.5">{f.value}</p>
              </div>
            ))}
          </div>

          {/* Approval action modal inline */}
          {approvalAction && (
            <div className="mt-4 p-4 bg-gray-800/70 rounded-lg border border-gray-600">
              <p className="text-sm text-white font-medium mb-2">
                {approvalAction === 'approve' ? 'اعتماد القيد' : 'رد القيد'}
              </p>
              <textarea value={approvalComment} onChange={e2 => setApprovalComment(e2.target.value)}
                placeholder="تعليق (اختياري)" rows={2}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary mb-3" />
              <div className="flex gap-2">
                <button onClick={async () => {
                  if (approvalAction === 'approve') {
                    await approveEntry(e, approvalComment);
                    setSelectedEntry(prev => prev ? { ...prev, status: 'Approved', approved_by: user.name, approved_at: new Date().toISOString() } : null);
                  } else {
                    await rejectEntry(e, approvalComment);
                    setSelectedEntry(prev => prev ? { ...prev, status: 'Draft' } : null);
                  }
                  setApprovalAction(null);
                }}
                  className={`px-4 py-2 rounded-lg text-sm text-white font-medium transition-colors ${approvalAction === 'approve' ? 'bg-green-700 hover:bg-green-600' : 'bg-red-700 hover:bg-red-600'}`}>
                  تأكيد
                </button>
                <button onClick={() => setApprovalAction(null)}
                  className="px-4 py-2 rounded-lg text-sm text-gray-400 bg-gray-700 hover:bg-gray-600 transition-colors">
                  إلغاء
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Lines table */}
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-700/50 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">سطور القيد المحاسبي</h3>
            <BalanceBadge lines={e.lines} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-[#161d2b]">
                <tr>
                  <Th>#</Th><Th>كود</Th><Th>اسم الحساب</Th>
                  <Th>مركز التكلفة</Th><Th>البيان</Th>
                  <Th className="text-left">مدين</Th>
                  <Th className="text-left">دائن</Th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700/50">
                {e.lines.map(l => (
                  <tr key={l.line_no} className="hover:bg-gray-700/10">
                    <Td><span className="text-gray-500 text-xs">{l.line_no}</span></Td>
                    <Td><span className="font-mono text-xs text-primary">{l.account_code}</span></Td>
                    <Td><span className="text-sm text-gray-200">{l.account_name}</span></Td>
                    <Td><span className="text-xs text-gray-400">{l.cost_center || '—'}</span></Td>
                    <Td><span className="text-xs">{l.line_description}</span></Td>
                    <Td className="text-left font-mono text-green-400 text-xs">{l.debit_amount > 0 ? fmt(l.debit_amount) : '—'}</Td>
                    <Td className="text-left font-mono text-red-400 text-xs">{l.credit_amount > 0 ? fmt(l.credit_amount) : '—'}</Td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-[#161d2b]">
                <tr>
                  <td colSpan={5} className="px-3 py-2.5 text-right text-xs font-bold text-gray-400">الإجمالي</td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold text-green-400">{fmt(td)}</td>
                  <td className="px-3 py-2.5 text-left font-mono font-bold text-red-400">{fmt(tc)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Audit Trail */}
        <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
          <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
            <span className="material-icons text-primary text-base">history</span>سجل المراجعة والاعتماد
          </h3>
          {e.approval_history.length === 0 ? (
            <p className="text-sm text-gray-500">لا يوجد سجل بعد</p>
          ) : (
            <div className="space-y-2">
              {e.approval_history.map((h, i) => (
                <div key={h.id} className="flex items-start gap-3">
                  <div className="flex flex-col items-center">
                    <div className={`w-2 h-2 rounded-full mt-1.5 ${
                      h.action === 'posted' ? 'bg-green-400' :
                      h.action === 'approved' ? 'bg-blue-400' :
                      h.action === 'rejected' ? 'bg-red-400' :
                      h.action === 'reversed' ? 'bg-purple-400' : 'bg-yellow-400'
                    }`} />
                    {i < e.approval_history.length - 1 && <div className="w-px flex-1 bg-gray-700 min-h-[16px]" />}
                  </div>
                  <div className="flex-1 pb-2">
                    <p className="text-xs text-white font-medium">{actionHistory[h.action]}</p>
                    <p className="text-xs text-gray-400">{h.performed_by} · {new Date(h.performed_at).toLocaleString('ar-EG')}</p>
                    {h.comment && <p className="text-xs text-gray-500 mt-0.5 italic">"{h.comment}"</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Attachments */}
        {e.attachments.length > 0 && (
          <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
            <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
              <span className="material-icons text-primary text-base">attach_file</span>المرفقات
            </h3>
            <div className="space-y-2">
              {e.attachments.map((a, i) => (
                <div key={i} className="flex items-center gap-2 p-2 bg-gray-700/40 rounded-lg">
                  <span className="material-icons text-gray-400 text-base">description</span>
                  <span className="text-sm text-gray-300">{a.name}</span>
                  <span className="text-xs text-gray-500 mr-auto">{a.size}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Reversal link */}
        {e.reversal_of_entry_id && (
          <div className="bg-purple-900/20 border border-purple-700/40 rounded-xl p-4 flex items-center gap-3">
            <span className="material-icons text-purple-400">undo</span>
            <div>
              <p className="text-sm text-purple-300 font-medium">هذا قيد عكسي</p>
              <p className="text-xs text-gray-400">
                عكس للقيد: {entries.find(x => x.id === e.reversal_of_entry_id)?.journal_number || e.reversal_of_entry_id}
                <button
                  onClick={() => {
                    const orig = entries.find(x => x.id === e.reversal_of_entry_id);
                    if (orig) openDetails(orig);
                  }}
                  className="mr-2 text-primary hover:text-primary/80 text-xs underline">
                  عرض القيد الأصلي
                </button>
              </p>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── RENDER: Approval Inbox ───────────────────────────────────────────────

  const renderApprovalInbox = () => {
    const pending = entries.filter(e => e.status === 'Pending Approval');
    return (
      <div className="space-y-4" dir="rtl">
        <div className="bg-yellow-900/20 border border-yellow-700/40 rounded-xl p-4 flex items-center gap-3">
          <span className="material-icons text-yellow-400">inbox</span>
          <div>
            <p className="text-sm font-bold text-yellow-300">صندوق الاعتماد</p>
            <p className="text-xs text-gray-400">{pending.length} قيد بانتظار المراجعة والاعتماد</p>
          </div>
        </div>

        {pending.length === 0 ? (
          <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-12 text-center">
            <span className="material-icons text-4xl text-gray-600">check_circle</span>
            <p className="text-gray-500 mt-2">لا توجد قيود بانتظار الاعتماد</p>
          </div>
        ) : (
          <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="bg-[#161d2b]">
                  <tr>
                    <Th>رقم القيد</Th><Th>التاريخ</Th><Th>النوع</Th>
                    <Th>الوصف</Th>
                    <Th className="text-left">المبلغ</Th>
                    <Th>أُنشئ بواسطة</Th><Th>إجراءات</Th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-700/50">
                  {pending.map(e => {
                    const td = totalDebit(e.lines);
                    return (
                      <tr key={e.id} className="hover:bg-gray-700/20 transition-colors">
                        <Td>
                          <button onClick={() => openDetails(e)} className="font-mono text-xs text-primary font-semibold hover:text-primary/80">
                            {e.journal_number}
                          </button>
                        </Td>
                        <Td>{e.entry_date}</Td>
                        <Td><span className="text-xs">{e.entry_type}</span></Td>
                        <Td><span className="text-xs max-w-[200px] truncate block">{e.description}</span></Td>
                        <Td className="text-left font-mono text-sm">{fmt(td)} {e.currency}</Td>
                        <Td><span className="text-xs text-gray-400">{e.created_by}</span></Td>
                        <Td>
                          <div className="flex items-center gap-1">
                            <button onClick={() => openDetails(e)}
                              className="p-1 hover:bg-gray-600 rounded text-gray-400 hover:text-white transition-colors" title="عرض">
                              <span className="material-icons text-base">visibility</span>
                            </button>
                            <button onClick={async () => { await approveEntry(e); }}
                              className="p-1 hover:bg-green-900/50 rounded text-green-400 transition-colors" title="اعتماد">
                              <span className="material-icons text-base">check_circle</span>
                            </button>
                            <button onClick={async () => { await rejectEntry(e, 'يحتاج مراجعة'); }}
                              className="p-1 hover:bg-red-900/50 rounded text-red-400 transition-colors" title="رد">
                              <span className="material-icons text-base">cancel</span>
                            </button>
                            <button onClick={() => postEntry(e)}
                              className="px-2 py-1 bg-green-900/40 text-green-300 rounded text-xs hover:bg-green-900/60 transition-colors">
                              اعتماد وترحيل
                            </button>
                          </div>
                        </Td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── RENDER: Reversal ─────────────────────────────────────────────────────

  const renderReversal = () => {
    const e = reversalEntry;
    if (!e) return null;
    return (
      <div className="max-w-2xl" dir="rtl">
        <div className="bg-[#1e2736] rounded-xl border border-purple-700/40 p-6">
          <div className="flex items-center gap-3 mb-6">
            <div className="w-10 h-10 rounded-full bg-purple-900/50 flex items-center justify-center">
              <span className="material-icons text-purple-400">undo</span>
            </div>
            <div>
              <h3 className="text-base font-bold text-white">عكس القيد المحاسبي</h3>
              <p className="text-xs text-gray-400">{e.journal_number} — {e.description}</p>
            </div>
          </div>

          <div className="space-y-4">
            <div className="bg-gray-800/50 rounded-lg p-3">
              <p className="text-xs text-gray-400 mb-2">سيتم إنشاء القيد العكسي التالي تلقائياً:</p>
              <div className="space-y-1">
                {e.lines.map(l => (
                  <div key={l.line_no} className="flex justify-between text-xs">
                    <span className="text-gray-300">{l.account_name}</span>
                    <div className="flex gap-6">
                      <span className="text-green-400 font-mono w-24 text-left">{l.credit_amount > 0 ? fmt(l.credit_amount) : '—'}</span>
                      <span className="text-red-400 font-mono w-24 text-left">{l.debit_amount > 0 ? fmt(l.debit_amount) : '—'}</span>
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-400 mb-1">تاريخ القيد العكسي <span className="text-red-400">*</span></label>
              <input type="date" value={reversalDate} onChange={e2 => setReversalDate(e2.target.value)}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-gray-400 mb-1">سبب العكس</label>
              <textarea value={reversalReason} onChange={e2 => setReversalReason(e2.target.value)}
                placeholder="اذكر سبب عكس هذا القيد..."
                rows={3}
                className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-purple-500" />
            </div>

            <div className="bg-amber-900/20 border border-amber-700/40 rounded-lg p-3">
              <p className="text-xs text-amber-300 flex items-center gap-1">
                <span className="material-icons text-sm">warning</span>
                تنبيه: لا يمكن التراجع عن هذا الإجراء. سيتم تحديد القيد الأصلي كـ "معكوس" وإنشاء قيد عكسي جديد.
              </p>
            </div>

            <div className="flex gap-3">
              <button onClick={executeReversal}
                className="flex items-center gap-2 px-4 py-2.5 bg-purple-700 text-white rounded-lg hover:bg-purple-600 text-sm font-medium transition-colors">
                <span className="material-icons text-base">undo</span>تأكيد العكس وإنشاء القيد
              </button>
              <button onClick={() => setScreen('details')}
                className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg hover:bg-gray-600 text-sm transition-colors">
                إلغاء
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  };

  // ─── RENDER: Bank Import ──────────────────────────────────────────────────

  const autoDetectMapping = (cols: string[]): ColumnMapping => {
    const m: ColumnMapping = { date: '', description: '', reference: '', debit: '', credit: '', balance: '', amount: '', txType: '' };
    cols.forEach(col => {
      const key = BANK_COLUMN_HINTS[col.trim().toLowerCase()];
      if (key && !m[key]) m[key] = col;
    });
    return m;
  };

  const parseNumber = (v: string | number | undefined): number => {
    if (v === undefined || v === null || v === '') return 0;
    const s = String(v).replace(/,/g, '').replace(/[^0-9.\-]/g, '');
    return parseFloat(s) || 0;
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setImportFileName(file.name);
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const data = new Uint8Array(ev.target!.result as ArrayBuffer);
        const workbook = XLSX.read(data, { type: 'array', cellDates: true });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<RawBankRow>(sheet, { defval: '', raw: false });
        if (!rows.length) { showToast('الملف فارغ أو غير مدعوم', 'error'); return; }
        const cols = Object.keys(rows[0]);
        const detected = autoDetectMapping(cols);
        setImportRawRows(rows);
        setImportColumns(cols);
        setImportMapping(detected);
        setImportStep('map');
      } catch {
        showToast('تعذّر قراءة الملف — تأكد أنه CSV أو Excel صحيح', 'error');
      }
    };
    reader.readAsArrayBuffer(file);
    e.target.value = '';
  };

  const buildTransactions = (): MappedTransaction[] => {
    const { date, description, reference, debit, credit, amount, txType } = importMapping;
    return importRawRows.map((row, i) => {
      const rawDate = String(row[date] ?? '').trim();
      const rawDesc = String(row[description] ?? '').trim();
      const rawRef  = String(row[reference] ?? '').trim();
      let dr = 0; let cr = 0;

      if (debit && credit) {
        dr = parseNumber(row[debit]);
        cr = parseNumber(row[credit]);
      } else if (amount) {
        const amt = parseNumber(row[amount]);
        const typeVal = String(row[txType] ?? '').toLowerCase();
        if (typeVal.includes('dr') || typeVal.includes('مدين') || typeVal.includes('سحب') || typeVal.includes('d')) {
          dr = Math.abs(amt);
        } else if (typeVal.includes('cr') || typeVal.includes('دائن') || typeVal.includes('إيداع') || typeVal.includes('c')) {
          cr = Math.abs(amt);
        } else {
          if (amt < 0) dr = Math.abs(amt); else cr = amt;
        }
      }

      const isBankDebit = dr > 0; // money OUT of bank → bank is credited
      return {
        id: uid(),
        date: rawDate,
        description: rawDesc || `معاملة ${i + 1}`,
        reference: rawRef,
        debit: dr,
        credit: cr,
        balance: parseNumber(row[importMapping.balance]),
        selected: (dr > 0 || cr > 0),
        // Bank account is always one side
        debitAccount:  isBankDebit ? importDefaultDebit.code  : importBankAccount.code,
        debitAccountName: isBankDebit ? importDefaultDebit.name  : importBankAccount.name,
        creditAccount: isBankDebit ? importBankAccount.code   : importDefaultCredit.code,
        creditAccountName: isBankDebit ? importBankAccount.name   : importDefaultCredit.name,
        jeCreated: false,
      };
    }).filter(t => t.debit > 0 || t.credit > 0);
  };

  const handlePostImport = async () => {
    const selected = importTransactions.filter(t => t.selected && !t.jeCreated);
    if (!selected.length) { showToast('لم تختر أي معاملات', 'error'); return; }
    let count = 0;
    for (const t of selected) {
      const amount = t.debit > 0 ? t.debit : t.credit;
      const entry = {
        id: uid(),
        journal_number: nextJournalNumber(entries),
        entry_type: 'يدوي' as JEType,
        source_module: 'المحاسبة العامة' as SourceModule,
        reference_no: t.reference || t.description.slice(0, 30),
        entry_date: t.date,
        posting_date: t.date,
        fiscal_period: currentPeriod(),
        currency: 'EGP' as Currency,
        description: t.description,
        status: 'Posted' as JEStatus,
        auto_generated_flag: true,
        created_by: 'استيراد كشف بنكي',
        created_at: new Date().toISOString(),
        approved_by: user.name,
        approved_at: new Date().toISOString(),
        posted_by: user.name,
        posted_at: new Date().toISOString(),
        lines: [
          { line_no: 1, account_code: t.debitAccount, account_name: t.debitAccountName, line_description: t.description, debit_amount: amount, credit_amount: 0 },
          { line_no: 2, account_code: t.creditAccount, account_name: t.creditAccountName, line_description: t.description, debit_amount: 0, credit_amount: amount },
        ],
        approval_history: [
          { id: uid(), action: 'submitted' as const, performed_by: 'استيراد بنكي', performed_at: new Date().toISOString() },
          { id: uid(), action: 'posted' as const, performed_by: user.name, performed_at: new Date().toISOString() },
        ],
        attachments: [],
      };
      await saveEntry(entry);
      count++;
    }
    setImportTransactions(prev => prev.map(t => t.selected ? { ...t, jeCreated: true } : t));
    setImportPostedCount(count);
    setImportStep('done');
    showToast(`تم إنشاء ${count} قيد محاسبي بنجاح`);
  };

  const resetImport = () => {
    setImportStep('upload');
    setImportFileName('');
    setImportRawRows([]);
    setImportColumns([]);
    setImportTransactions([]);
    setImportPostedCount(0);
  };

  const renderBankImport = () => {
    const selCount = importTransactions.filter(t => t.selected).length;
    const totalDebitAmt = importTransactions.filter(t => t.selected).reduce((s, t) => s + t.debit, 0);
    const totalCreditAmt = importTransactions.filter(t => t.selected).reduce((s, t) => s + t.credit, 0);

    return (
      <div className="space-y-5" dir="rtl">
        {/* Step indicator */}
        <div className="flex items-center gap-0">
          {([['upload','رفع الملف','upload_file'],['map','ربط الأعمدة','table_chart'],['review','مراجعة وترحيل','fact_check'],['done','اكتمل','check_circle']] as [BankImportStep, string, string][]).map(([s, label, icon], i, arr) => (
            <React.Fragment key={s}>
              <div className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-colors ${importStep === s ? 'bg-primary text-white' : (arr.findIndex(x => x[0] === importStep) > i ? 'text-green-400' : 'text-gray-500')}`}>
                <span className="material-icons text-sm">{icon}</span>{label}
              </div>
              {i < arr.length - 1 && <span className="material-icons text-gray-600 text-sm">chevron_left</span>}
            </React.Fragment>
          ))}
        </div>

        {/* Step 1: Upload */}
        {importStep === 'upload' && (
          <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-8">
            <div className="max-w-lg mx-auto text-center space-y-5">
              <div className="w-16 h-16 rounded-full bg-primary/20 flex items-center justify-center mx-auto">
                <span className="material-icons text-primary text-3xl">account_balance</span>
              </div>
              <div>
                <h3 className="text-base font-bold text-white mb-1">استيراد كشف حساب بنكي</h3>
                <p className="text-sm text-gray-400">صدِّر كشف الحساب من الـ Internet Banking كـ CSV أو Excel ثم ارفعه هنا</p>
              </div>

              <div className="bg-blue-900/20 border border-blue-700/40 rounded-lg p-4 text-right space-y-2">
                <p className="text-xs font-bold text-blue-300 flex items-center gap-1"><span className="material-icons text-sm">info</span>كيف تصدّر كشف الحساب؟</p>
                {[
                  ['البنك الأهلي المصري (NBE)', 'الحسابات ← كشف الحساب ← تصدير Excel'],
                  ['بنك CIB', 'Accounts ← Account Statement ← Download CSV'],
                  ['بنك QNB', 'حساباتي ← كشف الحساب ← تنزيل Excel'],
                  ['بنك مصر', 'الخدمات المصرفية ← كشف الحساب ← تصدير'],
                  ['بنك HSBC / SC', 'Accounts → Statement → Export CSV'],
                ].map(([bank, steps]) => (
                  <div key={bank} className="flex gap-2 text-xs">
                    <span className="text-blue-400 font-medium min-w-[160px]">{bank}</span>
                    <span className="text-gray-400">{steps}</span>
                  </div>
                ))}
              </div>

              <input ref={importFileRef} type="file" accept=".csv,.xlsx,.xls" onChange={handleImportFile} className="hidden" />
              <button onClick={() => importFileRef.current?.click()}
                className="flex items-center gap-2 px-6 py-3 bg-primary text-white rounded-xl hover:bg-primary/90 text-sm font-medium mx-auto transition-colors">
                <span className="material-icons">upload_file</span>اختيار ملف CSV / Excel
              </button>
              <p className="text-xs text-gray-600">الملفات المدعومة: .csv — .xlsx — .xls</p>
            </div>
          </div>
        )}

        {/* Step 2: Column Mapping */}
        {importStep === 'map' && (
          <div className="space-y-4">
            <div className="bg-green-900/20 border border-green-700/40 rounded-lg p-3 flex items-center gap-2">
              <span className="material-icons text-green-400 text-base">check_circle</span>
              <span className="text-xs text-green-300">تم رفع الملف: <strong>{importFileName}</strong> — {importRawRows.length} صف</span>
            </div>

            <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <span className="material-icons text-primary text-base">table_chart</span>
                ربط أعمدة الملف بحقول النظام
                <span className="text-xs text-gray-500 font-normal mr-auto">تم الكشف التلقائي — راجع وعدّل عند الحاجة</span>
              </h3>
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                {([
                  ['date', 'عمود التاريخ', true],
                  ['description', 'عمود البيان / الوصف', true],
                  ['reference', 'عمود الرقم المرجعي', false],
                  ['debit', 'عمود المدين (سحب)', false],
                  ['credit', 'عمود الدائن (إيداع)', false],
                  ['amount', 'عمود المبلغ (موحد)', false],
                  ['txType', 'عمود نوع المعاملة DR/CR', false],
                  ['balance', 'عمود الرصيد', false],
                ] as [keyof ColumnMapping, string, boolean][]).map(([field, label, required]) => (
                  <div key={field}>
                    <label className="block text-xs text-gray-400 mb-1">{label} {required && <span className="text-red-400">*</span>}</label>
                    <select value={importMapping[field]}
                      onChange={e => setImportMapping(prev => ({ ...prev, [field]: e.target.value }))}
                      className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                      <option value="">— لا يوجد —</option>
                      {importColumns.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            </div>

            {/* Bank account mapping */}
            <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-5">
              <h3 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
                <span className="material-icons text-primary text-base">account_balance</span>
                إعدادات الحسابات الافتراضية
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs text-gray-400 mb-1">حساب البنك (الصندوق الرئيسي)</label>
                  <select value={importBankAccount.code}
                    onChange={e => {
                      const acc = CHART_OF_ACCOUNTS.find(a => a.code === e.target.value);
                      if (acc) setImportBankAccount({ code: acc.code, name: acc.name });
                    }}
                    className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                    {CHART_OF_ACCOUNTS.filter(a => a.type === 'أصول' && ['1110','1120','1130'].includes(a.code)).map(a =>
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">حساب المدين الافتراضي (للمدفوعات)</label>
                  <select value={importDefaultDebit.code}
                    onChange={e => {
                      const acc = CHART_OF_ACCOUNTS.find(a => a.code === e.target.value);
                      if (acc) setImportDefaultDebit({ code: acc.code, name: acc.name });
                    }}
                    className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                    {CHART_OF_ACCOUNTS.filter(a => a.type === 'مصروفات').map(a =>
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-600 mt-1">تُستخدم عندما يكون المبلغ خارجاً من البنك</p>
                </div>
                <div>
                  <label className="block text-xs text-gray-400 mb-1">حساب الدائن الافتراضي (للإيداعات)</label>
                  <select value={importDefaultCredit.code}
                    onChange={e => {
                      const acc = CHART_OF_ACCOUNTS.find(a => a.code === e.target.value);
                      if (acc) setImportDefaultCredit({ code: acc.code, name: acc.name });
                    }}
                    className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary">
                    {CHART_OF_ACCOUNTS.filter(a => a.type === 'إيرادات').map(a =>
                      <option key={a.code} value={a.code}>{a.code} — {a.name}</option>)}
                  </select>
                  <p className="text-xs text-gray-600 mt-1">تُستخدم عندما يكون المبلغ داخلاً للبنك</p>
                </div>
              </div>
            </div>

            {/* Preview rows */}
            <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-700/50">
                <h3 className="text-xs font-bold text-gray-400">معاينة أول 5 صفوف من الملف</h3>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#161d2b]">
                    <tr>{importColumns.map(c => <Th key={c}>{c}</Th>)}</tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {importRawRows.slice(0, 5).map((row, i) => (
                      <tr key={i}>{importColumns.map(c => <Td key={c}><span className="text-xs">{String(row[c] ?? '')}</span></Td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => { setImportTransactions(buildTransactions()); setImportStep('review'); }}
                disabled={!importMapping.date || !importMapping.description}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors">
                <span className="material-icons text-base">arrow_forward</span>التالي: مراجعة المعاملات
              </button>
              <button onClick={resetImport}
                className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors">
                رفع ملف آخر
              </button>
            </div>
          </div>
        )}

        {/* Step 3: Review & Post */}
        {importStep === 'review' && (
          <div className="space-y-4">
            {/* Summary bar */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'إجمالي المعاملات', value: importTransactions.length, color: 'text-gray-300' },
                { label: 'المختارة للترحيل', value: selCount, color: 'text-primary' },
                { label: 'إجمالي المدفوعات', value: `${fmt(totalDebitAmt)} EGP`, color: 'text-green-400' },
                { label: 'إجمالي الإيداعات', value: `${fmt(totalCreditAmt)} EGP`, color: 'text-red-400' },
              ].map(k => (
                <div key={k.label} className="bg-[#1e2736] rounded-xl border border-gray-700/50 p-4">
                  <p className="text-xs text-gray-500 mb-1">{k.label}</p>
                  <p className={`text-lg font-bold ${k.color}`}>{k.value}</p>
                </div>
              ))}
            </div>

            <div className="bg-[#1e2736] rounded-xl border border-gray-700/50 overflow-hidden">
              <div className="px-5 py-3 border-b border-gray-700/50 flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">مراجعة المعاملات وتعيين الحسابات</h3>
                <div className="flex gap-2">
                  <button onClick={() => setImportTransactions(prev => prev.map(t => ({ ...t, selected: true })))}
                    className="text-xs text-primary hover:text-primary/80">اختيار الكل</button>
                  <span className="text-gray-600">|</span>
                  <button onClick={() => setImportTransactions(prev => prev.map(t => ({ ...t, selected: false })))}
                    className="text-xs text-gray-500 hover:text-white">إلغاء الكل</button>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="bg-[#161d2b]">
                    <tr>
                      <Th className="w-8"></Th>
                      <Th>التاريخ</Th>
                      <Th className="min-w-[200px]">البيان</Th>
                      <Th>مرجع</Th>
                      <Th className="text-left">سحب (مدين)</Th>
                      <Th className="text-left">إيداع (دائن)</Th>
                      <Th className="min-w-[160px]">ح/ المدين</Th>
                      <Th className="min-w-[160px]">ح/ الدائن</Th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-700/50">
                    {importTransactions.map(t => (
                      <tr key={t.id} className={`transition-colors ${t.jeCreated ? 'opacity-40' : t.selected ? 'hover:bg-gray-700/20' : 'opacity-50'}`}>
                        <Td>
                          <input type="checkbox" checked={t.selected} disabled={t.jeCreated}
                            onChange={e => setImportTransactions(prev => prev.map(x => x.id === t.id ? { ...x, selected: e.target.checked } : x))}
                            className="w-4 h-4 rounded accent-primary" />
                        </Td>
                        <Td><span className="text-xs font-mono">{t.date}</span></Td>
                        <Td><span className="text-xs block max-w-[200px] truncate" title={t.description}>{t.description}</span></Td>
                        <Td><span className="text-xs text-gray-500">{t.reference || '—'}</span></Td>
                        <Td className="text-left font-mono text-xs text-green-400">{t.debit > 0 ? fmt(t.debit) : '—'}</Td>
                        <Td className="text-left font-mono text-xs text-red-400">{t.credit > 0 ? fmt(t.credit) : '—'}</Td>
                        <Td>
                          <select value={t.debitAccount} disabled={t.jeCreated}
                            onChange={e => {
                              const acc = CHART_OF_ACCOUNTS.find(a => a.code === e.target.value);
                              setImportTransactions(prev => prev.map(x => x.id === t.id ? { ...x, debitAccount: e.target.value, debitAccountName: acc?.name ?? '' } : x));
                            }}
                            className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-1 focus:ring-primary">
                            {CHART_OF_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                          </select>
                        </Td>
                        <Td>
                          <select value={t.creditAccount} disabled={t.jeCreated}
                            onChange={e => {
                              const acc = CHART_OF_ACCOUNTS.find(a => a.code === e.target.value);
                              setImportTransactions(prev => prev.map(x => x.id === t.id ? { ...x, creditAccount: e.target.value, creditAccountName: acc?.name ?? '' } : x));
                            }}
                            className="w-full bg-[#161d2b] border border-gray-600 rounded px-2 py-1 text-xs text-gray-300 focus:ring-1 focus:ring-primary">
                            {CHART_OF_ACCOUNTS.map(a => <option key={a.code} value={a.code}>{a.code} {a.name}</option>)}
                          </select>
                        </Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 items-center">
              <button onClick={handlePostImport} disabled={selCount === 0}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-700 text-white rounded-lg text-sm font-medium hover:bg-green-600 disabled:opacity-50 transition-colors">
                <span className="material-icons text-base">publish</span>
                ترحيل {selCount > 0 ? `${selCount} قيد` : 'القيود المختارة'}
              </button>
              <button onClick={() => setImportStep('map')}
                className="px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors">
                رجوع
              </button>
              <span className="text-xs text-gray-500 mr-auto">
                سيتم إنشاء قيود محاسبية مزدوجة القيد مرحّلة فوراً
              </span>
            </div>
          </div>
        )}

        {/* Step 4: Done */}
        {importStep === 'done' && (
          <div className="bg-[#1e2736] rounded-xl border border-green-700/40 p-10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-green-900/40 flex items-center justify-center mx-auto">
              <span className="material-icons text-green-400 text-4xl">check_circle</span>
            </div>
            <h3 className="text-lg font-bold text-white">تم الاستيراد بنجاح</h3>
            <p className="text-sm text-gray-400">تم إنشاء وترحيل <span className="text-green-400 font-bold">{importPostedCount}</span> قيد محاسبي من كشف الحساب البنكي</p>
            <div className="flex gap-3 justify-center">
              <button onClick={() => { setScreen('list'); resetImport(); }}
                className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors">
                <span className="material-icons text-base">list</span>عرض القيود المُنشأة
              </button>
              <button onClick={resetImport}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 text-gray-300 rounded-lg text-sm hover:bg-gray-600 transition-colors">
                <span className="material-icons text-base">upload_file</span>استيراد ملف آخر
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  // ─── Account Lookup Modal ─────────────────────────────────────────────────

  const filteredAccounts = useMemo(() =>
    CHART_OF_ACCOUNTS.filter(a =>
      !accountSearchQuery ||
      a.code.includes(accountSearchQuery) ||
      a.name.includes(accountSearchQuery) ||
      a.type.includes(accountSearchQuery)
    ), [accountSearchQuery]);

  const renderAccountModal = () => (
    accountSearchOpen ? (
      <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" dir="rtl">
        <div className="bg-[#1e2736] rounded-xl border border-gray-600 w-full max-w-lg shadow-2xl">
          <div className="px-5 py-4 border-b border-gray-700 flex items-center justify-between">
            <h3 className="text-sm font-bold text-white">اختيار الحساب</h3>
            <button onClick={() => setAccountSearchOpen(false)} className="text-gray-400 hover:text-white">
              <span className="material-icons">close</span>
            </button>
          </div>
          <div className="p-3 border-b border-gray-700">
            <input autoFocus value={accountSearchQuery} onChange={e => setAccountSearchQuery(e.target.value)}
              placeholder="ابحث بالكود أو الاسم..."
              className="w-full bg-[#161d2b] border border-gray-600 rounded-lg px-3 py-2 text-sm text-gray-300 focus:ring-1 focus:ring-primary" />
          </div>
          <div className="max-h-80 overflow-y-auto">
            {filteredAccounts.map(a => (
              <button key={a.code} onClick={() => selectAccount(a)}
                className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-gray-700/50 border-b border-gray-700/30 transition-colors text-right">
                <span className="font-mono text-xs text-primary w-12">{a.code}</span>
                <span className="text-sm text-gray-200 flex-1">{a.name}</span>
                <span className="text-xs text-gray-500">{a.type}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    ) : null
  );

  // ─── Toast ─────────────────────────────────────────────────────────────────

  const renderToast = () => toast ? (
    <div className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] flex items-center gap-2 px-5 py-3 rounded-xl shadow-2xl text-sm font-medium transition-all ${
      toast.type === 'success' ? 'bg-green-700 text-white' : 'bg-red-700 text-white'
    }`}>
      <span className="material-icons text-base">{toast.type === 'success' ? 'check_circle' : 'error'}</span>
      {toast.msg}
    </div>
  ) : null;

  // ─── Breadcrumb / Navigation ──────────────────────────────────────────────

  const screenLabel: Record<Screen, string> = {
    dashboard: 'لوحة التحكم',
    list: 'قائمة القيود',
    create: 'قيد جديد',
    edit: 'تعديل القيد',
    details: 'تفاصيل القيد',
    'approval-inbox': 'صندوق الاعتماد',
    reversal: 'عكس القيد',
    'bank-import': 'استيراد كشف بنكي',
  };

  return (
    <div className="min-h-full" dir="rtl">
      {/* Breadcrumb */}
      <div className="flex items-center gap-1.5 mb-5 text-xs text-gray-500">
        <button onClick={() => setScreen('dashboard')} className="hover:text-primary transition-colors">
          القيود المحاسبية
        </button>
        {screen !== 'dashboard' && (
          <>
            <span className="material-icons text-xs">chevron_left</span>
            <span className="text-gray-300">{screenLabel[screen]}</span>
            {screen === 'details' && selectedEntry && (
              <>
                <span className="material-icons text-xs">chevron_left</span>
                <span className="font-mono text-primary">{selectedEntry.journal_number}</span>
              </>
            )}
          </>
        )}
      </div>

      {/* Screen router */}
      {screen === 'dashboard' && renderDashboard()}
      {screen === 'list' && renderList()}
      {(screen === 'create' || screen === 'edit') && renderForm()}
      {screen === 'details' && renderDetails()}
      {screen === 'approval-inbox' && renderApprovalInbox()}
      {screen === 'reversal' && renderReversal()}
      {screen === 'bank-import' && renderBankImport()}

      {renderAccountModal()}
      {renderToast()}
    </div>
  );
};

export default JournalEntriesDashboard;
