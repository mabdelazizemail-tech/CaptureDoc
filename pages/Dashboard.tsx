import React, { useEffect, useState } from 'react';
import { getDeals, getTasks, Deal, Task } from '../services/crmService';

export default function Dashboard() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadDashboardData() {
      const [dealsData, tasksData] = await Promise.all([getDeals(), getTasks()]);
      setDeals(dealsData);
      setTasks(tasksData);
      setLoading(false);
    }
    loadDashboardData();
  }, []);

  // Calculations
  const pipelineValue = deals.reduce((acc, deal) => acc + Number(deal.value || 0), 0);
  
  // Deals won this month
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const dealsWonThisMonth = deals.filter(d => {
    if (d.stage !== 'Won') return false;
    const dDate = new Date(d.created_at || new Date());
    return dDate.getMonth() === currentMonth && dDate.getFullYear() === currentYear;
  }).length;

  // Tasks Due Today (or overdue and pending)
  const today = new Date().toISOString().split('T')[0];
  const pendingTasks = tasks.filter(t => t.status === 'Pending');
  const tasksDueToday = pendingTasks.filter(t => {
    if (!t.due_date) return false;
    return t.due_date.startsWith(today);
  }).length;

  if (loading) return <div className="p-8 text-gray-500">Loading dashboard...</div>;

  return (
    <div className="space-y-6">
      {/* KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Total Pipeline Value</p>
          <h3 className="text-3xl font-semibold text-gray-900 mt-2">
            ${pipelineValue.toLocaleString()}
          </h3>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Deals Won This Month</p>
          <h3 className="text-3xl font-semibold text-gray-900 mt-2">{dealsWonThisMonth}</h3>
        </div>
        <div className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm">
          <p className="text-sm font-medium text-gray-500">Tasks Due Today</p>
          <h3 className="text-3xl font-semibold text-gray-900 mt-2">{tasksDueToday}</h3>
        </div>
      </div>

      {/* Today's Tasks */}
      <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
        <div className="px-6 py-5 border-b border-gray-200">
          <h3 className="text-base font-medium text-gray-900">Pending Tasks</h3>
        </div>
        <ul className="divide-y divide-gray-100">
          {pendingTasks.length === 0 ? (
             <li className="px-6 py-4 text-sm text-gray-500">No pending tasks!</li>
          ) : (
            pendingTasks.slice(0, 5).map((task) => (
              <li key={task.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mr-3"></div>
                  <span className="text-sm text-gray-700">{task.title}</span>
                </div>
                <span className="text-xs text-gray-500">
                  {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No date'}
                </span>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}
