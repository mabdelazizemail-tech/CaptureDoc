import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import * as XLSX from 'xlsx';

interface Employee {
    id: string;
    full_name: string;
    email: string;
    phone: string;
    national_id: string;
    employee_code: string;
    address: string;
    insurance_number: string;
    insurance_date: string;
    insurance_salary: number;
    gender: string;
    date_of_birth: string;
    education: string;
    hire_date: string;
    job_title: string;
    department: string;
    project: string;
    basic_salary: number;
    variable_salary: number;
    status: string;
}

const HREmployees: React.FC = () => {
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [showModal, setShowModal] = useState(false);
    const [editingEmp, setEditingEmp] = useState<Partial<Employee>>({});
    const [uploading, setUploading] = useState(false);
    const [projectsList, setProjectsList] = useState<{ id: string; name: string }[]>([]);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedEmployees, setSelectedEmployees] = useState<string[]>([]);

    useEffect(() => {
        fetchEmployees();
        fetchProjects();
    }, []);

    const fetchProjects = async () => {
        const { data } = await supabase.from('projects').select('id, name');
        if (data) setProjectsList(data);
    };

    const fetchEmployees = async () => {
        setLoading(true);
        const { data } = await supabase.from('hr_employees').select('*').order('created_at', { ascending: false });
        if (data) setEmployees(data);
        setLoading(false);
        setSelectedEmployees([]);
    };

    const handleDeleteSelected = async () => {
        if (selectedEmployees.length === 0) return;
        if (!confirm(`هل أنت متأكد من حذف ${selectedEmployees.length} موظف(ين)؟ سيتم حذف جميع بياناتهم المتعلقة كالغياب والإجازات والرواتب.`)) return;

        const { error } = await supabase.rpc('hr_delete_employees', { p_ids: selectedEmployees });
        if (error) {
            alert('حدث خطأ أثناء الحذف: ' + error.message);
        } else {
            fetchEmployees();
        }
    };

    const handleSave = async (e: React.FormEvent) => {
        e.preventDefault();

        // Validate required numbers
        const basic = parseFloat((editingEmp.basic_salary as unknown as string) || '0');
        const variable = parseFloat((editingEmp.variable_salary as unknown as string) || '0');
        const insSalary = parseFloat((editingEmp.insurance_salary as unknown as string) || '0');

        if (basic <= 0) {
            alert("Basic salary must be greater than 0");
            return;
        }

        const { error } = await supabase.rpc('hr_update_employee', {
            p_id: editingEmp.id || null,
            p_full_name: editingEmp.full_name,
            p_email: editingEmp.email,
            p_phone: editingEmp.phone || null,
            p_national_id: editingEmp.national_id || null,
            p_employee_code: editingEmp.employee_code || null,
            p_address: editingEmp.address || null,
            p_insurance_number: editingEmp.insurance_number || null,
            p_insurance_date: editingEmp.insurance_date || null,
            p_insurance_salary: insSalary,
            p_gender: editingEmp.gender || null,
            p_date_of_birth: editingEmp.date_of_birth || null,
            p_education: editingEmp.education || null,
            p_hire_date: editingEmp.hire_date,
            p_job_title: editingEmp.job_title || null,
            p_department: editingEmp.department || null,
            p_project: editingEmp.project || null,
            p_basic_salary: basic,
            p_variable_salary: variable,
            p_status: editingEmp.status || 'active'
        });

        if (error) {
            alert(`Error saving employee: ${error.message}`);
        } else {
            setShowModal(false);
            setEditingEmp({});
            fetchEmployees();
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        try {
            const data = await file.arrayBuffer();
            const workbook = XLSX.read(data);
            const worksheet = workbook.Sheets[workbook.SheetNames[0]];
            const jsonData = XLSX.utils.sheet_to_json<any>(worksheet);

            let successCount = 0;
            let errorCount = 0;

            for (const row of jsonData) {
                const basic = parseFloat(row.basic_salary) || 0;
                if (basic <= 0 || !row.full_name || !row.email || !row.hire_date) {
                    errorCount++;
                    continue;
                }

                const { error } = await supabase.rpc('hr_update_employee', {
                    p_id: null,
                    p_full_name: row.full_name,
                    p_email: row.email,
                    p_phone: row.phone ? String(row.phone) : null,
                    p_national_id: row.national_id ? String(row.national_id) : null,
                    p_employee_code: row.employee_code ? String(row.employee_code) : null,
                    p_address: row.address || null,
                    p_insurance_number: row.insurance_number ? String(row.insurance_number) : null,
                    p_insurance_date: row.insurance_date ? new Date(row.insurance_date).toISOString().split('T')[0] : null,
                    p_insurance_salary: parseFloat(row.insurance_salary) || 0,
                    p_gender: row.gender || null,
                    p_date_of_birth: row.date_of_birth ? new Date(row.date_of_birth).toISOString().split('T')[0] : null,
                    p_education: row.education || null,
                    p_hire_date: new Date(row.hire_date).toISOString().split('T')[0],
                    p_job_title: row.job_title || null,
                    p_department: row.department || null,
                    p_project: row.project || null,
                    p_basic_salary: basic,
                    p_variable_salary: parseFloat(row.variable_salary) || 0,
                    p_status: row.status || 'active'
                });

                if (error) {
                    console.error("Error inserting row", row, error);
                    errorCount++;
                } else {
                    successCount++;
                }
            }

            alert(`تم الانتهاء: نجاح (${successCount}) موظف، فشل (${errorCount})`);
            fetchEmployees();
        } catch (err: any) {
            alert("حدث خطأ أثناء رفع الملف: " + err.message);
        } finally {
            setUploading(false);
            e.target.value = '';
        }
    };

    const downloadTemplate = () => {
        const headers = [
            'full_name', 'email', 'phone', 'national_id', 'employee_code',
            'address', 'insurance_number', 'insurance_date', 'insurance_salary',
            'gender', 'date_of_birth', 'education', 'hire_date', 'job_title',
            'department', 'project', 'basic_salary', 'variable_salary', 'status'
        ];
        // Create an empty worksheet with just the headers
        const worksheet = XLSX.utils.aoa_to_sheet([headers]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Template');
        XLSX.writeFile(workbook, 'Employees_Upload_Template.xlsx');
    };

    const filteredEmployees = employees.filter(emp =>
        emp.full_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (emp.employee_code && emp.employee_code.includes(searchQuery)) ||
        (emp.national_id && emp.national_id.includes(searchQuery))
    );

    return (
        <div className="space-y-6">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
                <h2 className="text-xl font-bold flex items-center gap-2 mb-2 md:mb-0">
                    <span className="material-icons text-indigo-500">groups</span>
                    إدارة الموظفين
                </h2>
                <div className="flex-1 w-full md:w-auto max-w-md">
                    <div className="relative">
                        <span className="material-icons absolute top-2.5 right-3 text-gray-400">search</span>
                        <input
                            type="text"
                            placeholder="بحث بالاسم، الرقم الوظيفي، أو الرقم القومي..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full border border-gray-200 rounded-lg py-2 pr-10 pl-4 focus:ring-2 focus:ring-primary focus:border-transparent outline-none"
                        />
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap">
                    {selectedEmployees.length > 0 && (
                        <button
                            onClick={handleDeleteSelected}
                            className="bg-red-50 text-red-600 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-red-100 transition shadow-sm"
                        >
                            <span className="material-icons">delete</span>
                            حذف المحددين ({selectedEmployees.length})
                        </button>
                    )}
                    <button
                        onClick={downloadTemplate}
                        className="bg-white border text-gray-600 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-50 transition shadow-sm"
                        title="تحميل قالب الرفع"
                    >
                        <span className="material-icons">download</span>
                        تحميل القالب
                    </button>
                    <label className={`bg-white border-2 border-primary text-primary px-4 py-2 rounded-lg font-bold flex items-center gap-2 ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'} transition`}>
                        <span className="material-icons">{uploading ? 'hourglass_empty' : 'upload_file'}</span>
                        {uploading ? 'جاري الرفع...' : 'رفع (CSV/Excel)'}
                        <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={uploading} />
                    </label>
                    <button
                        onClick={() => { setEditingEmp({ hire_date: new Date().toISOString().split('T')[0], status: 'active' }); setShowModal(true); }}
                        className="bg-primary text-white px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition"
                    >
                        <span className="material-icons">add</span>
                        إضافة موظف
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="p-8 text-center text-gray-500">جاري التحميل...</div>
                ) : (
                    <table className="w-full text-right">
                        <thead className="bg-gray-50 border-b">
                            <tr>
                                <th className="p-4 w-10">
                                    <input
                                        type="checkbox"
                                        className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                                        checked={filteredEmployees.length > 0 && selectedEmployees.length === filteredEmployees.length}
                                        onChange={(e) => {
                                            if (e.target.checked) setSelectedEmployees(filteredEmployees.map(emp => emp.id));
                                            else setSelectedEmployees([]);
                                        }}
                                    />
                                </th>
                                <th className="p-4 font-bold text-gray-600">الاسم</th>
                                <th className="p-4 font-bold text-gray-600">الرقم الوظيفي</th>
                                <th className="p-4 font-bold text-gray-600">المسمى الوظيفي</th>
                                <th className="p-4 font-bold text-gray-600">الأساسي</th>
                                <th className="p-4 font-bold text-gray-600">الحالة</th>
                                <th className="p-4 font-bold text-gray-600">إجراء</th>
                            </tr>
                        </thead>
                        <tbody>
                            {filteredEmployees.map(emp => (
                                <tr key={emp.id} className="border-b hover:bg-gray-50">
                                    <td className="p-4">
                                        <input
                                            type="checkbox"
                                            className="w-4 h-4 text-primary rounded border-gray-300 focus:ring-primary"
                                            checked={selectedEmployees.includes(emp.id)}
                                            onChange={(e) => {
                                                if (e.target.checked) setSelectedEmployees([...selectedEmployees, emp.id]);
                                                else setSelectedEmployees(selectedEmployees.filter(id => id !== emp.id));
                                            }}
                                        />
                                    </td>
                                    <td className="p-4">
                                        <div className="font-bold">{emp.full_name}</div>
                                        <div className="text-xs text-gray-500">{emp.email} <span className="opacity-50 mx-1">|</span> {emp.phone || "بدون هاتف"}</div>
                                    </td>
                                    <td className="p-4 font-mono text-sm text-gray-500">{emp.employee_code || '-'}</td>
                                    <td className="p-4">
                                        <div>{emp.job_title || '-'}</div>
                                        <div className="text-xs text-gray-500">{emp.department || '-'}</div>
                                    </td>
                                    <td className="p-4 text-green-600 font-bold">{emp.basic_salary} EGP</td>
                                    <td className="p-4">
                                        <span className={`px-2 py-1 rounded text-xs font-bold ${emp.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                                            {emp.status === 'active' ? 'نشط' : 'غير نشط'}
                                        </span>
                                    </td>
                                    <td className="p-4 flex gap-2">
                                        <button
                                            onClick={() => { setEditingEmp(emp); setShowModal(true); }}
                                            className="text-blue-500 hover:text-blue-700 p-2 bg-blue-50 rounded"
                                            title="تعديل"
                                        >
                                            <span className="material-icons text-sm">edit</span>
                                        </button>
                                        <button
                                            onClick={() => {
                                                if (confirm(`هل أنت متأكد من حذف ${emp.full_name}؟`)) {
                                                    supabase.rpc('hr_delete_employees', { p_ids: [emp.id] }).then(() => fetchEmployees());
                                                }
                                            }}
                                            className="text-red-500 hover:text-red-700 p-2 bg-red-50 rounded"
                                            title="حذف"
                                        >
                                            <span className="material-icons text-sm">delete</span>
                                        </button>
                                    </td>
                                </tr>
                            ))}
                            {filteredEmployees.length === 0 && (
                                <tr><td colSpan={7} className="p-8 text-center text-gray-400">لا يوجد بيانات للعرض.</td></tr>
                            )}
                        </tbody>
                    </table>
                )}
            </div>

            {showModal && (
                <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4">
                    <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
                        <div className="p-4 border-b flex justify-between items-center sticky top-0 bg-white">
                            <h3 className="font-bold text-lg">{editingEmp.id ? 'تعديل موظف' : 'إضافة موظف جديد'}</h3>
                            <button onClick={() => setShowModal(false)} className="text-gray-400 hover:text-red-500">
                                <span className="material-icons">close</span>
                            </button>
                        </div>
                        <form onSubmit={handleSave} className="p-6">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الاسم الرباعي *</label>
                                    <input required type="text" className="w-full border rounded p-2" value={editingEmp.full_name || ''} onChange={e => setEditingEmp({ ...editingEmp, full_name: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">البريد الإلكتروني *</label>
                                    <input required type="email" className="w-full border rounded p-2" value={editingEmp.email || ''} onChange={e => setEditingEmp({ ...editingEmp, email: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">رقم الهاتف</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.phone || ''} onChange={e => setEditingEmp({ ...editingEmp, phone: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الرقم القومي</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.national_id || ''} onChange={e => setEditingEmp({ ...editingEmp, national_id: e.target.value })} />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الرقم الوظيفي</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.employee_code || ''} onChange={e => setEditingEmp({ ...editingEmp, employee_code: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">العنوان</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.address || ''} onChange={e => setEditingEmp({ ...editingEmp, address: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الرقم التأميني</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.insurance_number || ''} onChange={e => setEditingEmp({ ...editingEmp, insurance_number: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">تاريخ التسجيل التأميني</label>
                                    <input type="date" className="w-full border rounded p-2" value={editingEmp.insurance_date || ''} onChange={e => setEditingEmp({ ...editingEmp, insurance_date: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الأجر التأميني</label>
                                    <input type="number" step="0.01" className="w-full border rounded p-2" value={editingEmp.insurance_salary || ''} onChange={e => setEditingEmp({ ...editingEmp, insurance_salary: parseFloat(e.target.value) })} />
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">تاريخ الميلاد</label>
                                    <input type="date" className="w-full border rounded p-2" value={editingEmp.date_of_birth || ''} onChange={e => setEditingEmp({ ...editingEmp, date_of_birth: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">النوع</label>
                                    <select className="w-full border rounded p-2" value={editingEmp.gender || ''} onChange={e => setEditingEmp({ ...editingEmp, gender: e.target.value })}>
                                        <option value="">اختيار...</option>
                                        <option value="male">ذكر</option>
                                        <option value="female">أنثى</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">المؤهل الدراسي</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.education || ''} onChange={e => setEditingEmp({ ...editingEmp, education: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">تاريخ التعيين *</label>
                                    <input required type="date" className="w-full border rounded p-2" value={editingEmp.hire_date || ''} onChange={e => setEditingEmp({ ...editingEmp, hire_date: e.target.value })} />
                                </div>

                                <div className="col-span-2 border-t pt-4 mt-2">
                                    <h4 className="font-bold text-primary mb-3">بيانات العمل</h4>
                                </div>

                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">المسمى الوظيفي</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.job_title || ''} onChange={e => setEditingEmp({ ...editingEmp, job_title: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">القسم / الإدارة</label>
                                    <input type="text" className="w-full border rounded p-2" value={editingEmp.department || ''} onChange={e => setEditingEmp({ ...editingEmp, department: e.target.value })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">المشروع</label>
                                    <select className="w-full border rounded p-2" value={editingEmp.project || ''} onChange={e => setEditingEmp({ ...editingEmp, project: e.target.value })}>
                                        <option value="">(بدون مشروع)</option>
                                        {projectsList.map(p => (
                                            <option key={p.id} value={p.name}>{p.name}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الحالة</label>
                                    <select className="w-full border rounded p-2" value={editingEmp.status || 'active'} onChange={e => setEditingEmp({ ...editingEmp, status: e.target.value })}>
                                        <option value="active">نشط</option>
                                        <option value="inactive">غير نشط</option>
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">الراتب الأساسي *</label>
                                    <input required min="1" type="number" step="0.01" className="w-full border rounded p-2" value={editingEmp.basic_salary || ''} onChange={e => setEditingEmp({ ...editingEmp, basic_salary: parseFloat(e.target.value) })} />
                                </div>
                                <div>
                                    <label className="block text-sm font-bold text-gray-700 mb-1">البدلات (المتغير)</label>
                                    <input type="number" step="0.01" className="w-full border rounded p-2" value={editingEmp.variable_salary || ''} onChange={e => setEditingEmp({ ...editingEmp, variable_salary: parseFloat(e.target.value) })} />
                                </div>
                            </div>

                            <div className="mt-6 flex justify-end gap-3 border-t pt-4 sticky bottom-0 bg-white">
                                <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 border rounded font-bold text-gray-600 hover:bg-gray-50">إلغاء</button>
                                <button type="submit" className="px-6 py-2 bg-primary text-white rounded font-bold hover:bg-blue-700">حفظ الموظف</button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};

export default HREmployees;
