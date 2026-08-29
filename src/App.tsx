// ─────────────────────────────────────────────
//  App.tsx — Router + Auth Guard
// ─────────────────────────────────────────────
import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { useAuthStore } from './store/useAuthStore';
import Login    from './pages/auth/Login';
import Register from './pages/auth/Register';
import UserDashboard      from './pages/user/UserDashboard';
import AmbulanceDashboard from './pages/ambulance/AmbulanceDashboard';
import HospitalDashboard  from './pages/hospital/HospitalDashboard';
import SeedPage           from './pages/SeedPage';

// ── Auth-aware dashboard redirector ──────────
function DashboardRouter() {
  const { role, firebaseUser, initialized } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!initialized) return;
    if (!firebaseUser) { navigate('/login', { replace: true }); return; }
    if (role === 'user')      navigate('/dashboard/user',      { replace: true });
    if (role === 'ambulance') navigate('/dashboard/ambulance', { replace: true });
    if (role === 'hospital')  navigate('/dashboard/hospital',  { replace: true });
  }, [role, firebaseUser, initialized, navigate]);

  if (!initialized) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-brand-600 to-brand-800 flex items-center justify-center">
        <div className="text-center text-white">
          <div className="w-16 h-16 border-4 border-white/30 border-t-white rounded-full animate-spin mx-auto mb-4" />
          <p className="font-semibold">VitalSync</p>
          <p className="text-red-200 text-sm">Loading…</p>
        </div>
      </div>
    );
  }

  return null;
}

// ── Protected route ───────────────────────────
function Protected({ children, requiredRole }: { children: React.ReactNode; requiredRole: string }) {
  const { role, firebaseUser, initialized } = useAuthStore();

  if (!initialized) return null;
  if (!firebaseUser) return <Navigate to="/login" replace />;
  if (role !== requiredRole) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

// ── Auth initializer component ────────────────
function AuthInitializer() {
  const initialize = useAuthStore(s => s.initialize);
  useEffect(() => { initialize(); }, [initialize]);
  return null;
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthInitializer />
      <Routes>
        {/* Auth */}
        <Route path="/login"    element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Dashboard auto-redirect */}
        <Route path="/dashboard" element={<DashboardRouter />} />

        {/* Role-protected dashboards */}
        <Route path="/dashboard/user" element={
          <Protected requiredRole="user"><UserDashboard /></Protected>
        } />
        <Route path="/dashboard/ambulance" element={
          <Protected requiredRole="ambulance"><AmbulanceDashboard /></Protected>
        } />
        <Route path="/dashboard/hospital" element={
          <Protected requiredRole="hospital"><HospitalDashboard /></Protected>
        } />

        {/* Mock data seeder (dev only) */}
        <Route path="/seed" element={<SeedPage />} />

        {/* Default */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
