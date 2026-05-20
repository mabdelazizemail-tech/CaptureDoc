import React, { useEffect, useState } from 'react';
import { getTasks, updateTaskStatus, Task } from '../services/crmService';

export default function Tasks() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasks();
  }, []);

  async function fetchTasks() {
    const data = await getTasks();
    setTasks(data);
    setLoading(false);
  }

  const toggleStatus = async (task: Task) => {
    const newStatus = task.status === 'Completed' ? 'Pending' : 'Completed';
    // Optimistic UI update
    setTasks(tasks.map(t => t.id === task.id ? { ...t, status: newStatus } : t));
    
    // Background DB update
    const success = await updateTaskStatus(task.id, newStatus);
    if (!success) {
      // Revert if failed
      setTasks(tasks);
    }
  };

  return (
    <div className="bg-white border border-gray-200 rounded-xl shadow-sm overflow-hidden max-w-4xl">
      <div className="px-6 py-4 border-b border-gray-200 flex justify-between items-center bg-gray-50/50">
        <h3 className="text-base font-medium text-gray-900">Task List</h3>
        <button className="text-sm font-medium text-blue-600 hover:text-blue-700">Filter</button>
      </div>
      <ul className="divide-y divide-gray-100">
        {loading ? (
           <li className="px-6 py-8 text-center text-gray-500">Loading tasks...</li>
        ) : tasks.length === 0 ? (
           <li className="px-6 py-8 text-center text-gray-500">No tasks pending. You're all caught up!</li>
        ) : (
          tasks.map((task) => (
            <li key={task.id} className={`px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors cursor-pointer ${task.status === 'Completed' ? 'opacity-60' : ''}`}>
              <div className="flex items-center" onClick={() => toggleStatus(task)}>
                <label className="flex items-center cursor-pointer">
                  <input 
                    type="checkbox" 
                    checked={task.status === 'Completed'}
                    readOnly
                    aria-label={task.title}
                    className="w-4 h-4 text-blue-600 rounded border-gray-300 focus:ring-blue-500 cursor-pointer" 
                  />
                  <span className={`ml-4 text-sm ${task.status === 'Completed' ? 'text-gray-500 line-through' : 'text-gray-700 font-medium'}`}>
                    {task.title}
                  </span>
                </label>
              </div>
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2.5 py-1 rounded-md">
                {task.due_date ? new Date(task.due_date).toLocaleDateString() : 'No Due Date'}
              </span>
            </li>
          ))
        )}
      </ul>
    </div>
  );
}
