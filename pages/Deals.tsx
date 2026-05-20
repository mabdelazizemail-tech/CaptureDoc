import React, { useEffect, useState } from 'react';
import { getDeals, updateDealStage, Deal } from '../services/crmService';

const STAGES: Deal['stage'][] = ['Lead', 'Qualified', 'Proposal', 'Won', 'Lost'];

export default function Deals() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [loading, setLoading] = useState(true);
  const [draggedDealId, setDraggedDealId] = useState<string | null>(null);

  useEffect(() => {
    fetchDeals();
  }, []);

  async function fetchDeals() {
    const data = await getDeals();
    setDeals(data);
    setLoading(false);
  }

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedDealId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault(); // necessary to allow dropping
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = async (e: React.DragEvent, newStage: Deal['stage']) => {
    e.preventDefault();
    if (!draggedDealId) return;

    // Optimistic UI Update
    setDeals(deals.map(d => d.id === draggedDealId ? { ...d, stage: newStage } : d));
    
    // Background DB Update
    const success = await updateDealStage(draggedDealId, newStage);
    if (!success) {
      // Revert if failed (in a real app, you'd want to store previous state)
      fetchDeals(); 
    }
    setDraggedDealId(null);
  };

  if (loading) {
    return <div className="p-8 text-gray-500">Loading pipeline...</div>;
  }

  return (
    <div className="flex space-x-4 h-full overflow-x-auto pb-4">
      {STAGES.map((stage) => (
        <div 
          key={stage} 
          className="min-w-[280px] w-72 flex-shrink-0 bg-gray-100/80 rounded-xl p-3 flex flex-col"
          onDragOver={handleDragOver}
          onDrop={(e) => handleDrop(e, stage)}
        >
          <div className="flex justify-between items-center mb-3 px-1">
            <h3 className="font-medium text-sm text-gray-700 uppercase tracking-wide">{stage}</h3>
            <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded-full font-medium">
              {deals.filter(d => d.stage === stage).length}
            </span>
          </div>
          <div className="flex-1 space-y-3 kanban-col">
            {deals.filter(d => d.stage === stage).map(deal => (
              <div 
                key={deal.id} 
                draggable
                onDragStart={(e) => handleDragStart(e, deal.id)}
                className="bg-white p-4 rounded-lg border border-gray-200 shadow-sm cursor-grab active:cursor-grabbing hover:border-blue-300 transition-colors"
              >
                <h4 className="text-sm font-medium text-gray-900">{deal.name}</h4>
                <p className="text-xs text-gray-500 mt-1">{deal.company?.name || 'No Company'}</p>
                <div className="mt-3 font-semibold text-gray-900 text-sm">
                  {deal.currency === 'USD' ? '$' : 'EGP '}{Number(deal.value).toLocaleString()}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
