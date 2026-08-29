// ─────────────────────────────────────────────
//  User Dashboard
//  • Profile card + medical info
//  • Shake detector + GPS
//  • Emergency dialog trigger
//  • Emergency history
// ─────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Activity, MapPin, Phone, AlertTriangle,
  Shield, Zap, LogOut, User, Clock, CheckCircle2,
  Droplets, Pill, Contact, Siren,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useShakeDetector } from '../../hooks/useShakeDetector';
import { useGPS } from '../../hooks/useGPS';
import EmergencyDialog from '../../components/EmergencyDialog';
import MapView from '../../components/MapView';
import { createEmergency, updateEmergency } from '../../services/emergencyService';
import type { UserProfile, AIAnalysisResult, SensorData, Emergency } from '../../types';
import { collection, onSnapshot, query, where, orderBy, limit } from 'firebase/firestore';
import { db } from '../../firebase/config';

const BLOOD_COLORS: Record<string, string> = {
  'A+':'bg-red-100 text-red-700','A-':'bg-red-200 text-red-800',
  'B+':'bg-orange-100 text-orange-700','B-':'bg-orange-200 text-orange-800',
  'O+':'bg-brand-100 text-brand-700','O-':'bg-brand-200 text-brand-800',
  'AB+':'bg-purple-100 text-purple-700','AB-':'bg-purple-200 text-purple-800',
};

export default function UserDashboard() {
  const { profile, signOut, firebaseUser } = useAuthStore();
  const user = profile as UserProfile;

  const [dialogOpen,      setDialogOpen]      = useState(false);
  const [shakeMag,        setShakeMag]        = useState(0);
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null);
  const [history,         setHistory]         = useState<Emergency[]>([]);
  const [motionEnabled,   setMotionEnabled]   = useState(false);
  const [tab,             setTab]             = useState<'home' | 'profile' | 'history'>('home');

  const gps = useGPS(true);

  // Shake handlers
  const handleShake = useCallback((mag: number) => {
    if (!dialogOpen) {
      setShakeMag(mag);
      setDialogOpen(true);
    }
  }, [dialogOpen]);

  const handleStillness = useCallback((_dur: number) => {
    // stillness signal noted — handled in dialog
  }, []);

  const shake = useShakeDetector(handleShake, handleStillness, motionEnabled);

  // Request motion permission on mount
  useEffect(() => {
    shake.requestPermission().then(granted => setMotionEnabled(granted));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Listen to emergency history
  useEffect(() => {
    if (!firebaseUser?.uid) return;
    const q = query(
      collection(db, 'emergencies'),
      where('userId', '==', firebaseUser.uid),
      orderBy('timestamp', 'desc'),
      limit(10),
    );
    return onSnapshot(q, snap => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() } as Emergency));
      setHistory(all);
      const active = all.find(e => ['triggered','confirmed','dispatched'].includes(e.status));
      setActiveEmergency(active || null);
    });
  }, [firebaseUser?.uid]);

  const handleAbort = () => setDialogOpen(false);

  const handleConfirmed = useCallback(async (result: AIAnalysisResult, sensor: SensorData) => {
    setDialogOpen(false);
    if (!firebaseUser || !gps.location) return;

    const emergencyId = await createEmergency({
      userId:       firebaseUser.uid,
      userName:     user?.name || 'Unknown',
      userPhone:    user?.phone || '',
      userBloodGroup: user?.bloodGroup || 'Unknown',
      location:     gps.location,
      status:       'confirmed',
      classification: result.classification,
      confidenceScore: result.confidenceScore,
      sensorData:   sensor,
      timestamp:    Date.now(),
    });

    setActiveEmergency({
      id: emergencyId,
      userId: firebaseUser.uid,
      userName: user?.name || '',
      userPhone: user?.phone || '',
      userBloodGroup: user?.bloodGroup || '',
      location: gps.location,
      status: 'confirmed',
      classification: result.classification,
      confidenceScore: result.confidenceScore,
      sensorData: sensor,
      timestamp: Date.now(),
    });
  }, [firebaseUser, gps.location, user]);

  const cancelEmergency = async () => {
    if (activeEmergency) {
      await updateEmergency(activeEmergency.id, { status: 'aborted' });
      setActiveEmergency(null);
    }
  };

  const statusBadge = (status: string) => {
    const map: Record<string, string> = {
      confirmed: 'badge-red', dispatched: 'badge-yellow',
      arrived: 'badge-blue', resolved: 'badge-green', aborted: 'badge-gray',
    };
    return map[status] || 'badge-gray';
  };

  return (
    <div className="page">
      {/* Emergency Dialog */}
      <EmergencyDialog
        isOpen={dialogOpen}
        shakeMagnitude={shakeMag}
        onAbort={handleAbort}
        onConfirmed={handleConfirmed}
      />

      {/* Top Bar */}
      <div className="top-bar">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-full flex items-center justify-center">
            <Heart className="w-4 h-4 text-white fill-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-tight">VitalSync</h1>
            <p className="text-xs text-gray-400">User Dashboard</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {motionEnabled ? (
            <span className="badge-green text-xs">
              <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" /> Monitoring
            </span>
          ) : (
            <span className="badge-gray text-xs">Sensor off</span>
          )}
          <button onClick={signOut} className="btn-ghost p-2">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Active Emergency Banner */}
      <AnimatePresence>
        {activeEmergency && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="bg-brand-600 text-white"
          >
            <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                <Siren className="w-5 h-5" />
              </motion.div>
              <div className="flex-1">
                <p className="font-semibold text-sm">Emergency Active</p>
                <p className="text-red-100 text-xs">
                  Status: {activeEmergency.status} • {activeEmergency.confidenceScore}% confidence
                </p>
              </div>
              <button onClick={cancelEmergency}
                className="text-xs bg-white/20 hover:bg-white/30 px-3 py-1.5 rounded-lg font-medium">
                Cancel
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Tab Content */}
      <div className="page-content">

        {tab === 'home' && (
          <>
            {/* GPS Status */}
            <div className="card p-4">
              <div className="flex items-center gap-3">
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${gps.location ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <MapPin className={`w-5 h-5 ${gps.location ? 'text-green-600' : 'text-gray-400'}`} />
                </div>
                <div>
                  <p className="text-sm font-semibold text-gray-800">GPS Location</p>
                  <p className="text-xs text-gray-500">
                    {gps.location
                      ? `${gps.location.lat.toFixed(5)}, ${gps.location.lng.toFixed(5)}`
                      : gps.loading ? 'Acquiring…' : 'Unavailable'}
                  </p>
                </div>
                {gps.location && (
                  <span className="badge-green ml-auto">Live</span>
                )}
              </div>
            </div>

            {/* Live Map */}
            {gps.location && (
              <MapView
                center={gps.location}
                markers={[{ lat: gps.location.lat, lng: gps.location.lng, label: 'You', color: 'red', pulse: true }]}
              />
            )}

            {/* Sensor Status Card */}
            <div className="card p-4">
              <p className="section-title">Sensor Status</p>
              <div className="grid grid-cols-3 gap-3">
                <div className={`rounded-xl p-3 text-center ${shake.isShaking ? 'bg-brand-50' : 'bg-gray-50'}`}>
                  <Activity className={`w-5 h-5 mx-auto mb-1 ${shake.isShaking ? 'text-brand-600 animate-pulse-fast' : 'text-gray-400'}`} />
                  <p className="text-xs font-medium text-gray-600">Shake</p>
                  <p className={`text-xs font-bold ${shake.isShaking ? 'text-brand-700' : 'text-gray-400'}`}>
                    {shake.magnitude.toFixed(1)}
                  </p>
                </div>
                <div className={`rounded-xl p-3 text-center ${shake.isStill ? 'bg-yellow-50' : 'bg-gray-50'}`}>
                  <Shield className={`w-5 h-5 mx-auto mb-1 ${shake.isStill ? 'text-yellow-600' : 'text-gray-400'}`} />
                  <p className="text-xs font-medium text-gray-600">Stillness</p>
                  <p className={`text-xs font-bold ${shake.isStill ? 'text-yellow-700' : 'text-gray-400'}`}>
                    {shake.stillnessDuration.toFixed(0)}s
                  </p>
                </div>
                <div className={`rounded-xl p-3 text-center ${motionEnabled ? 'bg-green-50' : 'bg-gray-50'}`}>
                  <Zap className={`w-5 h-5 mx-auto mb-1 ${motionEnabled ? 'text-green-600' : 'text-gray-400'}`} />
                  <p className="text-xs font-medium text-gray-600">Motion</p>
                  <p className={`text-xs font-bold ${motionEnabled ? 'text-green-700' : 'text-gray-400'}`}>
                    {motionEnabled ? 'On' : 'Off'}
                  </p>
                </div>
              </div>
            </div>

            {/* Manual SOS */}
            <div className="card p-4 text-center">
              <p className="text-sm text-gray-500 mb-4">
                In danger? Press the SOS button or shake your phone 3 times.
              </p>
              <button
                onClick={() => { setShakeMag(18); setDialogOpen(true); }}
                className="relative inline-flex items-center justify-center w-32 h-32 rounded-full bg-brand-600 shadow-brand-lg active:scale-95 transition-transform mx-auto"
              >
                <span className="absolute inset-0 rounded-full bg-brand-600 animate-ping-slow opacity-30" />
                <span className="absolute inset-3 rounded-full bg-brand-500" />
                <div className="relative text-white text-center">
                  <AlertTriangle className="w-8 h-8 mx-auto mb-0.5" />
                  <span className="text-xs font-bold">SOS</span>
                </div>
              </button>
              <p className="text-xs text-gray-400 mt-3">Tap to trigger emergency</p>
            </div>
          </>
        )}

        {tab === 'profile' && user && (
          <>
            {/* Profile Card */}
            <div className="card overflow-hidden">
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-6">
                <div className="flex items-center gap-4">
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                    <User className="w-8 h-8 text-white" />
                  </div>
                  <div>
                    <h2 className="text-white font-bold text-xl">{user.name}</h2>
                    <p className="text-red-100 text-sm">{user.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${BLOOD_COLORS[user.bloodGroup] || 'bg-gray-100 text-gray-600'}`}>
                        {user.bloodGroup}
                      </span>
                      <span className="text-red-100 text-xs">Age {user.age}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-5 space-y-4">
                <div className="flex items-center gap-3">
                  <Phone className="w-4 h-4 text-brand-600" />
                  <div>
                    <p className="text-xs text-gray-400">Phone</p>
                    <p className="text-sm font-medium text-gray-800">{user.phone}</p>
                  </div>
                </div>

                {user.conditions?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Heart className="w-4 h-4 text-brand-600" />
                      <p className="text-xs font-semibold text-gray-600">Medical Conditions</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {user.conditions.map(c => (
                        <span key={c} className="badge-red text-xs">{c}</span>
                      ))}
                    </div>
                  </div>
                )}

                {user.allergies?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Droplets className="w-4 h-4 text-orange-500" />
                      <p className="text-xs font-semibold text-gray-600">Allergies</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {user.allergies.map(a => (
                        <span key={a} className="badge-yellow text-xs">{a}</span>
                      ))}
                    </div>
                  </div>
                )}

                {user.medications?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Pill className="w-4 h-4 text-blue-500" />
                      <p className="text-xs font-semibold text-gray-600">Current Medications</p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {user.medications.map(m => (
                        <span key={m} className="badge-blue text-xs">{m}</span>
                      ))}
                    </div>
                  </div>
                )}

                {user.emergencyContacts?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Contact className="w-4 h-4 text-brand-600" />
                      <p className="text-xs font-semibold text-gray-600">Emergency Contacts</p>
                    </div>
                    {user.emergencyContacts.map((c, i) => (
                      <div key={i} className="flex items-center justify-between py-2 border-b border-gray-50 last:border-0">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{c.name}</p>
                          <p className="text-xs text-gray-400">{c.relation}</p>
                        </div>
                        <a href={`tel:${c.phone}`} className="text-brand-600 font-semibold text-sm">{c.phone}</a>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        {tab === 'history' && (
          <>
            <p className="section-title">Emergency History</p>
            {history.length === 0 ? (
              <div className="card p-8 text-center">
                <CheckCircle2 className="w-10 h-10 text-gray-300 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No emergencies recorded</p>
              </div>
            ) : (
              <div className="space-y-3">
                {history.map(e => (
                  <div key={e.id} className="card-red p-4">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <span className={statusBadge(e.status)}>{e.status}</span>
                          <span className={`badge ${e.classification === 'HIGH' ? 'badge-red' : 'badge-gray'}`}>
                            {e.classification}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" />
                          {new Date(e.timestamp).toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-bold text-brand-700">{e.confidenceScore}%</p>
                        <p className="text-xs text-gray-400">confidence</p>
                      </div>
                    </div>
                    <p className="text-xs text-gray-500 mt-2 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {e.location.lat.toFixed(4)}, {e.location.lng.toFixed(4)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button onClick={() => setTab('home')} className={`nav-tab ${tab === 'home' ? 'active' : ''}`}>
            <Heart className="w-5 h-5" />
            <span>Home</span>
          </button>
          <button onClick={() => setTab('profile')} className={`nav-tab ${tab === 'profile' ? 'active' : ''}`}>
            <User className="w-5 h-5" />
            <span>Profile</span>
          </button>
          <button onClick={() => setTab('history')} className={`nav-tab ${tab === 'history' ? 'active' : ''}`}>
            <Clock className="w-5 h-5" />
            <span>History</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
