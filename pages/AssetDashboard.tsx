
import React, { useState, useEffect, useRef } from 'react';
import * as XLSX from 'xlsx'; // Import SheetJS
import AssetBarcode from '../components/AssetBarcode'; // Import custom Barcode Component
import { User, Asset, MaintenanceRequest, Project } from '../services/types';
import { StorageService } from '../services/storage';
import Toast from '../components/Toast';
import ConfirmationModal from '../components/ConfirmationModal';

interface AssetDashboardProps {
    user: User;
}

const HARDWARE_TYPES = ['Scanner', 'Server', 'PC', 'Workstation', 'Laptop', 'Printer', 'Monitor', 'Other'];
const ASSET_STATUSES = [
    { value: 'operational', label: 'Operational (يعمل)' },
    { value: 'in_storage', label: 'In Storage (مخزن)' },
    { value: 'faulty', label: 'Faulty (عطل)' },
    { value: 'maintenance', label: 'Maintenance (صيانة)' },
    { value: 'retired', label: 'Retired (متقاعد)' }
];

// Bulk Row Interface for Wizard Step 2
interface BulkRow {
    id: number;
    model: string;
    serialNumber: string;
    isDuplicate: boolean;
    predictedTag?: string; // New: For display purposes
}

const AssetDashboard: React.FC<AssetDashboardProps> = ({ user }) => {
    const [assets, setAssets] = useState<Asset[]>([]);
    const [loading, setLoading] = useState(false);
    const [projectId, setProjectId] = useState<string | undefined>(user.projectId);

    // Available projects
    const [availableProjects, setAvailableProjects] = useState<Project[]>([]);

    // Search & Filter State
    const [searchTerm, setSearchTerm] = useState('');

    // Bulk Selection State
    const [selectedAssetIds, setSelectedAssetIds] = useState<Set<string>>(new Set());

    // Maintenance Modal State
    const [showRequestModal, setShowRequestModal] = useState(false);
    const [selectedAsset, setSelectedAsset] = useState<Asset | null>(null);
    const [requestForm, setRequestForm] = useState<{ priority: 'low' | 'medium' | 'high' | 'critical', description: string }>({
        priority: 'medium',
        description: ''
    });
    const [submitStatus, setSubmitStatus] = useState<'' | 'sending' | 'success' | 'error'>('');

    // Asset Management Modal State (Add/Edit)
    const [showAssetModal, setShowAssetModal] = useState(false);
    const [isEditingAsset, setIsEditingAsset] = useState(false);
    const [isTagGenerating, setIsTagGenerating] = useState(false);

    // --- BULK WIZARD STATE ---
    const [showBulkModal, setShowBulkModal] = useState(false);
    const [bulkStep, setBulkStep] = useState<1 | 2 | 3 | 4>(1);

    // Generator State (Step 2)
    const [generatorModel, setGeneratorModel] = useState('');
    const [generatorQty, setGeneratorQty] = useState(1);
    const [modelSuggestions, setModelSuggestions] = useState<string[]>([]);
    const [nextTagBase, setNextTagBase] = useState<string>('');

    // Step 1: Common Data
    const [commonBulkData, setCommonBulkData] = useState({
        type: 'Laptop',
        status: 'in_storage',
        purchaseDate: new Date().toISOString().split('T')[0],
        cost: 0,
        targetProjectId: '',
        cpu: '',
        ram: '',
        storage: ''
    });

    // Step 2: Specific Rows
    const [bulkRows, setBulkRows] = useState<BulkRow[]>([]);
    const [bulkPasteContent, setBulkPasteContent] = useState('');
    const [bulkFocusIndex, setBulkFocusIndex] = useState(0); // Track which row should be focused

    // Step 4: Results
    const [bulkResults, setBulkResults] = useState<any[]>([]); // To store server response with Tags

    // UI Feedback
    const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        isDangerous?: boolean;
    }>({
        isOpen: false, title: '', message: '', onConfirm: () => { }, isDangerous: false
    });

    const showToast = (message: string, type: 'success' | 'error' | 'info' = 'success') => {
        setToast({ message, type });
    };

    const confirmAction = (message: string, onConfirm: () => void, isDangerous = false) => {
        setConfirmModal({ isOpen: true, message, title: 'تأكيد', onConfirm, isDangerous });
    };

    const closeConfirmModal = () => {
        setConfirmModal(prev => ({ ...prev, isOpen: false }));
    };

    // Initial empty form state
    const initialAssetForm: Partial<Asset> = {
        assetTag: '', name: '', type: 'Scanner', status: 'in_storage', serialNumber: '',
        macAddress: '', cpu: '', ram: '', storage: '',
        purchaseDate: '', cost: 0,
        assignedUser: '', department: '', physicalLocation: '',
        lastMaintenanceDate: '', projectId: '',
        currentCounter: 0
    };
    const [assetForm, setAssetForm] = useState<Partial<Asset>>(initialAssetForm);

    const canManageAssets = user.role === 'project_manager' || user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';
    const isItSpecialist = user.role === 'it_specialist' || user.role === 'hr_admin';
    const isSuperAdmin = user.role === 'super_admin' || user.role === 'power_admin';

    useEffect(() => {
        if (!projectId && !isItSpecialist && !isSuperAdmin) {
            const storedPid = localStorage.getItem('current_project_id');
            if (storedPid) setProjectId(storedPid);
        }
    }, []);

    useEffect(() => {
        if (projectId || isItSpecialist || isSuperAdmin) {
            fetchAssets();
        }
    }, [projectId]);

    useEffect(() => {
        const loadProjects = async () => {
            let data: Project[] = [];
            if (isSuperAdmin || isItSpecialist) {
                data = await StorageService.getProjects();
            } else if (user.role === 'project_manager') {
                data = await StorageService.getProjectsByPM(user.id);
            }
            setAvailableProjects(data);

            if (!projectId) {
                if (isItSpecialist || isSuperAdmin) {
                    setProjectId('all');
                } else if (data.length > 0) {
                    setProjectId(data[0].id);
                }
            }
        };
        if (canManageAssets) loadProjects();
    }, [user.role, user.id, canManageAssets, isItSpecialist, isSuperAdmin]);

    // Fetch Suggestions and Next Tag when Wizard Step 2 opens
    useEffect(() => {
        if (showBulkModal && bulkStep === 2) {
            // 1. Get Unique Models
            const uniqueModels = Array.from(new Set(assets.map(a => a.name))).sort();
            setModelSuggestions(uniqueModels);

            // 2. Get Next Tag Base
            StorageService.getNextAssetTag().then(tag => setNextTagBase(tag));
        }
    }, [showBulkModal, bulkStep, assets]);

    const fetchAssets = async () => {
        const pidToUse = ((isItSpecialist || isSuperAdmin) && (!projectId || projectId === 'all')) ? 'all' : projectId;
        if (!pidToUse) return;

        setLoading(true);
        const data = await StorageService.getAssets(pidToUse);
        setAssets(data);
        setLoading(false);
        setSelectedAssetIds(new Set());
    };

    const getAssetIcon = (type: string) => {
        switch (type.toLowerCase()) {
            case 'laptop': return 'laptop';
            case 'pc': return 'computer';
            case 'server': return 'dns';
            case 'scanner': return 'document_scanner';
            case 'workstation': return 'desktop_windows';
            case 'printer': return 'print';
            default: return 'devices_other';
        }
    };

    const openMaintenanceRequestModal = (asset: Asset) => {
        setSelectedAsset(asset);
        setRequestForm({ priority: 'medium', description: '' });
        setSubmitStatus('');
        setShowRequestModal(true);
    };

    const handleSubmitRequest = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!selectedAsset || !selectedAsset.projectId) return;
        setSubmitStatus('sending');
        const request: MaintenanceRequest = {
            assetId: selectedAsset.id,
            supervisorId: user.id,
            projectId: selectedAsset.projectId,
            priority: requestForm.priority,
            description: requestForm.description,
            status: 'pending',
            createdAt: new Date().toISOString()
        };
        const result = await StorageService.createMaintenanceRequest(request);
        if (result.success) {
            setSubmitStatus('success');
            if (request.priority === 'high' || request.priority === 'critical') {
                fetchAssets();
            }
            setTimeout(() => {
                setShowRequestModal(false);
                setSelectedAsset(null);
            }, 1500);
        } else {
            setSubmitStatus('error');
            showToast(`Error: ${result.error}`, 'error');
        }
    };

    // --- Asset CRUD Handlers ---

    const openAddAssetModal = async () => {
        const today = new Date().toISOString().split('T')[0];
        setAssetForm({
            ...initialAssetForm,
            lastMaintenanceDate: today,
            purchaseDate: today,
            projectId: projectId === 'all' ? '' : projectId
        });
        setIsEditingAsset(false);
        setShowAssetModal(true);

        // Auto-generate Asset Tag
        setIsTagGenerating(true);
        const nextTag = await StorageService.getNextAssetTag();
        setAssetForm(prev => ({ ...prev, assetTag: nextTag }));
        setIsTagGenerating(false);
    };

    const openEditAssetModal = (asset: Asset) => {
        setAssetForm({ ...asset });
        setIsEditingAsset(true);
        setShowAssetModal(true);
    };

    const handleSaveAsset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!assetForm.name || !assetForm.projectId || !assetForm.assetTag) {
            showToast("الرجاء ملء الحقول الإجبارية: الاسم، الرمز (Tag)، والمشروع.", 'error');
            return;
        }
        setSubmitStatus('sending');
        let result;
        if (isEditingAsset && assetForm.id) {
            result = await StorageService.updateAsset(assetForm as Asset);
        } else {
            result = await StorageService.createAsset(assetForm as Asset);
        }
        if (result.success) {
            setSubmitStatus('success');
            fetchAssets();
            setShowAssetModal(false);
            showToast('تم حفظ الأصل بنجاح');
        } else {
            showToast(`خطأ: ${result.error}`, 'error');
            setSubmitStatus('');
        }
    };

    // --- Bulk Wizard Handlers ---

    // Helper: Create Storage Project on the fly
    const handleCreateStorageProject = async () => {
        const newProj = await StorageService.createProject('المخزن (Storage)', 'Main Storage');
        if (newProj) {
            setAvailableProjects(prev => [...prev, newProj]);
            setCommonBulkData(prev => ({ ...prev, targetProjectId: newProj.id }));
            showToast('تم إنشاء واختيار مشروع المخزن (Storage)');
        } else {
            showToast('فشل إنشاء المشروع', 'error');
        }
    };

    const initBulkWizard = () => {
        if (!projectId) {
            showToast('يرجى الانتظار حتى تحميل المشاريع.', 'error');
            return;
        }

        setBulkStep(1);
        setCommonBulkData({
            type: 'Laptop',
            status: 'in_storage',
            purchaseDate: new Date().toISOString().split('T')[0],
            cost: 0,
            targetProjectId: projectId === 'all' ? '' : projectId,
            cpu: '',
            ram: '',
            storage: ''
        });
        setBulkRows([{ id: Date.now(), model: '', serialNumber: '', isDuplicate: false, predictedTag: '' }]);
        setBulkResults([]);
        setSubmitStatus('');
        setShowBulkModal(true);
        setGeneratorModel('');
        setGeneratorQty(1);
        setBulkFocusIndex(0);
    };

    // Tag Prediction Helper
    const generatePredictedTags = (rows: BulkRow[], startTag: string): BulkRow[] => {
        if (!startTag) return rows;
        const parts = startTag.split('-'); // e.g., ['CD2025', '00100']
        if (parts.length < 2) return rows;

        const prefix = parts[0];
        let seq = parseInt(parts[1], 10);
        if (isNaN(seq)) return rows;

        return rows.map((row, index) => {
            const currentSeq = seq + index;
            // Pad with leading zeros to 5 digits (standard)
            const paddedSeq = currentSeq.toString().padStart(5, '0');
            return { ...row, predictedTag: `${prefix}-${paddedSeq}` };
        });
    };

    const handleGenerateRows = () => {
        // 1. Filter out empty/placeholder rows to ensure accurate count and clean slate
        // This prevents "1 + Qty" bug by removing rows that have no model AND no serial
        const validExistingRows = bulkRows.filter(r => r.model.trim() !== '' || r.serialNumber.trim() !== '');

        // 2. Set focus to the first newly created row (which will be at the end of existing rows)
        setBulkFocusIndex(validExistingRows.length);

        const newRows: BulkRow[] = [];
        const timestamp = Date.now();

        // 3. Strict loop for exact quantity
        for (let i = 0; i < generatorQty; i++) {
            newRows.push({
                id: timestamp + i,
                model: generatorModel || '',
                serialNumber: '', // Keep serial empty
                isDuplicate: false,
                predictedTag: '' // Will be filled by recalculation
            });
        }

        // Append new rows to any valid existing rows
        const updatedRows = [...validExistingRows, ...newRows];
        const taggedRows = generatePredictedTags(updatedRows, nextTagBase);
        setBulkRows(taggedRows);
    };

    const handleAddRow = () => {
        const newRow = { id: Date.now(), model: generatorModel || '', serialNumber: '', isDuplicate: false, predictedTag: '' };
        const updatedRows = [...bulkRows, newRow];
        setBulkRows(generatePredictedTags(updatedRows, nextTagBase));
        setBulkFocusIndex(updatedRows.length - 1);
    };

    const handleDeleteRow = (id: number) => {
        const updatedRows = bulkRows.filter(r => r.id !== id);
        setBulkRows(generatePredictedTags(updatedRows, nextTagBase));
    };

    // The Duplicate Shield Logic
    const handleBulkRowChange = (id: number, field: keyof BulkRow, value: string) => {
        setBulkRows(prev => prev.map(row => {
            if (row.id !== id) return row;

            const updatedRow = { ...row, [field]: value };

            // Duplicate Check on Serial Change
            if (field === 'serialNumber') {
                const serial = value.trim().toLowerCase();
                // Check Database
                const existsInDB = assets.some(a => a.serialNumber.toLowerCase() === serial && serial !== '');
                // Check Current List (Other rows)
                const existsInList = prev.some(r => r.id !== id && r.serialNumber.toLowerCase() === serial && serial !== '');

                updatedRow.isDuplicate = existsInDB || existsInList;
            }

            return updatedRow;
        }));
    };

    const handlePasteExcel = () => {
        if (!bulkPasteContent.trim()) return;

        const lines = bulkPasteContent.trim().split('\n');
        const newRows: BulkRow[] = lines.map((line, idx) => {
            const parts = line.split('\t');
            const model = parts[0]?.trim() || '';
            const serial = parts[1]?.trim() || (parts.length === 1 ? parts[0]?.trim() : '') || '';

            const existsInDB = assets.some(a => a.serialNumber.toLowerCase() === serial.toLowerCase() && serial !== '');

            return {
                id: Date.now() + idx,
                model: parts.length > 1 ? model : '',
                serialNumber: serial,
                isDuplicate: existsInDB,
                predictedTag: ''
            };
        });

        // Append and Recalculate Tags
        const updatedRows = [...bulkRows, ...newRows];
        setBulkRows(generatePredictedTags(updatedRows, nextTagBase));
        setBulkPasteContent('');
    };

    const handleBulkSubmit = async () => {
        const targetPid = projectId === 'all' ? commonBulkData.targetProjectId : projectId;

        if (!targetPid) {
            showToast('يجب تحديد مشروع.', 'error');
            return;
        }

        // Validation: Removed strict check for serial numbers equality
        // const filledSerials = bulkRows.filter(r => r.serialNumber && r.serialNumber.trim() !== '').length;
        // if (filledSerials !== bulkRows.length) {
        //     showToast(`Asset quantity (${bulkRows.length}) must be equal to number of serial numbers (${filledSerials}).`, 'error');
        //     return;
        // }

        if (bulkRows.some(r => r.isDuplicate)) {
            showToast('يوجد أرقام تسلسلية مكررة (باللون الأحمر). يرجى التصحيح.', 'error');
            return;
        }

        setSubmitStatus('sending');

        const assetsPayload = bulkRows.map(row => ({
            name: row.model || commonBulkData.type + ' ' + (row.serialNumber || 'No Serial'), // Fallback name
            type: commonBulkData.type,
            serialNumber: row.serialNumber,
            status: commonBulkData.status as any,
            purchaseDate: commonBulkData.purchaseDate,
            cost: commonBulkData.cost,
            projectId: targetPid,
            cpu: commonBulkData.cpu,
            ram: commonBulkData.ram,
            storage: commonBulkData.storage
        }));

        const result = await StorageService.registerAssetsBulk(assetsPayload, targetPid, user.id);

        if (result.success && result.data) {
            setBulkResults(result.data);
            setBulkStep(4);
            setSubmitStatus('success');
            fetchAssets();
            showToast(`تم تسجيل ${result.data.length} أصل بنجاح`);
        } else {
            setSubmitStatus('error');
            showToast('فشل التسجيل: ' + result.error, 'error');
        }
    };

    const handlePrintLabels = () => {
        const printWindow = window.open('', '', 'width=800,height=600');
        if (!printWindow) return;

        const labelsHtml = bulkResults.map(asset => `
        <div class="label">
            <div class="header">
                <span class="org">Capture Flow</span>
                <span class="cat">${asset.type}</span>
            </div>
            <div class="barcode-box">
               <div class="tag">${asset.asset_tag}</div>
            </div>
            <div class="details">
                <div class="model">${asset.name}</div>
                <div class="sn">S/N: ${asset.serial_number}</div>
            </div>
        </div>
      `).join('');

        printWindow.document.write(`
        <html>
          <head>
            <title>Print Asset Labels</title>
            <style>
              @media print {
                @page { size: auto; margin: 0; }
                body { margin: 0.5cm; }
              }
              body { font-family: monospace; display: flex; flex-wrap: wrap; gap: 10px; }
              .label {
                width: 3.5in; 
                height: 1.5in;
                border: 2px solid #000;
                border-radius: 8px;
                padding: 10px;
                box-sizing: border-box;
                display: flex;
                flex-direction: column;
                justify-content: space-between;
                page-break-inside: avoid;
                margin-bottom: 10px;
              }
              .header { display: flex; justify-content: space-between; font-size: 12px; font-weight: bold; border-bottom: 1px solid #000; padding-bottom: 4px; }
              .barcode-box { text-align: center; margin: 10px 0; }
              .tag { font-size: 28px; font-weight: 900; letter-spacing: 2px; }
              .details { font-size: 12px; }
              .model { font-weight: bold; font-size: 14px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
            </style>
          </head>
          <body>
            ${labelsHtml}
            <script>
                window.print();
            </script>
          </body>
        </html>
      `);
        printWindow.document.close();
    };

    // --- Bulk Selection & Actions Handlers ---

    const toggleSelectAsset = (id: string) => {
        const newSet = new Set(selectedAssetIds);
        if (newSet.has(id)) newSet.delete(id);
        else newSet.add(id);
        setSelectedAssetIds(newSet);
    };

    const toggleSelectAll = (currentAssets: Asset[]) => {
        if (selectedAssetIds.size === currentAssets.length && currentAssets.length > 0) {
            setSelectedAssetIds(new Set());
        } else {
            setSelectedAssetIds(new Set(currentAssets.map(a => a.id)));
        }
    };

    const handleBulkVerify = async () => {
        if (selectedAssetIds.size === 0) return;
        confirmAction(
            `تأكيد فحص ${selectedAssetIds.size} أصل؟ سيتم تحديث تاريخ الفحص لليوم.`,
            async () => {
                const result = await StorageService.bulkUpdateAssets(Array.from(selectedAssetIds), {
                    lastAuditDate: new Date().toISOString(),
                    auditedBy: user.id
                });
                if (result.success) {
                    showToast('تم تحديث الفحص بنجاح');
                    fetchAssets();
                    setSelectedAssetIds(new Set());
                } else {
                    showToast(`خطأ: ${result.error}`, 'error');
                }
                closeConfirmModal();
            }
        );
    };

    const handleBulkDelete = async () => {
        if (selectedAssetIds.size === 0) return;
        confirmAction(
            `هل أنت متأكد من حذف ${selectedAssetIds.size} عنصر؟ لا يمكن التراجع عن هذا الإجراء.`,
            async () => {
                const result = await StorageService.deleteAssets(Array.from(selectedAssetIds));
                if (result.success) {
                    showToast('تم حذف العناصر بنجاح');
                    fetchAssets();
                    setSelectedAssetIds(new Set());
                } else {
                    showToast(`خطأ: ${result.error}`, 'error');
                }
                closeConfirmModal();
            },
            true
        );
    };

    const handleBulkStatusChange = async (status: string) => {
        if (selectedAssetIds.size === 0) return;
        const result = await StorageService.bulkUpdateAssets(Array.from(selectedAssetIds), { status: status as any });
        if (result.success) {
            showToast(`تم تغيير الحالة إلى ${status}`);
            fetchAssets();
            setSelectedAssetIds(new Set());
        } else {
            showToast(`خطأ: ${result.error}`, 'error');
        }
    };

    const handleVerifyAsset = async (asset: Asset) => {
        const result = await StorageService.verifyAsset(asset.id, user.id);
        if (result.success) {
            showToast('تم تأكيد فحص الأصل');
            // Optimistic Update
            setAssets(prev => prev.map(a => a.id === asset.id ? { ...a, lastAuditDate: new Date().toISOString() } : a));
        } else {
            showToast(`خطأ: ${result.error}`, 'error');
        }
    };

    const handleBulkExport = () => {
        if (selectedAssetIds.size === 0) return;
        const assetsToExport = assets.filter(a => selectedAssetIds.has(a.id));
        const headers = ['Asset Tag', 'Asset Name', 'Category', 'Serial Number', 'Location'];
        const csvRows = [
            headers.join(','),
            ...assetsToExport.map(asset => {
                const sanitize = (val: string | undefined) => { const str = val || ''; return str.includes(',') ? `"${str}"` : str; };
                return [sanitize(asset.assetTag), sanitize(asset.name), sanitize(asset.type), sanitize(asset.serialNumber), sanitize(asset.physicalLocation)].join(',');
            })
        ];
        const csvString = csvRows.join('\n');
        const bom = '\uFEFF';
        const blob = new Blob([bom + csvString], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `assets_labels_export_${new Date().toISOString().split('T')[0]}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('تم تصدير الملف بنجاح');
    };

    const filteredAssets = assets.filter(a =>
        (a.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (a.serialNumber || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        (a.assetTag && a.assetTag.toLowerCase().includes(searchTerm.toLowerCase()))
    );

    if (loading) {
        return <div className="flex h-96 items-center justify-center text-primary"><span className="material-icons animate-spin text-4xl">donut_large</span></div>;
    }

    return (
        <div className="space-y-6 animate-fade-in-up">
            {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}
            <ConfirmationModal
                isOpen={confirmModal.isOpen}
                title={confirmModal.title}
                message={confirmModal.message}
                onConfirm={confirmModal.onConfirm}
                onCancel={closeConfirmModal}
                isDangerous={confirmModal.isDangerous}
            />

            {/* Header Summary & Tools */}
            <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col gap-4">
                <div className="flex flex-col md:flex-row items-center justify-between gap-4">
                    <div>
                        <h2 className="text-lg font-bold text-gray-800">
                            {isItSpecialist ? 'لوحة جرد الأصول (IT Audit)' : 'أصول الموقع'}
                        </h2>
                        <p className="text-gray-500 text-sm">
                            {isItSpecialist ? 'البحث، الفحص، وتحديث حالة المعدات' : 'إدارة وصيانة المعدات والأصول'}
                        </p>
                    </div>
                    {canManageAssets && availableProjects.length > 0 && (
                        <div className="flex items-center gap-2 bg-gray-50 p-2 rounded-lg border border-gray-200">
                            <span className="material-icons text-gray-400">domain</span>
                            <select
                                className="bg-transparent font-bold text-gray-700 outline-none text-sm min-w-[150px]"
                                value={projectId || 'all'}
                                onChange={(e) => setProjectId(e.target.value)}
                            >
                                {(isItSpecialist || isSuperAdmin) && <option value="all">كل المواقع (Global)</option>}
                                {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                            </select>
                        </div>
                    )}
                </div>

                <div className="flex flex-col md:flex-row gap-4 items-center justify-between border-t pt-4">
                    <div className="relative w-full md:w-96">
                        <span className="material-icons absolute right-3 top-2.5 text-gray-400">search</span>
                        <input
                            type="text"
                            placeholder="بحث بالرمز (Tag)، الاسم، أو السيريال..."
                            className="w-full pl-4 pr-10 py-2 bg-gray-50 border border-gray-200 rounded-lg focus:ring-2 focus:ring-primary outline-none"
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                        />
                    </div>
                    <div className="flex gap-2 w-full md:w-auto">
                        {canManageAssets && (
                            <>
                                <button
                                    onClick={initBulkWizard}
                                    disabled={!projectId}
                                    className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-emerald-700 flex items-center gap-2 disabled:bg-gray-300"
                                >
                                    <span className="material-icons text-sm">playlist_add</span> إضافة جماعية (Wizard)
                                </button>
                                <button
                                    onClick={openAddAssetModal}
                                    disabled={projectId === 'all' && !isItSpecialist}
                                    className="bg-blue-600 text-white px-4 py-2 rounded-lg font-bold shadow-sm hover:bg-blue-700 flex items-center gap-2 disabled:bg-gray-300"
                                >
                                    <span className="material-icons text-sm">add_circle</span> جديد
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {selectedAssetIds.size > 0 && (
                    <div className="bg-blue-50 border border-blue-100 p-3 rounded-lg flex items-center justify-between animate-fade-in-up flex-wrap gap-2">
                        <div className="flex items-center gap-2"><span className="font-bold text-blue-800 text-sm">تم تحديد {selectedAssetIds.size} عنصر</span></div>
                        <div className="flex gap-2">
                            <button onClick={handleBulkExport} className="bg-purple-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-purple-700 flex items-center gap-1"><span className="material-icons text-sm">file_download</span> تصدير للملصقات (CSV)</button>
                            {isItSpecialist && (
                                <>
                                    <button onClick={handleBulkVerify} className="bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-green-700 flex items-center gap-1"><span className="material-icons text-sm">fact_check</span> تأكيد الفحص (Verify)</button>
                                    <button onClick={handleBulkDelete} className="bg-red-600 text-white px-3 py-1.5 rounded text-xs font-bold hover:bg-red-700 flex items-center gap-1"><span className="material-icons text-sm">delete</span> حذف</button>
                                </>
                            )}
                            <div className="relative group">
                                <button className="bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded text-xs font-bold hover:bg-gray-50 flex items-center gap-1"><span className="material-icons text-sm">edit_note</span> تغيير الحالة</button>
                                <div className="absolute left-0 mt-1 w-40 bg-white border border-gray-200 shadow-xl rounded-lg hidden group-hover:block z-20">
                                    {['operational', 'in_storage', 'faulty', 'maintenance', 'retired'].map(status => (
                                        <button key={status} onClick={() => handleBulkStatusChange(status)} className="block w-full text-right px-4 py-2 hover:bg-gray-50 text-xs font-bold capitalize">{status}</button>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {!projectId && !isItSpecialist && !isSuperAdmin && (
                <div className="flex flex-col items-center justify-center h-96 bg-white rounded-xl shadow-sm border p-8 text-center">
                    <span className="material-icons text-5xl text-gray-300 mb-4">domain_disabled</span>
                    <h2 className="text-2xl font-bold text-gray-800">لا يوجد مشروع محدد</h2>
                </div>
            )}

            {(projectId || isItSpecialist || isSuperAdmin) && filteredAssets.length === 0 ? (
                <div className="text-center py-20 bg-gray-50 rounded-xl border-2 border-dashed border-gray-200">
                    <span className="material-icons text-5xl text-gray-300 mb-4">inventory_2</span>
                    <p className="text-gray-500 font-bold">لا توجد أصول مطابقة للبحث</p>
                </div>
            ) : (projectId || isItSpecialist || isSuperAdmin) && (
                isItSpecialist ? (
                    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-right text-sm">
                                <thead className="bg-gray-50 text-gray-500 font-bold uppercase">
                                    <tr>
                                        <th className="p-4 w-10 text-center"><input type="checkbox" onChange={() => toggleSelectAll(filteredAssets)} checked={selectedAssetIds.size === filteredAssets.length && filteredAssets.length > 0} className="w-4 h-4 rounded text-primary" /></th>
                                        <th className="p-4">Tag / Name</th>
                                        <th className="p-4">النوع / S.N</th>
                                        <th className="p-4">الموقع</th>
                                        <th className="p-4 text-center">الحالة</th>
                                        <th className="p-4 text-center">آخر فحص</th>
                                        <th className="p-4 text-center">إجراءات</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-gray-100">
                                    {filteredAssets.map(asset => {
                                        const isVerifiedRecently = asset.lastAuditDate && new Date(asset.lastAuditDate) > new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
                                        const projName = availableProjects.find(p => p.id === asset.projectId)?.name || 'Unknown';
                                        return (
                                            <tr key={asset.id} className={`hover:bg-gray-50 ${selectedAssetIds.has(asset.id) ? 'bg-blue-50' : ''}`}>
                                                <td className="p-4 text-center"><input type="checkbox" checked={selectedAssetIds.has(asset.id)} onChange={() => toggleSelectAsset(asset.id)} className="w-4 h-4 rounded text-primary" /></td>
                                                <td className="py-2 px-4">
                                                    <div className="font-bold text-gray-800 mb-1">{asset.name}</div>
                                                    <div className="flex items-center gap-3">
                                                        <span className="material-icons text-gray-400 bg-gray-100 p-1 rounded text-lg">{getAssetIcon(asset.type)}</span>
                                                        {asset.assetTag ? (
                                                            <AssetBarcode value={asset.assetTag} />
                                                        ) : (
                                                            <span className="text-xs text-red-300 font-mono italic">NO TAG</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td className="p-4">
                                                    <div className="text-gray-700 font-bold text-xs">{asset.type}</div>
                                                    <div className="text-xs text-gray-500 font-mono">{asset.serialNumber}</div>
                                                    {(asset.cpu || asset.ram || asset.storage) && (
                                                        <div className="text-[10px] text-gray-400 mt-1 flex gap-1">
                                                            {asset.cpu && <span>{asset.cpu}</span>}
                                                            {asset.ram && <span>/ {asset.ram}</span>}
                                                            {asset.storage && <span>/ {asset.storage}</span>}
                                                        </div>
                                                    )}
                                                </td>
                                                <td className="p-4 text-gray-600">
                                                    <div className="flex items-center gap-1"><span className="material-icons text-xs text-gray-400">place</span>{projName}</div>
                                                </td>
                                                <td className="p-4 text-center">
                                                    <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${asset.status === 'operational' || asset.status === 'in_use' ? 'bg-green-100 text-green-700' : asset.status === 'in_storage' ? 'bg-blue-100 text-blue-700' : asset.status === 'faulty' ? 'bg-red-100 text-red-700' : asset.status === 'retired' ? 'bg-gray-200 text-gray-600' : 'bg-orange-100 text-orange-700'}`}>
                                                        {asset.status.replace('_', ' ')}
                                                    </span>
                                                </td>
                                                <td className="p-4 text-center">
                                                    {asset.lastAuditDate ? <div className={`text-xs ${isVerifiedRecently ? 'text-green-600' : 'text-orange-500'}`}>{new Date(asset.lastAuditDate).toLocaleDateString()}</div> : <span className="text-xs text-red-400 italic">Never</span>}
                                                </td>
                                                <td className="p-4 flex justify-center gap-2">
                                                    <button onClick={() => handleVerifyAsset(asset)} className="p-1.5 rounded bg-green-50 text-green-600 hover:bg-green-100" title="Verify"><span className="material-icons text-sm">fact_check</span></button>
                                                    <button onClick={() => openEditAssetModal(asset)} className="p-1.5 rounded bg-blue-50 text-blue-600 hover:bg-blue-100" title="Edit"><span className="material-icons text-sm">edit</span></button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                        {filteredAssets.map(asset => {
                            const isFaulty = asset.status === 'faulty' || asset.status === 'maintenance';
                            return (
                                <div key={asset.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all hover:shadow-md relative group ${isFaulty ? 'border-red-100' : 'border-gray-100'}`}>
                                    {canManageAssets && (
                                        <button onClick={() => openEditAssetModal(asset)} className="absolute top-3 left-3 p-1.5 rounded-full bg-white text-gray-400 hover:text-blue-600 hover:bg-blue-50 border border-gray-200 opacity-0 group-hover:opacity-100 transition-opacity z-10"><span className="material-icons text-sm">edit</span></button>
                                    )}
                                    <div className={`h-1.5 w-full ${asset.status === 'operational' || asset.status === 'in_use' ? 'bg-green-500' : asset.status === 'in_storage' ? 'bg-blue-500' : asset.status === 'faulty' ? 'bg-red-500' : asset.status === 'retired' ? 'bg-gray-400' : 'bg-orange-500'}`}></div>
                                    <div className="p-5">
                                        <div className="flex justify-between items-start mb-4">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-10 h-10 rounded-lg flex items-center justify-center text-xl ${!isFaulty ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}><span className="material-icons">precision_manufacturing</span></div>
                                                <div><h3 className="font-bold text-gray-800 text-lg leading-tight">{asset.name}</h3><p className="text-xs text-gray-500 font-mono mt-0.5">{asset.assetTag || 'NO TAG'}</p></div>
                                            </div>
                                            <span className={`px-2 py-1 rounded text-[10px] font-bold uppercase ${!isFaulty ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>{asset.status.replace('_', ' ')}</span>
                                        </div>
                                        <div className="space-y-3 mb-6">
                                            <div className="flex justify-between text-sm"><span className="text-gray-400">النوع</span><span className="font-bold text-gray-700">{asset.type}</span></div>
                                            {asset.assignedUser && <div className="flex justify-between text-sm"><span className="text-gray-400">مستخدم</span><span className="font-bold text-gray-700">{asset.assignedUser}</span></div>}
                                        </div>
                                        <button onClick={() => openMaintenanceRequestModal(asset)} className="w-full py-2.5 rounded-lg border border-gray-200 text-gray-600 font-bold text-sm hover:bg-gray-50 hover:text-primary transition-colors flex items-center justify-center gap-2"><span className="material-icons text-sm">build</span>طلب صيانة</button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )
            )}

            {/* Maintenance Request Modal */}
            {showRequestModal && selectedAsset && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6 animate-fade-in-up">
                        <div className="flex justify-between items-center mb-6 border-b pb-2">
                            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2"><span className="material-icons text-orange-600">build_circle</span> طلب صيانة</h3>
                            <button onClick={() => setShowRequestModal(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        {submitStatus === 'success' ? (
                            <div className="text-center py-10"><span className="material-icons text-5xl text-green-500 mb-4 animate-bounce">check_circle</span><h3 className="text-xl font-bold text-gray-800">تم إرسال الطلب بنجاح</h3></div>
                        ) : (
                            <form onSubmit={handleSubmitRequest} className="space-y-4">
                                <div className="bg-gray-50 p-3 rounded-lg border border-gray-100">
                                    <label className="block text-xs font-bold text-gray-400 mb-1">الأصل</label>
                                    <div className="font-bold text-gray-800 flex justify-between"><span>{selectedAsset.name}</span><span className="font-mono text-xs bg-white px-1 rounded border">{selectedAsset.assetTag}</span></div>
                                </div>
                                <div>
                                    <label className="block text-xs font-bold text-gray-500 mb-1">الأولوية</label>
                                    <div className="grid grid-cols-4 gap-2">
                                        {['low', 'medium', 'high', 'critical'].map((p) => (
                                            <button key={p} type="button" onClick={() => setRequestForm({ ...requestForm, priority: p as any })} className={`py-2 rounded text-xs font-bold border transition-colors capitalize ${requestForm.priority === p ? (p === 'critical' ? 'bg-red-600 text-white border-red-600' : 'bg-primary text-white border-primary') : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'}`}>{p === 'critical' ? 'حرج' : p === 'high' ? 'عالي' : p === 'medium' ? 'متوسط' : 'منخفض'}</button>
                                        ))}
                                    </div>
                                </div>
                                <div><label className="block text-xs font-bold text-gray-500 mb-1">وصف المشكلة</label><textarea required className="w-full p-3 bg-gray-50 border rounded-lg focus:ring-2 focus:ring-primary outline-none min-h-[100px]" placeholder="اشرح العطل أو سبب طلب الصيانة..." value={requestForm.description} onChange={(e) => setRequestForm({ ...requestForm, description: e.target.value })}></textarea></div>
                                <button type="submit" disabled={submitStatus === 'sending'} className="w-full bg-primary text-white py-3 rounded-lg font-bold shadow-lg shadow-blue-500/20 hover:bg-primary-dark transition-colors flex items-center justify-center gap-2">{submitStatus === 'sending' && <span className="material-icons animate-spin text-sm">sync</span>} إرسال الطلب</button>
                            </form>
                        )}
                    </div>
                </div>
            )}

            {/* BULK WIZARD MODAL */}
            {showBulkModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-6xl h-[90vh] flex flex-col animate-fade-in-up">
                        {/* Wizard Header */}
                        <div className="flex justify-between items-center px-6 py-4 border-b">
                            <div>
                                <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2">
                                    <span className="material-icons text-emerald-600">playlist_add</span>
                                    معالج إضافة الأصول الجماعي (Bulk Wizard)
                                </h3>
                                <p className="text-xs text-gray-500">الخطوة {bulkStep} من 4</p>
                            </div>
                            <button onClick={() => setShowBulkModal(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>

                        {/* Progress Bar */}
                        <div className="w-full bg-gray-100 h-2">
                            <div className="bg-emerald-500 h-2 transition-all duration-300" style={{ width: `${(bulkStep / 4) * 100}%` }}></div>
                        </div>

                        <div className="flex-1 overflow-y-auto p-6 bg-gray-50/50">
                            {/* STEP 1: Common Data */}
                            {bulkStep === 1 && (
                                <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-sm border border-gray-100">
                                    <h4 className="font-bold text-gray-800 mb-6 border-b pb-2 flex items-center gap-2">
                                        <span className="material-icons text-blue-500">settings</span>
                                        البيانات المشتركة (Common Attributes)
                                    </h4>
                                    <div className="grid grid-cols-2 gap-6">
                                        {/* Show Project Selector if currently in 'All' View */}
                                        {projectId === 'all' && (
                                            <div className="col-span-2 bg-blue-50 p-3 rounded-lg border border-blue-100">
                                                <label className="block text-xs font-bold text-blue-800 mb-2">المشروع المستهدف (Target Project) *</label>
                                                <select
                                                    className="w-full p-3 bg-white border rounded-lg outline-none focus:ring-2 focus:ring-primary font-bold text-gray-700"
                                                    value={commonBulkData.targetProjectId}
                                                    onChange={(e) => {
                                                        if (e.target.value === 'NEW_STORAGE') {
                                                            handleCreateStorageProject();
                                                        } else {
                                                            setCommonBulkData({ ...commonBulkData, targetProjectId: e.target.value });
                                                        }
                                                    }}
                                                >
                                                    <option value="">-- اختر المشروع لإضافة الأصول --</option>
                                                    {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                                    {isItSpecialist && !availableProjects.some(p => p.name.includes('Storage') || p.name.includes('المخزن')) && (
                                                        <option value="NEW_STORAGE" className="bg-blue-100 text-blue-800 font-bold">＋ إنشاء مشروع المخزن (Storage)</option>
                                                    )}
                                                </select>
                                            </div>
                                        )}

                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">نوع الجهاز *</label>
                                            <select
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.type}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, type: e.target.value })}
                                            >
                                                {HARDWARE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">الحالة الأولية</label>
                                            <select
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.status}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, status: e.target.value })}
                                            >
                                                {ASSET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                                            </select>
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">CPU</label>
                                            <input
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.cpu}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, cpu: e.target.value })}
                                                placeholder="i5-1135G7"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">RAM</label>
                                            <input
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.ram}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, ram: e.target.value })}
                                                placeholder="16GB"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">Storage</label>
                                            <input
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.storage}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, storage: e.target.value })}
                                                placeholder="512GB SSD"
                                            />
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">تاريخ الشراء</label>
                                            <input
                                                type="date"
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.purchaseDate}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, purchaseDate: e.target.value })}
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-xs font-bold text-gray-500 mb-2">التكلفة (للقطعة الواحدة)</label>
                                            <input
                                                type="number"
                                                className="w-full p-3 bg-gray-50 border rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                value={commonBulkData.cost}
                                                onChange={(e) => setCommonBulkData({ ...commonBulkData, cost: parseFloat(e.target.value) })}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 2: Specific Rows */}
                            {bulkStep === 2 && (
                                <div className="flex flex-col h-full gap-6">
                                    {/* Top Generator Area */}
                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                                        <div className="bg-white border border-gray-200 p-5 rounded-xl shadow-sm">
                                            <h5 className="font-bold text-gray-800 mb-4 flex items-center gap-2">
                                                <span className="material-icons text-blue-500">auto_fix_high</span>
                                                توليد سريع (Quick Generator)
                                            </h5>
                                            <div className="grid grid-cols-12 gap-3">
                                                <div className="col-span-6">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">Model Name (Autocomplete)</label>
                                                    <input
                                                        list="model-suggestions"
                                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary"
                                                        value={generatorModel}
                                                        onChange={(e) => setGeneratorModel(e.target.value)}
                                                        placeholder="e.g. Dell Latitude 5420"
                                                    />
                                                    <datalist id="model-suggestions">
                                                        {modelSuggestions.map((m, i) => <option key={i} value={m} />)}
                                                    </datalist>
                                                </div>
                                                <div className="col-span-3">
                                                    <label className="block text-xs font-bold text-gray-500 mb-1">QTY</label>
                                                    <input
                                                        type="number"
                                                        min="1"
                                                        max="100"
                                                        className="w-full p-2 bg-gray-50 border border-gray-200 rounded-lg outline-none focus:ring-2 focus:ring-primary text-center font-bold"
                                                        value={generatorQty}
                                                        onChange={(e) => setGeneratorQty(Number(e.target.value))}
                                                    />
                                                </div>
                                                <div className="col-span-3 flex items-end">
                                                    <button
                                                        onClick={handleGenerateRows}
                                                        className="w-full bg-blue-600 text-white py-2 rounded-lg font-bold hover:bg-blue-700 transition-colors flex justify-center items-center gap-1 shadow-sm"
                                                    >
                                                        <span className="material-icons text-sm">add_circle</span> Generate
                                                    </button>
                                                </div>
                                            </div>
                                        </div>

                                        <div className="bg-gray-50 border border-gray-200 p-5 rounded-xl flex flex-col justify-center">
                                            <div className="text-xs text-gray-500 font-bold mb-2 uppercase">Bulk Actions</div>
                                            <div className="flex gap-2">
                                                <button onClick={() => setBulkPasteContent('')} className="flex-1 bg-white border border-gray-300 text-gray-700 py-2 rounded-lg font-bold hover:bg-gray-100 flex items-center justify-center gap-2 text-xs">
                                                    <span className="material-icons text-sm">content_paste</span> Paste Excel
                                                </button>
                                                <button onClick={() => setBulkRows([])} className="flex-1 bg-white border border-red-200 text-red-600 py-2 rounded-lg font-bold hover:bg-red-50 flex items-center justify-center gap-2 text-xs">
                                                    <span className="material-icons text-sm">clear_all</span> Clear All
                                                </button>
                                            </div>
                                            {bulkPasteContent !== undefined && (
                                                <textarea
                                                    className="mt-2 w-full p-2 border rounded text-xs h-12 bg-white font-mono focus:ring-2 focus:ring-primary outline-none resize-none"
                                                    placeholder="Paste (Model [Tab] Serial)..."
                                                    value={bulkPasteContent}
                                                    onChange={(e) => setBulkPasteContent(e.target.value)}
                                                    onBlur={handlePasteExcel}
                                                ></textarea>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex-1 bg-white border rounded-xl shadow-sm overflow-hidden flex flex-col">
                                        <div className="overflow-y-auto flex-1">
                                            <table className="w-full text-left text-sm whitespace-nowrap">
                                                <thead className="bg-gray-100 text-gray-600 font-bold sticky top-0 z-10 shadow-sm">
                                                    <tr>
                                                        <th className="p-3 w-12 text-center">#</th>
                                                        <th className="p-3 w-40">Asset Tag (Est.)</th>
                                                        <th className="p-3 w-1/3">Model Name</th>
                                                        <th className="p-3 w-1/3">Serial Number</th>
                                                        <th className="p-3 w-16 text-center">Action</th>
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y">
                                                    {bulkRows.map((row, idx) => (
                                                        <tr key={row.id} className={`hover:bg-gray-50 transition-colors ${row.isDuplicate ? 'bg-red-50' : ''}`}>
                                                            <td className="p-3 text-center text-gray-400 font-mono text-xs">{idx + 1}</td>
                                                            <td className="p-3 font-mono text-xs font-bold text-blue-600 bg-blue-50/30">
                                                                {row.predictedTag || '-'}
                                                            </td>
                                                            <td className="p-3">
                                                                <input
                                                                    className="w-full bg-transparent border-b border-gray-200 focus:border-primary outline-none focus:bg-white px-2 py-1 transition-colors"
                                                                    value={row.model}
                                                                    onChange={(e) => handleBulkRowChange(row.id, 'model', e.target.value)}
                                                                    placeholder="Model Name"
                                                                />
                                                            </td>
                                                            <td className="p-3 relative">
                                                                <div className="flex items-center">
                                                                    <input
                                                                        autoFocus={idx === bulkFocusIndex} // Use the specific focus index
                                                                        className={`w-full bg-transparent border-b outline-none px-2 py-1 font-mono transition-colors ${row.isDuplicate ? 'border-red-300 bg-red-50/50' : 'border-gray-200 focus:border-primary focus:bg-white'}`}
                                                                        value={row.serialNumber}
                                                                        onChange={(e) => handleBulkRowChange(row.id, 'serialNumber', e.target.value)}
                                                                        placeholder="SCAN S/N (Optional)..."
                                                                    />
                                                                    {row.isDuplicate && (
                                                                        <div className="absolute right-4 top-3 flex items-center text-red-600 text-xs font-bold animate-pulse" title="Duplicate Serial Number">
                                                                            <span className="material-icons text-sm mr-1">warning</span>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </td>
                                                            <td className="p-3 text-center">
                                                                <button onClick={() => handleDeleteRow(row.id)} className="text-gray-400 hover:text-red-600 transition-colors p-1 rounded-full hover:bg-red-50"><span className="material-icons text-sm">delete</span></button>
                                                            </td>
                                                        </tr>
                                                    ))}
                                                    {bulkRows.length === 0 && (
                                                        <tr>
                                                            <td colSpan={5} className="p-10 text-center text-gray-400 italic">
                                                                <div className="flex flex-col items-center">
                                                                    <span className="material-icons text-4xl mb-2 text-gray-300">playlist_add</span>
                                                                    <span>Use the generator above to add rows.</span>
                                                                </div>
                                                            </td>
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                        <div className="p-3 border-t bg-gray-50 flex justify-center">
                                            <button onClick={handleAddRow} className="w-full max-w-md py-2 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 font-bold hover:border-primary hover:text-primary transition-colors flex items-center justify-center gap-2 hover:bg-white">
                                                <span className="material-icons">add</span> Add Single Row
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            )}

                            {/* STEP 3: Verification */}
                            {bulkStep === 3 && (
                                <div className="max-w-2xl mx-auto text-center py-8">
                                    <div className="inline-flex items-center justify-center w-20 h-20 bg-blue-50 rounded-full text-blue-600 mb-6">
                                        <span className="material-icons text-5xl">fact_check</span>
                                    </div>
                                    <h4 className="text-3xl font-bold text-gray-800 mb-2">مراجعة البيانات</h4>
                                    <p className="text-gray-500 mb-8 text-lg">أنت على وشك إضافة <span className="font-bold text-blue-600 border-b-2 border-blue-200">{bulkRows.length}</span> أصل جديد.</p>

                                    <div className="bg-white rounded-xl shadow-sm border p-6 text-right grid grid-cols-2 gap-6 mb-10">
                                        <div><span className="text-gray-400 text-xs font-bold uppercase">نوع الأصول</span> <div className="font-bold text-lg text-gray-800">{commonBulkData.type}</div></div>
                                        <div><span className="text-gray-400 text-xs font-bold uppercase">المواصفات</span> <div className="font-bold text-lg text-gray-800">{[commonBulkData.cpu, commonBulkData.ram, commonBulkData.storage].filter(Boolean).join(' / ') || '-'}</div></div>
                                        <div><span className="text-gray-400 text-xs font-bold uppercase">إجمالي التكلفة المتوقعة</span> <div className="font-bold text-lg text-gray-800 font-mono">{(commonBulkData.cost * bulkRows.length).toLocaleString()}</div></div>
                                        <div><span className="text-gray-400 text-xs font-bold uppercase">الحالة</span> <div className="font-bold text-lg text-gray-800">{commonBulkData.status}</div></div>
                                    </div>

                                    <div className="flex justify-center gap-4">
                                        <button
                                            onClick={() => setBulkStep(2)}
                                            disabled={submitStatus === 'sending'}
                                            className="bg-gray-100 text-gray-600 px-8 py-4 rounded-xl font-bold text-lg hover:bg-gray-200 transition-colors"
                                        >
                                            السابق
                                        </button>
                                        <button onClick={handleBulkSubmit} disabled={submitStatus === 'sending'} className="bg-emerald-600 text-white px-10 py-4 rounded-xl font-bold text-lg hover:bg-emerald-700 shadow-lg shadow-emerald-200 flex items-center gap-3 transition-all hover:scale-105 active:scale-95">
                                            {submitStatus === 'sending' ? <span className="material-icons animate-spin">sync</span> : <span className="material-icons">save</span>}
                                            تأكيد وحفظ البيانات
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* STEP 4: Success & Print */}
                            {bulkStep === 4 && (
                                <div className="flex flex-col h-full">
                                    <div className="text-center mb-8">
                                        <div className="inline-flex items-center justify-center w-20 h-20 bg-green-100 rounded-full text-green-600 mb-4 animate-bounce">
                                            <span className="material-icons text-5xl">check_circle</span>
                                        </div>
                                        <h4 className="text-3xl font-bold text-gray-800">تمت العملية بنجاح!</h4>
                                        <p className="text-gray-500 mt-2">تم توليد الرموز الشريطية (Barcodes) وحفظ الأصول في قاعدة البيانات.</p>
                                    </div>

                                    <div className="flex justify-center gap-4 mb-8">
                                        <button onClick={handlePrintLabels} className="bg-gray-800 text-white px-8 py-4 rounded-xl font-bold shadow-lg hover:bg-gray-900 flex items-center gap-3 transition-all hover:-translate-y-1">
                                            <span className="material-icons">print</span> طباعة الملصقات (2x4)
                                        </button>
                                        <button onClick={() => setShowBulkModal(false)} className="bg-gray-100 text-gray-600 px-8 py-4 rounded-xl font-bold hover:bg-gray-200 transition-colors">
                                            إغلاق
                                        </button>
                                    </div>

                                    <div className="flex-1 overflow-y-auto bg-white border rounded-xl p-6 shadow-inner bg-gray-50/30">
                                        <h5 className="font-bold text-gray-500 mb-4 text-center text-sm uppercase tracking-widest">معاينة الأصول المضافة</h5>
                                        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                                            {bulkResults.map((asset, i) => (
                                                <div key={i} className="bg-white border border-gray-200 rounded-lg p-3 flex flex-col items-center shadow-sm hover:shadow-md transition-shadow">
                                                    <div className="text-[10px] font-bold text-gray-500 mb-2 truncate w-full text-center" title={asset.name}>{asset.name}</div>
                                                    <AssetBarcode value={asset.asset_tag} />
                                                    <div className="text-[10px] text-gray-400 font-mono mt-2">{asset.serial_number}</div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Footer Navigation */}
                        {bulkStep < 3 && (
                            <div className="p-4 border-t bg-white flex justify-between items-center">
                                {bulkStep > 1 ? (
                                    <button onClick={() => setBulkStep(prev => prev - 1 as any)} className="text-gray-500 font-bold hover:bg-gray-100 px-6 py-2 rounded-lg transition-colors">السابق</button>
                                ) : <div></div>}

                                <button
                                    onClick={() => {
                                        if (bulkStep === 1) {
                                            if (projectId === 'all' && !commonBulkData.targetProjectId) {
                                                showToast('يرجى اختيار المشروع المستهدف.', 'error');
                                                return;
                                            }
                                            if (!commonBulkData.type) { showToast('Type is required', 'error'); return; }
                                            setBulkStep(2);
                                        } else if (bulkStep === 2) {
                                            if (bulkRows.length === 0) {
                                                showToast('يرجى إضافة صف واحد على الأقل.', 'error'); return;
                                            }

                                            // Validation: Asset Quantity must equal Number of Serial Numbers REMOVED

                                            if (bulkRows.some(r => r.isDuplicate)) {
                                                showToast('يوجد تكرار في الأرقام التسلسلية. يرجى المراجعة.', 'error'); return;
                                            }
                                            setBulkStep(3);
                                        }
                                    }}
                                    className="bg-primary text-white px-8 py-3 rounded-lg font-bold hover:bg-primary-dark flex items-center gap-2 shadow-lg shadow-blue-500/30 transition-all"
                                >
                                    التالي <span className="material-icons text-sm">arrow_back</span>
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Asset Management Modal (Add/Edit) */}
            {showAssetModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
                    <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl p-6 animate-fade-in-up max-h-[90vh] overflow-y-auto">
                        <div className="flex justify-between items-center mb-6 border-b pb-2 sticky top-0 bg-white z-10">
                            <h3 className="font-bold text-lg text-gray-800 flex items-center gap-2"><span className="material-icons text-blue-600">inventory</span>{isEditingAsset ? 'تعديل / نقل الأصل' : 'تسجيل أصل جديد'}</h3>
                            <button onClick={() => setShowAssetModal(false)} className="text-gray-400 hover:text-red-500"><span className="material-icons">close</span></button>
                        </div>
                        <form onSubmit={handleSaveAsset} className="space-y-6">
                            {/* Section 1: Basic Info */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                <h4 className="text-sm font-bold text-blue-800 mb-3 border-b border-blue-200 pb-1">البيانات الأساسية (Basic Info)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">Asset Tag (Barcode) *</label>
                                        <div className="relative">
                                            <input
                                                className="w-full p-2 border rounded-lg bg-gray-100 text-gray-500 cursor-not-allowed font-mono font-bold"
                                                value={assetForm.assetTag}
                                                readOnly
                                                placeholder={isTagGenerating ? 'Generating...' : 'e.g. CD2026-00001'}
                                            />
                                            {isTagGenerating && <span className="absolute right-3 top-2.5 material-icons animate-spin text-sm text-blue-500">sync</span>}
                                        </div>
                                        <p className="text-[10px] text-gray-400 mt-1">الرمز ثابت ولا يمكن تعديله</p>
                                    </div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">اسم الأصل *</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.name} onChange={e => setAssetForm({ ...assetForm, name: e.target.value })} required placeholder="e.g. Dell Latitude 5420" /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">نوع الجهاز</label><select className="w-full p-2 bg-white border rounded-lg" value={assetForm.type} onChange={e => setAssetForm({ ...assetForm, type: e.target.value })}>{HARDWARE_TYPES.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">الحالة</label><select className="w-full p-2 bg-white border rounded-lg" value={assetForm.status} onChange={e => setAssetForm({ ...assetForm, status: e.target.value as any })}>{ASSET_STATUSES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">Serial Number</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.serialNumber} onChange={e => setAssetForm({ ...assetForm, serialNumber: e.target.value })} placeholder="S/N" /></div>
                                </div>
                            </div>

                            {/* Section 2: Technical Specs */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                <h4 className="text-sm font-bold text-blue-800 mb-3 border-b border-blue-200 pb-1">المواصفات الفنية (Technical Specs)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">CPU</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.cpu || ''} onChange={e => setAssetForm({ ...assetForm, cpu: e.target.value })} placeholder="e.g. i7-1185G7" /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">RAM</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.ram || ''} onChange={e => setAssetForm({ ...assetForm, ram: e.target.value })} placeholder="e.g. 16GB" /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">Storage</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.storage || ''} onChange={e => setAssetForm({ ...assetForm, storage: e.target.value })} placeholder="e.g. 512GB SSD" /></div>
                                </div>
                            </div>

                            {/* Section 3: Location & Financials */}
                            <div className="bg-gray-50 p-4 rounded-lg border border-gray-100">
                                <h4 className="text-sm font-bold text-blue-800 mb-3 border-b border-blue-200 pb-1">الموقع والبيانات المالية (Location & Finance)</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="md:col-span-2">
                                        <label className="block text-xs font-bold text-gray-500 mb-1">المشروع (Project)</label>
                                        <select
                                            className="w-full p-2 bg-white border rounded-lg font-bold text-gray-700"
                                            value={assetForm.projectId}
                                            onChange={e => setAssetForm({ ...assetForm, projectId: e.target.value })}
                                            disabled={!isItSpecialist && !isSuperAdmin}
                                        >
                                            <option value="">-- اختر المشروع --</option>
                                            {availableProjects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                                        </select>
                                    </div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">الموقع الفعلي (Location)</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.physicalLocation || ''} onChange={e => setAssetForm({ ...assetForm, physicalLocation: e.target.value })} placeholder="e.g. Room 101" /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">المستخدم المخصص</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.assignedUser || ''} onChange={e => setAssetForm({ ...assetForm, assignedUser: e.target.value })} /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">القسم</label><input className="w-full p-2 bg-white border rounded-lg" value={assetForm.department || ''} onChange={e => setAssetForm({ ...assetForm, department: e.target.value })} /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">تاريخ الشراء</label><input type="date" className="w-full p-2 bg-white border rounded-lg" value={assetForm.purchaseDate || ''} onChange={e => setAssetForm({ ...assetForm, purchaseDate: e.target.value })} /></div>
                                    <div><label className="block text-xs font-bold text-gray-500 mb-1">التكلفة</label><input type="number" className="w-full p-2 bg-white border rounded-lg" value={assetForm.cost || 0} onChange={e => setAssetForm({ ...assetForm, cost: parseFloat(e.target.value) })} /></div>
                                </div>
                            </div>

                            {/* Section 4: Scanner Specifics */}
                            {assetForm.type === 'Scanner' && (
                                <div className="bg-blue-50 p-4 rounded-lg border border-blue-100">
                                    <h4 className="text-sm font-bold text-blue-800 mb-3 border-b border-blue-200 pb-1">إعدادات الماسح الضوئي (Scanner)</h4>
                                    <div>
                                        <label className="block text-xs font-bold text-gray-500 mb-1">عداد المسح الحالي (Current Counter)</label>
                                        <input
                                            type="number"
                                            className="w-full p-2 bg-white border rounded-lg focus:ring-2 focus:ring-blue-400 outline-none"
                                            value={assetForm.currentCounter || 0}
                                            onChange={e => setAssetForm({ ...assetForm, currentCounter: parseInt(e.target.value) })}
                                        />
                                    </div>
                                </div>
                            )}

                            <div className="flex gap-4 pt-4 border-t">
                                <button type="button" onClick={() => setShowAssetModal(false)} className="flex-1 bg-gray-100 text-gray-600 py-3 rounded-lg font-bold hover:bg-gray-200 transition-colors">إلغاء</button>
                                <button type="submit" disabled={submitStatus === 'sending'} className="flex-1 bg-blue-600 text-white py-3 rounded-lg font-bold hover:bg-blue-700 shadow-lg shadow-blue-200 transition-colors flex justify-center items-center gap-2">
                                    {submitStatus === 'sending' ? <span className="material-icons animate-spin text-sm">sync</span> : <span className="material-icons text-sm">save</span>}
                                    {isEditingAsset ? 'حفظ التغييرات' : 'تسجيل الأصل'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AssetDashboard;
