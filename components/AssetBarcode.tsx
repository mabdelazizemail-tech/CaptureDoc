
import React, { useState } from 'react';
import Barcode from 'react-barcode';

interface AssetBarcodeProps {
  value: string;
  className?: string;
  onCopy?: () => void;
}

const AssetBarcode: React.FC<AssetBarcodeProps> = ({ value, className = '', onCopy }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent triggering row click events
    
    if (value) {
      navigator.clipboard.writeText(value);
      setCopied(true);
      if (onCopy) onCopy();
      
      // Reset copied state after 2 seconds
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (!value) return null;

  return (
    <div 
      onClick={handleCopy}
      className={`relative group cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 bg-white rounded p-1 border border-transparent hover:border-blue-100 hover:shadow-sm ${className}`}
      title="Click to copy Asset Tag"
    >
      <div className={`transition-opacity duration-200 ${copied ? 'opacity-30 blur-[1px]' : 'opacity-100'}`}>
        <Barcode 
            value={value} 
            format="CODE128"
            width={1}
            height={30}
            displayValue={true}
            font="monospace"
            textAlign="center"
            textPosition="bottom"
            fontSize={10}
            background="transparent"
            margin={0}
        />
      </div>
      
      {/* Copied Overlay Animation */}
      <div className={`absolute inset-0 flex items-center justify-center transition-all duration-200 ${copied ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'}`}>
        <div className="bg-green-500 text-white text-[10px] font-bold px-2 py-1 rounded-full shadow-md flex items-center gap-1">
            <span className="material-icons text-[12px]">check</span> Copied
        </div>
      </div>
      
      {/* Hover Hint */}
      <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
          <div className="bg-gray-800 text-white text-[10px] px-2 py-1 rounded shadow-lg whitespace-nowrap">
              Copy Tag
          </div>
      </div>
    </div>
  );
};

export default AssetBarcode;
