// ─────────────────────────────────────────────
//  Login Page
// ─────────────────────────────────────────────
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Heart, Mail, Lock, LogIn, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';

export default function Login() {
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);

  const { signIn, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await signIn(email, password);
      navigate('/dashboard', { replace: true });
    } catch { /* error in store */ }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex flex-col">
      {/* Top decoration */}
      <div className="flex-1 flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm"
        >
          {/* Logo */}
          <div className="text-center mb-8">
            <motion.div
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 2, repeat: Infinity }}
              className="inline-flex items-center justify-center w-20 h-20 bg-white/20 rounded-3xl mb-4 backdrop-blur-sm"
            >
              <Heart className="w-10 h-10 text-white fill-white" />
            </motion.div>
            <h1 className="text-4xl font-black text-white tracking-tight">VitalSync</h1>
            <p className="text-red-100 text-sm mt-1">Emergency Coordination Platform</p>
          </div>

          {/* Card */}
          <div className="bg-white rounded-3xl p-7 shadow-2xl">
            <h2 className="text-xl font-bold text-gray-900 mb-1">Welcome back</h2>
            <p className="text-gray-500 text-sm mb-6">Sign in to your account</p>

            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 mb-4 text-sm"
              >
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </motion.div>
            )}

            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="label">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="email" value={email} onChange={e => setEmail(e.target.value)}
                    className="input pl-10" placeholder="you@example.com" required
                  />
                </div>
              </div>

              <div>
                <label className="label">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type={showPass ? 'text' : 'password'} value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="input pl-10 pr-10" placeholder="••••••••" required
                  />
                  <button type="button" onClick={() => setShowPass(s => !s)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button type="submit" disabled={loading} className="btn-primary w-full">
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : (
                  <>
                    <LogIn className="w-4 h-4" />
                    Sign In
                  </>
                )}
              </button>
            </form>

            <div className="mt-5 text-center">
              <p className="text-sm text-gray-500">
                Don't have an account?{' '}
                <Link to="/register" className="text-brand-600 font-semibold">Register</Link>
              </p>
            </div>
          </div>

          <p className="text-center text-red-200 text-xs mt-6">
            🏥 Connecting people to emergency services
          </p>

          {/* Direct Visual Diagnostics to verify Vercel configuration */}
          <div className="mt-6 bg-white/10 backdrop-blur-md rounded-2xl p-4 border border-white/20 text-left text-[11px] text-white font-mono space-y-1 max-w-sm mx-auto shadow-lg">
            <p className="font-extrabold text-xs text-red-100 mb-1 flex items-center gap-1">🔧 Environment Diagnostics</p>
            <p>API Key Loaded: <span className="font-bold text-green-300">{String(import.meta.env.VITE_FIREBASE_API_KEY !== 'YOUR_API_KEY' && !!import.meta.env.VITE_FIREBASE_API_KEY)}</span></p>
            {import.meta.env.VITE_FIREBASE_API_KEY && import.meta.env.VITE_FIREBASE_API_KEY !== 'YOUR_API_KEY' ? (
              <>
                <p>Key Prefix: <span className="text-yellow-200 font-bold">{import.meta.env.VITE_FIREBASE_API_KEY.substring(0, 6)}</span></p>
                <p>Key Suffix: <span className="text-yellow-200 font-bold">{import.meta.env.VITE_FIREBASE_API_KEY.substring(import.meta.env.VITE_FIREBASE_API_KEY.length - 4)}</span></p>
                <p>Key Length: <span className="text-green-300 font-bold">{import.meta.env.VITE_FIREBASE_API_KEY.length} characters</span></p>
              </>
            ) : (
              <p className="text-red-300 font-bold">⚠️ Stuck on default 'YOUR_API_KEY' or empty!</p>
            )}
            <p>Project ID: <span className="text-yellow-200 font-bold">{import.meta.env.VITE_FIREBASE_PROJECT_ID || 'missing'}</span></p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
