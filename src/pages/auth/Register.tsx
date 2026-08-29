// ─────────────────────────────────────────────
//  Register Page — Role-based signup
// ─────────────────────────────────────────────
import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Heart, User, Ambulance, Building2, ChevronRight, ChevronLeft, AlertCircle } from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import type { UserRole } from '../../types';

// ── Step 1: Role Selector ─────────────────────
function RoleCard({
  icon: Icon, title, desc, selected, onClick
}: {
  icon: React.ElementType; title: string; desc: string; selected: boolean; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-center gap-4 p-4 rounded-2xl border-2 transition-all ${
        selected
          ? 'border-brand-600 bg-brand-50 shadow-brand'
          : 'border-gray-100 bg-white hover:border-brand-200'
      }`}
    >
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${selected ? 'bg-brand-600' : 'bg-gray-100'}`}>
        <Icon className={`w-5 h-5 ${selected ? 'text-white' : 'text-gray-500'}`} />
      </div>
      <div className="text-left">
        <p className={`font-semibold text-sm ${selected ? 'text-brand-700' : 'text-gray-700'}`}>{title}</p>
        <p className="text-xs text-gray-400">{desc}</p>
      </div>
      {selected && <div className="ml-auto w-5 h-5 rounded-full bg-brand-600 flex items-center justify-center">
        <div className="w-2 h-2 bg-white rounded-full" />
      </div>}
    </button>
  );
}

export default function Register() {
  const [step,     setStep]     = useState(1);
  const [role,     setRole]     = useState<UserRole | null>(null);
  const [email,    setEmail]    = useState('');
  const [password, setPassword] = useState('');

  // User-specific fields
  const [name,        setName]        = useState('');
  const [age,         setAge]         = useState('');
  const [blood,       setBlood]       = useState('');
  const [phone,       setPhone]       = useState('');
  const [conditions,  setConditions]  = useState('');

  // Ambulance-specific fields
  const [driverName,  setDriverName]  = useState('');
  const [vehicleNo,   setVehicleNo]   = useState('');
  const [vehicleType, setVehicleType] = useState('BLS');
  const [ambPhone,    setAmbPhone]    = useState('');

  // Hospital-specific fields
  const [hospName,    setHospName]    = useState('');
  const [hospAddress, setHospAddress] = useState('');
  const [hospPhone,   setHospPhone]   = useState('');
  const [specialties, setSpecialties] = useState('');

  const { signUp, loading, error, clearError } = useAuthStore();
  const navigate = useNavigate();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!role) return;
    clearError();

    let profileData = {};
    if (role === 'user') {
      profileData = {
        name, age: parseInt(age), bloodGroup: blood, phone,
        conditions: conditions.split(',').map(s => s.trim()).filter(Boolean),
        allergies: [], medications: [], emergencyContacts: [],
      };
    } else if (role === 'ambulance') {
      profileData = {
        driverName, vehicleNo, vehicleType, phone: ambPhone,
        status: 'available', location: { lat: 0, lng: 0 },
      };
    } else {
      profileData = {
        name: hospName, address: hospAddress, phone: hospPhone,
        specialties: specialties.split(',').map(s => s.trim()).filter(Boolean),
        location: { lat: 0, lng: 0 },
        beds: { general: { total: 50, available: 30 }, icu: { total: 10, available: 5 }, emergency: { total: 10, available: 8 } },
        blood: { Apos: 10, Aneg: 5, Bpos: 10, Bneg: 5, Opos: 15, Oneg: 5, ABpos: 5, ABneg: 3 },
        oxygen: { cylinders: 20, piped: true },
        ventilators: 5, doctorsOnDuty: [],
      };
    }

    try {
      await signUp(email, password, role, profileData as never);
      navigate('/dashboard', { replace: true });
    } catch { /* error in store */ }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-600 via-brand-700 to-brand-900 flex flex-col p-6">
      <div className="max-w-sm mx-auto w-full flex-1 flex flex-col justify-center">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-white/20 rounded-2xl mb-3 backdrop-blur-sm">
            <Heart className="w-7 h-7 text-white fill-white" />
          </div>
          <h1 className="text-3xl font-black text-white">VitalSync</h1>
        </div>

        {/* Step indicator */}
        <div className="flex items-center justify-center gap-2 mb-5">
          {[1, 2].map(s => (
            <div key={s} className={`h-1.5 rounded-full transition-all duration-300 ${s === step ? 'w-8 bg-white' : 'w-4 bg-white/30'}`} />
          ))}
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {error && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
              className="flex items-start gap-2 bg-red-50 text-red-700 rounded-xl p-3 mb-4 text-sm">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}

          <AnimatePresence mode="wait">
            {step === 1 && (
              <motion.div key="step1"
                initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }}>
                <h2 className="text-lg font-bold text-gray-900 mb-1">Create account</h2>
                <p className="text-gray-500 text-sm mb-5">Choose your role in VitalSync</p>
                <div className="space-y-3 mb-5">
                  <RoleCard icon={User} title="Individual User" desc="Personal emergency detection" selected={role === 'user'} onClick={() => setRole('user')} />
                  <RoleCard icon={Ambulance} title="Ambulance Team" desc="Respond to emergencies" selected={role === 'ambulance'} onClick={() => setRole('ambulance')} />
                  <RoleCard icon={Building2} title="Hospital" desc="Receive patient alerts" selected={role === 'hospital'} onClick={() => setRole('hospital')} />
                </div>
                <button onClick={() => setStep(2)} disabled={!role} className="btn-primary w-full">
                  Continue <ChevronRight className="w-4 h-4" />
                </button>
              </motion.div>
            )}

            {step === 2 && (
              <motion.div key="step2"
                initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: 20 }}>
                <button onClick={() => setStep(1)} className="flex items-center gap-1 text-sm text-gray-500 mb-4 -ml-1">
                  <ChevronLeft className="w-4 h-4" /> Back
                </button>
                <h2 className="text-lg font-bold text-gray-900 mb-4">
                  {role === 'user' ? '👤 Your Details' : role === 'ambulance' ? '🚑 Vehicle Details' : '🏥 Hospital Details'}
                </h2>

                <form onSubmit={handleSubmit} className="space-y-3">
                  {/* Common fields */}
                  <div>
                    <label className="label">Email</label>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                      className="input" placeholder="you@example.com" required />
                  </div>
                  <div>
                    <label className="label">Password</label>
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                      className="input" placeholder="Min. 6 characters" minLength={6} required />
                  </div>

                  {/* User fields */}
                  {role === 'user' && (<>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Full Name</label>
                        <input value={name} onChange={e => setName(e.target.value)}
                          className="input" placeholder="Ravi Kumar" required />
                      </div>
                      <div>
                        <label className="label">Age</label>
                        <input type="number" value={age} onChange={e => setAge(e.target.value)}
                          className="input" placeholder="25" required />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Blood Group</label>
                        <select value={blood} onChange={e => setBlood(e.target.value)} className="input" required>
                          <option value="">Select</option>
                          {['A+','A-','B+','B-','O+','O-','AB+','AB-'].map(g => <option key={g}>{g}</option>)}
                        </select>
                      </div>
                      <div>
                        <label className="label">Phone</label>
                        <input value={phone} onChange={e => setPhone(e.target.value)}
                          className="input" placeholder="+91 9876543210" required />
                      </div>
                    </div>
                    <div>
                      <label className="label">Medical Conditions (comma separated)</label>
                      <input value={conditions} onChange={e => setConditions(e.target.value)}
                        className="input" placeholder="Diabetes, Hypertension" />
                    </div>
                  </>)}

                  {/* Ambulance fields */}
                  {role === 'ambulance' && (<>
                    <div>
                      <label className="label">Driver Name</label>
                      <input value={driverName} onChange={e => setDriverName(e.target.value)}
                        className="input" placeholder="Rajesh Singh" required />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="label">Vehicle Number</label>
                        <input value={vehicleNo} onChange={e => setVehicleNo(e.target.value)}
                          className="input" placeholder="TN01AB1234" required />
                      </div>
                      <div>
                        <label className="label">Type</label>
                        <select value={vehicleType} onChange={e => setVehicleType(e.target.value)} className="input">
                          <option>BLS</option>
                          <option>ALS</option>
                          <option value="Mobile ICU">Mobile ICU</option>
                        </select>
                      </div>
                    </div>
                    <div>
                      <label className="label">Phone</label>
                      <input value={ambPhone} onChange={e => setAmbPhone(e.target.value)}
                        className="input" placeholder="+91 9876543210" required />
                    </div>
                  </>)}

                  {/* Hospital fields */}
                  {role === 'hospital' && (<>
                    <div>
                      <label className="label">Hospital Name</label>
                      <input value={hospName} onChange={e => setHospName(e.target.value)}
                        className="input" placeholder="Apollo Hospital" required />
                    </div>
                    <div>
                      <label className="label">Address</label>
                      <input value={hospAddress} onChange={e => setHospAddress(e.target.value)}
                        className="input" placeholder="123 Main Street, Chennai" required />
                    </div>
                    <div>
                      <label className="label">Phone</label>
                      <input value={hospPhone} onChange={e => setHospPhone(e.target.value)}
                        className="input" placeholder="+91 044-12345678" required />
                    </div>
                    <div>
                      <label className="label">Specialties (comma separated)</label>
                      <input value={specialties} onChange={e => setSpecialties(e.target.value)}
                        className="input" placeholder="Cardiology, Neurology, Trauma" />
                    </div>
                  </>)}

                  <button type="submit" disabled={loading} className="btn-primary w-full mt-2">
                    {loading ? (
                      <span className="flex items-center gap-2">
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                        Creating account…
                      </span>
                    ) : 'Create Account'}
                  </button>
                </form>

                <p className="text-center text-xs text-gray-400 mt-4">
                  Already have an account?{' '}
                  <Link to="/login" className="text-brand-600 font-semibold">Sign in</Link>
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}
