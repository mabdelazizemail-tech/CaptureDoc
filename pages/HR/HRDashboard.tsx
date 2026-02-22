import React, { useState, useEffect } from 'react';
import { User } from '../../services/types';
import { supabase } from '../../services/supabaseClient';
import HREmployees from './HREmployees';

interface HRDashboardProps {
    user: User;
}

const HRDashboard: React.FC<HRDashboardProps> = ({ user }) => {
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);
    const [activeTab, setActiveTab] = useState('overview');

    // We reuse the RPC view created earlier since it was securely pushed to Supabase
    useEffect(() => {
        async function fetchMetrics() {
            const { data, error } = await supabase.rpc('get_dashboard_metrics');
            if (data) setMetrics(data);
            setLoading(false);
        }
        fetchMetrics();
    }, []);

    if (loading) return <div className="p-8 text-center text-gray-500">جاري التحميل...</div>;

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
                    الإجازات
                </button>
                <button
                    onClick={() => setActiveTab('payroll')}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-bold transition-all text-sm whitespace-nowrap ${activeTab === 'payroll' ? 'bg-primary text-white shadow-md' : 'text-gray-500 hover:bg-gray-50'}`}
                >
                    <span className="material-icons text-[18px]">payments</span>
                    نظام الرواتب
                </button>
            </div>

            {activeTab === 'overview' && (
                <div className="space-y-6 animate-fade-in-up">
                    {/* Alert Banner directly integrating into existing UI look */}
                    <div className="bg-blue-50 border border-blue-200 text-blue-800 px-4 py-3 rounded-lg flex items-start gap-3 shadow-sm">
                        <span className="material-icons mt-0.5 text-blue-500">info</span>
                        <div>
                            <p className="font-bold">مرحباً بك في نظام الموارد البشرية</p>
                            <p className="text-sm opacity-90">هذه الوحدة تعمل كجزء متكامل مع نظام Capture Flow الأساسي باستخدام نفس قاعدة البيانات.</p>
                        </div>
                    </div>

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
                <HREmployees />
            )}

            {(activeTab === 'attendance' || activeTab === 'leave' || activeTab === 'payroll') && (
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
