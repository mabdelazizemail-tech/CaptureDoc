import React from 'react';

interface KPISliderProps {
  label: string;
  value: number;
  onChange: (value: number) => void;
  icon: string;
  colorClass: string;
}

const KPISlider: React.FC<KPISliderProps> = ({ label, value, onChange, icon, colorClass }) => {
  return (
    <div className="bg-gray-50/50 p-5 rounded-lg border border-gray-100 hover:border-gray-200 transition-colors">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className={`p-1.5 rounded bg-white shadow-sm ${colorClass}`}>
            <span className="material-icons text-lg block">{icon}</span>
          </div>
          <span className="font-bold text-gray-700">{label}</span>
        </div>
        <span className={`text-xl font-bold ${colorClass}`}>{value}</span>
      </div>
      <div className="relative h-8 flex items-center">
        <input
          type="range"
          min="1"
          max="10"
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-full z-10 relative"
          style={{ direction: 'ltr' }} 
        />
        {/* Visual tick marks */}
        <div className="absolute top-1/2 left-0 w-full flex justify-between px-1 pointer-events-none transform -translate-y-1/2">
           {[...Array(10)].map((_, i) => (
             <div key={i} className={`w-0.5 h-1.5 rounded-full ${i + 1 <= value ? 'bg-current opacity-50' : 'bg-gray-300'}`}></div>
           ))}
        </div>
      </div>
    </div>
  );
};

export default KPISlider;