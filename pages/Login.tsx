import React, { useState } from 'react';
import { supabase } from '../services/supabaseClient';
import { StorageService } from '../services/storage';
import { User } from '../types';

interface LoginProps {
  onLogin: (user: User) => void;
}

const Login: React.FC<LoginProps> = ({ onLogin }) => {
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setLoading(true);

    try {
        // 1. Try Local Login (Master Admin Backdoor)
        // This allows logging in as 'admin' / 'admin' without Supabase
        const localUser = await StorageService.login(email, password);
        if (localUser) {
            onLogin(localUser);
            setLoading(false);
            return;
        }

        // 2. Try Supabase Auth
        if (isSignUp) {
            const fullName = email.split('@')[0];
            const { error: signUpError } = await supabase.auth.signUp({
                email,
                password,
                options: {
                    data: {
                        full_name: fullName,
                        role: 'supervisor' // Default role
                    }
                }
            });
            if (signUpError) throw signUpError;
            
            // Trigger New User Notification to Admin
            // We ignore errors here so it doesn't block the user flow
            try {
                await supabase.functions.invoke('new-user-notification', {
                    body: { email, name: fullName }
                });
            } catch (notifyErr) {
                console.error("Failed to send admin notification:", notifyErr);
            }

            setMessage('تم إنشاء الحساب بنجاح! يرجى التحقق من بريدك الإلكتروني لتأكيد الحساب.');
            setIsSignUp(false);
        } else {
            const { data, error: signInError } = await supabase.auth.signInWithPassword({
                email,
                password,
            });
            if (signInError) throw signInError;
            
            // Fetch the full profile from the database
            if (data.user) {
                const profile = await StorageService.getUserProfile(data.user.id);
                if (profile) {
                    onLogin(profile);
                } else {
                    // Profile might be missing if trigger failed or not setup
                    setError('تم تسجيل الدخول ولكن لم يتم العثور على ملف المستخدم. يرجى الاتصال بالدعم.');
                }
            }
        }
    } catch (err: any) {
        console.error(err);
        const errMsg = err.message || '';
        
        if (errMsg.includes('Invalid login credentials')) {
            if (email.toLowerCase() === 'admin') {
               setError('كلمة المرور للمدير (admin) غير صحيحة.');
            } else {
               setError('البريد الإلكتروني أو كلمة المرور غير صحيحة. هل قمت بتأكيد حسابك؟');
            }
        } else if (errMsg.includes('Email not confirmed')) {
            setError('يرجى تأكيد البريد الإلكتروني أولاً عن طريق الرابط المرسل إليك.');
        } else if (errMsg.includes('Database error saving new user')) {
            setError('خطأ في إعدادات قاعدة البيانات. يرجى التأكد من تشغيل ملف الإعداد (supabase_setup.sql).');
        } else {
            setError('حدث خطأ: ' + errMsg);
        }
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#f0f3f6] p-4 font-sans" dir="rtl">
      <div className="bg-white p-8 md:p-12 rounded-2xl shadow-xl w-full max-w-md border border-gray-100">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary/10 rounded-2xl text-primary mb-4 shadow-sm">
             <span className="material-icons text-4xl">bar_chart</span>
          </div>
          <h2 className="text-3xl font-bold text-gray-800 tracking-tight">Capture Flow</h2>
          <p className="text-xs font-bold text-blue-600 mt-1 tracking-wide">(Powered by Capture Doc)</p>
          <p className="text-gray-400 text-sm mt-6 font-medium">
            {isSignUp ? 'إنشاء حساب جديد' : 'تسجيل الدخول للمتابعة'}
          </p>
        </div>

        {error && (
          <div className="bg-red-50 text-red-600 p-4 rounded-xl mb-6 text-sm flex items-start gap-3 border border-red-100 animate-pulse">
            <span className="material-icons text-lg mt-0.5">error_outline</span>
            <span className="font-bold">{error}</span>
          </div>
        )}

        {message && (
          <div className="bg-green-50 text-green-600 p-4 rounded-xl mb-6 text-sm flex items-start gap-3 border border-green-100">
            <span className="material-icons text-lg mt-0.5">check_circle</span>
            <span className="font-bold">{message}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">اسم المستخدم / البريد الإلكتروني</label>
            <div className="relative">
                <span className="material-icons absolute top-3 right-3 text-gray-400">person</span>
                <input
                type="text"
                required
                className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:bg-white outline-none transition-all text-left"
                dir="ltr"
                placeholder="admin"
                value={email}
                onChange={e => setEmail(e.target.value)}
                />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">كلمة المرور</label>
            <div className="relative">
                <span className="material-icons absolute top-3 right-3 text-gray-400">lock</span>
                <input
                type="password"
                required
                className="w-full pl-4 pr-10 py-3 bg-gray-50 border border-gray-200 rounded-xl focus:ring-2 focus:ring-primary focus:bg-white outline-none transition-all text-left"
                dir="ltr"
                placeholder="••••••••"
                value={password}
                onChange={e => setPassword(e.target.value)}
                />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-primary text-white py-3.5 rounded-xl font-bold hover:bg-primary-dark active:scale-[0.98] transition-all shadow-lg shadow-blue-500/30 flex justify-center items-center mt-8 text-lg"
          >
            {loading ? (
                <div className="flex items-center gap-2">
                    <span className="material-icons animate-spin text-xl">donut_large</span>
                    <span>جاري التنفيذ...</span>
                </div>
            ) : (isSignUp ? 'إنشاء حساب' : 'تسجيل الدخول')}
          </button>
        </form>
        
        <div className="mt-8 text-center pt-6 border-t border-gray-100">
            <button 
              onClick={() => { setIsSignUp(!isSignUp); setError(''); setMessage(''); }}
              className="text-sm text-primary font-bold hover:text-primary-dark transition-colors flex items-center justify-center gap-1 mx-auto"
            >
              {isSignUp ? 'لديك حساب بالفعل؟ تسجيل الدخول' : 'ليس لديك حساب؟ إنشاء حساب جديد'}
            </button>
        </div>
      </div>
    </div>
  );
};

export default Login;