"use client";

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

export default function Dashboard() {
    const [metrics, setMetrics] = useState<any>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function fetchMetrics() {
            const { data, error } = await supabase.rpc('get_dashboard_metrics');
            if (data) setMetrics(data);
            setLoading(false);
        }
        fetchMetrics();
    }, []);

    if (loading) return <div>Loading dashboard...</div>;

    return (
        <div>
            <h1 className="text-3xl font-bold mb-8">Dashboard</h1>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-medium">Total Employees</h3>
                    <p className="text-3xl font-bold mt-2">{metrics?.total_employees || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-medium">Active Employees</h3>
                    <p className="text-3xl font-bold mt-2 text-green-600">{metrics?.active_employees || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-medium">Attendance Today</h3>
                    <p className="text-3xl font-bold mt-2 text-blue-600">{metrics?.attendance_today_count || 0}</p>
                </div>

                <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-100">
                    <h3 className="text-gray-500 text-sm font-medium">On Leave Today</h3>
                    <p className="text-3xl font-bold mt-2 text-orange-600">{metrics?.employees_on_leave_today || 0}</p>
                </div>
            </div>
        </div>
    );
}
