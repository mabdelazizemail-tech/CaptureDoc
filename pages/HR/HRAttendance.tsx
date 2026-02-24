import React, { useState, useEffect } from 'react';
import { supabase } from '../../services/supabaseClient';
import * as XLSX from 'xlsx';

interface AttendanceRecord {
    id: string;
    employee_id: string;
    employee_name?: string;
    date: string;
    check_in: string | null;
    check_out: string | null;
    late_minutes: number;
    overtime_minutes: number;
}

interface Employee {
    id: string;
    full_name: string;
    employee_code?: string;
    email?: string;
}

import { User } from '../../services/types';

interface HRAttendanceProps {
    user: User;
    selectedProjectId: string;
}

const HRAttendance: React.FC<HRAttendanceProps> = ({ user, selectedProjectId }) => {
    const [attendance, setAttendance] = useState<AttendanceRecord[]>([]);
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
    const [isSaving, setIsSaving] = useState(false);
    const [uploading, setUploading] = useState(false);

    useEffect(() => {
        fetchData();
    }, [selectedDate, selectedProjectId]);

    const fetchData = async () => {
        setLoading(true);
        try {
            // Fetch active employees
            let empQuery = supabase.from('hr_employees').select('id, full_name, employee_code, email').eq('status', 'active');

            const projectToFilter = (user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin')
                ? (selectedProjectId !== 'all' ? selectedProjectId : null)
                : user.projectId;

            if (projectToFilter) {
                const { data: proj } = await supabase.from('projects').select('name').eq('id', projectToFilter).single();
                if (proj) {
                    empQuery = empQuery.or(`project.eq.${proj.name},project.eq.${projectToFilter}`);
                } else {
                    empQuery = empQuery.eq('project', projectToFilter);
                }
            }
            const { data: empData } = await empQuery;
            if (empData) setEmployees(empData);

            // Fetch attendance for selected date
            let attQuery = supabase.from('hr_attendance').select('*').eq('date', selectedDate);
            if (projectToFilter) {
                // We need to filter attendance records by employee project
                const empIds = empData?.map(e => e.id) || [];
                attQuery = attQuery.in('employee_id', empIds);
            }
            const { data: attData } = await attQuery;

            // Merge data: ensuring every active employee has a row (even if empty)
            const merged = (empData || []).map(emp => {
                const record = attData?.find(r => r.employee_id === emp.id);
                return {
                    id: record?.id || `new-${emp.id}`,
                    employee_id: emp.id,
                    employee_name: emp.full_name,
                    date: selectedDate,
                    check_in: record?.check_in || null,
                    check_out: record?.check_out || null,
                    late_minutes: record?.late_minutes || 0,
                    overtime_minutes: record?.overtime_minutes || 0
                };
            });

            setAttendance(merged);
        } catch (error) {
            console.error("Error fetching attendance:", error);
        } finally {
            setLoading(false);
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

            // Fetch all employees for mapping
            const { data: emps } = await supabase.from('hr_employees').select('id, employee_code, email');
            if (!emps) throw new Error("Could not fetch employees for mapping");

            const empMap = new Map();
            emps.forEach(emp => {
                if (emp.employee_code) empMap.set(String(emp.employee_code).trim(), emp.id);
                if (emp.email) empMap.set(emp.email.toLowerCase().trim(), emp.id);
            });

            let errorCount = 0;
            const upsertData: any[] = [];

            for (const row of jsonData) {
                const identifier = String(row.employee_code || row.email || "").trim().toLowerCase();
                const empId = empMap.get(identifier) || empMap.get(String(row.employee_code).trim());

                let rowDate = row.date;
                if (!rowDate) {
                    errorCount++;
                    continue;
                }

                // Handle Excel serial date or string
                if (typeof rowDate === 'number') {
                    rowDate = new Date((rowDate - 25569) * 86400 * 1000).toISOString().split('T')[0];
                } else {
                    try {
                        rowDate = new Date(rowDate).toISOString().split('T')[0];
                    } catch {
                        errorCount++;
                        continue;
                    }
                }

                if (empId && rowDate) {
                    upsertData.push({
                        employee_id: empId,
                        date: rowDate,
                        check_in: row.check_in || null,
                        check_out: row.check_out || null,
                        late_minutes: parseInt(row.late_minutes) || 0,
                        overtime_minutes: parseInt(row.overtime_minutes) || 0
                    });
                } else {
                    errorCount++;
                }
            }

            if (upsertData.length > 0) {
                const { error } = await supabase.from('hr_attendance').upsert(upsertData, {
                    onConflict: 'employee_id,date'
                });

                if (error) {
                    alert("حدث خطأ أثناء الرفع: " + error.message);
                } else {
                    alert(`تم الرفع بنجاح: تم معالجة (${upsertData.length}) سجل، فشل (${errorCount})`);
                    fetchData();
                }
            } else {
                alert("لم يتم العثور على بيانات صالحة للرفع. تأكد من تطابق الرقم الوظيفي أو البريد الإلكتروني.");
            }

        } catch (err: any) {
            alert("حدث خطأ أثناء معالجة الملف: " + err.message);
        } finally {
            setUploading(false);
            if (e.target) e.target.value = '';
        }
    };

    const downloadTemplate = () => {
        const headers = ['employee_code', 'date', 'check_in', 'check_out', 'late_minutes', 'overtime_minutes'];
        const sampleData = [
            ['EMP001', '2024-03-20', '08:30', '16:30', '0', '60'],
            ['EMP002', '2024-03-20', '09:15', '17:00', '45', '0']
        ];
        const worksheet = XLSX.utils.aoa_to_sheet([headers, ...sampleData]);
        const workbook = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Attendance');
        XLSX.writeFile(workbook, 'Attendance_Template.xlsx');
    };

    const handleTimeChange = (empId: string, field: 'check_in' | 'check_out', value: string) => {
        setAttendance(prev => prev.map(rec => {
            if (rec.employee_id === empId) {
                return { ...rec, [field]: value || null };
            }
            return rec;
        }));
    };

    const handleNumericChange = (empId: string, field: 'late_minutes' | 'overtime_minutes', value: string) => {
        const num = parseInt(value) || 0;
        setAttendance(prev => prev.map(rec => {
            if (rec.employee_id === empId) {
                return { ...rec, [field]: num };
            }
            return rec;
        }));
    };

    const saveAttendance = async () => {
        setIsSaving(true);
        try {
            const updates = attendance.filter(rec => !rec.id.startsWith('new-')).map(rec =>
                supabase.from('hr_attendance').update({
                    check_in: rec.check_in,
                    check_out: rec.check_out,
                    late_minutes: rec.late_minutes,
                    overtime_minutes: rec.overtime_minutes
                }).eq('id', rec.id)
            );

            const inserts = attendance.filter(rec => rec.id.startsWith('new-') && (rec.check_in || rec.check_out || rec.late_minutes > 0 || rec.overtime_minutes > 0)).map(rec =>
                supabase.from('hr_attendance').insert({
                    employee_id: rec.employee_id,
                    date: rec.date,
                    check_in: rec.check_in,
                    check_out: rec.check_out,
                    late_minutes: rec.late_minutes,
                    overtime_minutes: rec.overtime_minutes
                })
            );

            const results = await Promise.all([...updates, ...inserts]);
            const errors = results.filter(r => r.error).map(r => r.error?.message);

            if (errors.length > 0) {
                alert('حدث خطأ أثناء حفظ بعض السجلات: ' + errors[0]);
            } else {
                alert('تم حفظ كشف الحضور بنجاح');
            }
            fetchData();
        } catch (error: any) {
            alert('حدث خطأ غير متوقع: ' + error.message);
        } finally {
            setIsSaving(false);
        }
    };

    return (
        <div className="space-y-6 animate-fade-in-up">
            <div className="flex flex-col md:flex-row justify-between items-start md:items-center bg-white p-4 rounded-xl shadow-sm border border-gray-100 gap-4">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-50 text-blue-600 rounded-lg">
                        <span className="material-icons">how_to_reg</span>
                    </div>
                    <div>
                        <h2 className="text-xl font-bold text-gray-800">تجسيل الحضور والانصراف اليومي</h2>
                        <p className="text-xs text-gray-500">سجل بيانات الحضور، التأخير، والإضافي لكل موظف</p>
                    </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap w-full md:w-auto">
                    <input
                        type="date"
                        value={selectedDate}
                        onChange={(e) => setSelectedDate(e.target.value)}
                        className="border border-gray-200 rounded-lg px-4 py-2 font-bold text-gray-700 focus:ring-2 focus:ring-primary outline-none"
                    />

                    <button
                        onClick={downloadTemplate}
                        className="bg-white border text-gray-600 px-4 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-gray-50 transition shadow-sm"
                        title="تحميل قالب الرفع"
                    >
                        <span className="material-icons">download</span>
                        Template
                    </button>

                    <label className={`bg-white border-2 border-primary text-primary px-4 py-2 rounded-lg font-bold flex items-center gap-2 ${uploading ? 'opacity-50 cursor-not-allowed' : 'hover:bg-blue-50 cursor-pointer'} transition`}>
                        <span className="material-icons">{uploading ? 'hourglass_empty' : 'upload_file'}</span>
                        {uploading ? 'جاري الرفع...' : 'رفع ملف البصمة'}
                        <input type="file" hidden accept=".xlsx, .xls, .csv" onChange={handleFileUpload} disabled={uploading} />
                    </label>

                    <button
                        onClick={saveAttendance}
                        disabled={isSaving}
                        className="bg-primary text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 hover:bg-blue-700 transition shadow-sm disabled:opacity-50"
                    >
                        <span className="material-icons">{isSaving ? 'hourglass_top' : 'save'}</span>
                        {isSaving ? 'جاري الحفظ...' : 'حفظ الكشوفات'}
                    </button>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
                {loading ? (
                    <div className="p-20 text-center">
                        <div className="animate-spin h-10 w-10 border-4 border-primary border-t-transparent rounded-full mx-auto mb-4"></div>
                        <p className="text-gray-500">جاري تحميل كشف الموظفين...</p>
                    </div>
                ) : (
                    <table className="w-full text-right border-collapse">
                        <thead className="bg-gray-50 text-gray-600 border-b">
                            <tr>
                                <th className="p-4 font-bold">اسم الموظف</th>
                                <th className="p-4 font-bold text-center">دخول</th>
                                <th className="p-4 font-bold text-center">خروج</th>
                                <th className="p-4 font-bold text-center">دقائق التأخير</th>
                                <th className="p-4 font-bold text-center">دقائق الإضافي</th>
                                <th className="p-4 font-bold text-center">الحالة</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-100">
                            {attendance.map(rec => (
                                <tr key={rec.id} className="hover:bg-gray-50 transition-colors">
                                    <td className="p-4 font-bold text-gray-800">{rec.employee_name}</td>
                                    <td className="p-4">
                                        <input
                                            type="time"
                                            value={rec.check_in || ''}
                                            onChange={(e) => handleTimeChange(rec.employee_id, 'check_in', e.target.value)}
                                            className="w-full p-2 border border-gray-200 rounded text-center focus:ring-1 focus:ring-primary outline-none"
                                        />
                                    </td>
                                    <td className="p-4">
                                        <input
                                            type="time"
                                            value={rec.check_out || ''}
                                            onChange={(e) => handleTimeChange(rec.employee_id, 'check_out', e.target.value)}
                                            className="w-full p-2 border border-gray-200 rounded text-center focus:ring-1 focus:ring-primary outline-none"
                                        />
                                    </td>
                                    <td className="p-4">
                                        <input
                                            type="number"
                                            value={rec.late_minutes}
                                            onChange={(e) => handleNumericChange(rec.employee_id, 'late_minutes', e.target.value)}
                                            className={`w-24 p-2 border rounded text-center focus:ring-1 focus:ring-primary outline-none mx-auto block ${rec.late_minutes > 0 ? 'bg-red-50 text-red-600 border-red-200 font-bold' : 'border-gray-200'}`}
                                        />
                                    </td>
                                    <td className="p-4">
                                        <input
                                            type="number"
                                            value={rec.overtime_minutes}
                                            onChange={(e) => handleNumericChange(rec.employee_id, 'overtime_minutes', e.target.value)}
                                            className={`w-24 p-2 border rounded text-center focus:ring-1 focus:ring-primary outline-none mx-auto block ${rec.overtime_minutes > 0 ? 'bg-green-50 text-green-600 border-green-200 font-bold' : 'border-gray-200'}`}
                                        />
                                    </td>
                                    <td className="p-4 text-center">
                                        {!rec.check_in && !rec.check_out ? (
                                            <span className="bg-orange-100 text-orange-600 px-3 py-1 rounded-full text-[10px] font-bold">لم يسجل</span>
                                        ) : (
                                            <span className="bg-green-100 text-green-600 px-3 py-1 rounded-full text-[10px] font-bold">حاضر</span>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>

            <div className="bg-gray-50 p-4 rounded-xl border border-gray-200 text-xs text-gray-500 flex items-center gap-2">
                <span className="material-icons text-sm">lightbulb</span>
                <span>تلميح: يمكنك إدخال بيانات يوم سابق عن طريق تغيير التاريخ من الأعلى قبل الحفظ.</span>
            </div>
        </div>
    );
};

export default HRAttendance;
