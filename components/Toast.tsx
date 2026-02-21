import React, { useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'success' | 'error' | 'info';
  onClose: () => void;
}

const Toast: React.FC<ToastProps> = ({ message, type, onClose }) => {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000); // Auto close after 3 seconds
    return () => clearTimeout(timer);
  }, [onClose]);

  const styles = {
    success: { bg: 'bg-green-600', icon: 'check_circle' },
    error: { bg: 'bg-red-600', icon: 'error' },
    info: { bg: 'bg-blue-600', icon: 'info' }
  };

  const style = styles[type] || styles.info;

  return (
    <div className={`fixed top-6 left-1/2 transform -translate-x-1/2 z-[70] flex items-center gap-3 px-6 py-3 rounded-lg shadow-xl text-white font-bold animate-bounce-in ${style.bg}`}>
      <span className="material-icons text-xl">{style.icon}</span>
      <span>{message}</span>
      <button onClick={onClose} className="ml-4 text-white/80 hover:text-white">
        <span className="material-icons text-sm">close</span>
      </button>
    </div>
  );
};

export default Toast;