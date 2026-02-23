import React, { useState, useEffect } from 'react';
import { User } from '../../services/types';
import { supabase } from '../../services/supabaseClient';
import HREmployees from './HREmployees';
import HRAttendance from './HRAttendance';
import HRKPIs from './HRKPIs';
import HRHolidays from './HRHolidays';
import HRLeave from './HRLeave';

interface HRDashboardProps {
    user: User;
}

const HRDashboard: React.FC<HRDashboardProps> = ({ user }) => {
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');
    const [projectName, setProjectName] = useState<string>('');
    const [selectedProjectId, setSelectedProjectId] = useState<string>(user.projectId || 'all');
    const [allProjects, setAllProjects] = useState<{ id: string, name: string }[]>([]);

    useEffect(() => {
        async function fetchProjects() {
            if (isFullAdmin) {
                const { data } = await supabase.from('projects').select('id, name');
                if (data) setAllProjects(data);
            }
        }
        fetchProjects();
    }, [user.role]);

    useEffect(() => {
        async function fetchInitialData() {
            try {
                console.log("HRDashboard: Fetching initial data for user", user.id, "Project:", selectedProjectId);
                setLoading(true);

                // Fetch Project Name if applicable (display only)
                if (selectedProjectId !== 'all') {
                    const { data: proj } = await supabase.from('projects').select('name').eq('id', selectedProjectId).single();
                    if (proj) setProjectName(proj.name);
                } else {
                    setProjectName('جميع المشاريع');
                }

                // Metrics fetch
                console.log("HRDashboard: Fetching metrics for", selectedProjectId);
                const { data: mData, error: mErr } = await supabase.rpc('get_dashboard_metrics', {
                    p_project_id: selectedProjectId === 'all' ? null : selectedProjectId
                });

                if (mErr) {
                    console.error("HRDashboard: Error calling get_dashboard_metrics:", mErr);
                } else if (mData) {
                    setMetrics(mData);
                }

                setLoading(false);
            } catch (err) {
                console.error("HRDashboard: Critical error in fetchInitialData:", err);
                setLoading(false);
            }
        }
        fetchInitialData();
    }, [user.id, selectedProjectId]);

    if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

    const isFullAdmin = user.role === 'super_admin' || user.role === 'power_admin' || user.role === 'it_specialist' || user.role === 'hr_admin';

    return (
        <div className="space-y-6 animate-fade-in">

            {/* Sub-navigation for HR Module */}
            <div className="flex bg-white rounded-xl shadow-sm border border-gray-100 p-2 gap-2 overflow-x-auto">
                <button
                    onClick={() => setActiveTab('overview')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'overview' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">dashboard</span>
                    نظرة عامة
                </button>
                <button
                    onClick={() => setActiveTab('employees')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'employees' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">badge</span>
                    إدارة الموظفين
                </button>
                <button
                    onClick={() => setActiveTab('attendance')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'attendance' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">how_to_reg</span>
                    الحضور والغياب
                </button>
                <button
                    onClick={() => setActiveTab('leave')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'leave' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">flight_takeoff</span>
                    الاجازات
                </button>
                <button
                    onClick={() => setActiveTab('payroll')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'payroll' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">payments</span>
                    نظام الرواتب
                </button>
                <button
                    onClick={() => setActiveTab('kpi')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'kpi' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">analytics</span>
                    تقييم الأداء (KPIs)
                </button>
                <button
                    onClick={() => setActiveTab('holidays')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'holidays' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">event</span>
                    العطلات
                </button>
            </div>

            {activeTab === 'overview' && (
                <div className="space-y-6 animate-fade-in-up">
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-start gap-3 shadow-sm">
                        <span className="material-icons mt-0.5 text-blue-500">info</span>
                        <div>
                            <p className="font-bold">مرحباً بك في نظام الموارد البشرية</p>
                            <p className="text-sm opacity-90">شاشة التقارير والمتابعة للموارد البشرية</p>
                        </div>
                    </div>

                    {isFullAdmin && (
                        <div className="flex items-center gap-4 bg-white p-4 rounded-xl shadow-sm border border-gray-100">
                            <span className="material-icons text-gray-400">filter_list</span>
                            <span className="text-sm font-bold text-gray-600">عرض بيانات:</span>
                            <div className="flex-1 max-w-xs">
                                <select
                                    className="w-full p-2 bg-gray-50 border rounded-lg text-sm font-bold outline-none focus:ring-2 focus:ring-primary cursor-pointer"
                                    value={selectedProjectId}
                                    onChange={(e) => setSelectedProjectId(e.target.value)}
                                >
                                    <option value="all">جميع المشاريع</option>
                                    {allProjects.map(p => (
                                        <option key={p.id} value={p.id}>{p.name}</option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                            <div className="p-3 bg-indigo-50 text-indigo-500 rounded-lg">
                                <span className="material-icons text-3xl">badge</span>
                            </div>
                            <div>
                                <h3 className="text-gray-500 text-sm font-medium">إجمالي الموظفين</h3>
                                <p className="text-2xl font-bold mt-1 text-gray-800">{metrics?.total_employees || 0}</p>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                            <div className="p-3 bg-green-50 text-green-500 rounded-lg">
                                <span className="material-icons text-3xl">check_circle</span>
                            </div>
                            <div>
                                <h3 className="text-gray-500 text-sm font-medium">الموظفين النشطين</h3>
                                <p className="text-2xl font-bold mt-1 text-gray-800">{metrics?.active_employees || 0}</p>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                            <div className="p-3 bg-blue-50 text-blue-500 rounded-lg">
                                <span className="material-icons text-3xl">how_to_reg</span>
                            </div>
                            <div>
                                <h3 className="text-gray-500 text-sm font-medium">حضور اليوم</h3>
                                <p className="text-2xl font-bold mt-1 text-gray-800">{metrics?.attendance_today_count || 0}</p>
                            </div>
                        </div>

                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center gap-4 hover:shadow-md transition-shadow">
                            <div className="p-3 bg-orange-50 text-orange-500 rounded-lg">
                                <span className="material-icons text-3xl">flight_takeoff</span>
                            </div>
                            <div>
                                <h3 className="text-gray-500 text-sm font-medium">في إجازة اليوم</h3>
                                <p className="text-2xl font-bold mt-1 text-gray-800">{metrics?.employees_on_leave_today || 0}</p>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'employees' && (
                <HREmployees user={user} />
            )}

            {activeTab === 'attendance' && (
                <HRAttendance user={user} />
            )}

            {activeTab === 'leave' && (
                <HRLeave user={user} />
            )}

            {activeTab === 'kpi' && (
                <HRKPIs user={user} />
            )}

            {activeTab === 'holidays' && (
                <HRHolidays user={user} />
            )}

            {activeTab === 'payroll' && (
                <div className="mt-8 bg-white border border-gray-100 shadow-sm rounded-xl p-8 text-center text-gray-400">
                    <span className="material-icons text-6xl opacity-20 mb-4 block">engineering</span>
                    <p className="font-bold text-lg mb-2">جاري العمل على استكمال الواجهات...</p>
                    <p className="text-sm">هذه الشاشة تحت التطوير وسيتم توفيرها قريباً.</p>
                </div>
            )}

        </div>
    );
};

export default HRDashboard;
