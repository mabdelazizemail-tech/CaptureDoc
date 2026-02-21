import React from 'react';

interface ConfirmationModalProps {
  isOpen: boolean;
  title?: string;
  message: string;
  onConfirm: () => void;
  onCancel: () => void;
  confirmText?: string;
  cancelText?: string;
  isDangerous?: boolean;
}

const ConfirmationModal: React.FC<ConfirmationModalProps> = ({ 
  isOpen, title = 'تأكيد الإجراء', message, onConfirm, onCancel, 
  confirmText = 'نعم، متابعة', cancelText = 'إلغاء', isDangerous = false 
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 animate-fade-in">
      <div className="bg-white rounded-xl shadow-2xl max-w-sm w-full p-6 transform scale-100 transition-transform">
        <div className="flex items-center gap-3 mb-3">
            <div className={`p-2 rounded-full ${isDangerous ? 'bg-red-100 text-red-600' : 'bg-blue-100 text-blue-600'}`}>
                <span className="material-icons text-2xl">{isDangerous ? 'warning' : 'help'}</span>
            </div>
            <h3 className="text-lg font-bold text-gray-800">{title}</h3>
        </div>
        
        <p className="text-gray-600 mb-6 text-sm leading-relaxed">{message}</p>
        
        <div className="flex gap-3">
          <button 
            onClick={onCancel}
            className="flex-1 py-2.5 rounded-lg font-bold bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          >
            {cancelText}
          </button>
          <button 
            onClick={onConfirm}
            className={`flex-1 py-2.5 rounded-lg font-bold text-white transition-colors shadow-md ${isDangerous ? 'bg-red-600 hover:bg-red-700' : 'bg-primary hover:bg-primary-dark'}`}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmationModal;