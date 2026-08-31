// ─────────────────────────────────────────────
//  User Dashboard
//  • Profile card + medical info
//  • Shake detector + GPS
//  • Emergency dialog trigger
//  • Emergency history
// ─────────────────────────────────────────────
import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Heart, Activity, MapPin, Phone, AlertTriangle,
  Shield, Zap, LogOut, User, Clock, CheckCircle2,
  Droplets, Pill, Contact, Siren, EyeOff, Eye, Users, ShieldAlert,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useShakeDetector } from '../../hooks/useShakeDetector';
import { useGPS } from '../../hooks/useGPS';
import EmergencyDialog from '../../components/EmergencyDialog';
import MapView from '../../components/MapView';
import { createEmergency, updateEmergency, getTimestampMillis, subscribeToAmbulances } from '../../services/emergencyService';
import type { UserProfile, AIAnalysisResult, SensorData, Emergency, AmbulanceProfile } from '../../types';
import { collection, onSnapshot, query, doc } from 'firebase/firestore';
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
  const [dispatchedAmbulance, setDispatchedAmbulance] = useState<AmbulanceProfile | null>(null);
  const [ambulances,      setAmbulances]      = useState<AmbulanceProfile[]>([]);
  const [history,         setHistory]         = useState<Emergency[]>([]);
  const [motionEnabled,   setMotionEnabled]   = useState(false);
  const [tab,             setTab]             = useState<'home' | 'profile' | 'history'>('home');
  const [bystanderMode,   setBystanderMode]   = useState(false);

  const gps = useGPS(true);
  const pendingEmergencyIdRef = useRef<string | null>(null);

  // Instantly start emergency trigger (writes status 'triggered' to Firestore to notify ambulance with 0 delay)
  const startEmergencyTrigger = useCallback(async (initialMag: number) => {
    if (activeEmergency || dialogOpen) return;
    setShakeMag(initialMag);
    setDialogOpen(true);

    if (!firebaseUser) return;

    const emergencyLoc = gps.location || { lat: 13.0627, lng: 80.2545 };

    try {
      const emergencyId = await createEmergency({
        userId:       firebaseUser.uid,
        userName:     user?.name || 'Unknown',
        userPhone:    user?.phone || '',
        userBloodGroup: user?.bloodGroup || 'Unknown',
        location:     emergencyLoc,
        status:       'triggered',
        classification: 'HIGH',
        confidenceScore: 0,
        sensorData:   { maxShakeMagnitude: initialMag, stillnessDuration: 0, audioLevel: 0 },
        timestamp:    Date.now(),
      });

      pendingEmergencyIdRef.current = emergencyId;

      setActiveEmergency({
        id: emergencyId,
        userId: firebaseUser.uid,
        userName: user?.name || 'Unknown',
        userPhone: user?.phone || '',
        userBloodGroup: user?.bloodGroup || 'Unknown',
        location: emergencyLoc,
        status: 'triggered',
        classification: 'HIGH',
        confidenceScore: 0,
        sensorData: { maxShakeMagnitude: initialMag, stillnessDuration: 0, audioLevel: 0 },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to pre-trigger emergency:", err);
    }
  }, [activeEmergency, dialogOpen, firebaseUser, gps.location, user]);

  // Shake handlers
  const handleShake = useCallback((mag: number) => {
    startEmergencyTrigger(mag);
  }, [startEmergencyTrigger]);

  // Start Bystander Emergency: Instantly sends request without personal details
  const startBystanderEmergency = useCallback(async () => {
    if (activeEmergency) return;
    if (!firebaseUser) return;

    const emergencyLoc = gps.location || { lat: 13.0627, lng: 80.2545 };

    try {
      const emergencyId = await createEmergency({
        userId:       `bystander_${firebaseUser.uid}`,
        userName:     'Anonymous Bystander (Reported)',
        userPhone:    'Hidden for Privacy',
        userBloodGroup: 'N/A',
        location:     emergencyLoc,
        status:       'confirmed', // Directly confirmed
        classification: 'HIGH',
        confidenceScore: 100,
        sensorData:   { maxShakeMagnitude: 0, stillnessDuration: 0, audioLevel: 0 },
        timestamp:    Date.now(),
      });

      pendingEmergencyIdRef.current = emergencyId;

      setActiveEmergency({
        id: emergencyId,
        userId: `bystander_${firebaseUser.uid}`,
        userName: 'Anonymous Bystander (Reported)',
        userPhone: 'Hidden for Privacy',
        userBloodGroup: 'N/A',
        location: emergencyLoc,
        status: 'confirmed',
        classification: 'HIGH',
        confidenceScore: 100,
        sensorData: { maxShakeMagnitude: 0, stillnessDuration: 0, audioLevel: 0 },
        timestamp: Date.now(),
      });
    } catch (err) {
      console.error("Failed to trigger bystander emergency:", err);
    }
  }, [activeEmergency, firebaseUser, gps.location]);

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
    // BULLETPROOF: Query all emergencies and filter client-side to bypass all index limits
    const q = query(collection(db, 'emergencies'));
    return onSnapshot(q, snap => {
      const all = snap.docs
        .map(d => {
          const data = d.data();
          return {
            id: d.id,
            ...data,
            timestamp: getTimestampMillis(data.timestamp),
          } as Emergency;
        })
        .filter(e => e.userId === firebaseUser.uid || e.userId === `bystander_${firebaseUser.uid}`);

      // Sort client-side descending
      all.sort((a, b) => b.timestamp - a.timestamp);
      // Slice top 10 for history
      const limited = all.slice(0, 10);
      setHistory(limited);
      
      const active = all.find(e => ['triggered','confirmed','dispatched'].includes(e.status));
      setActiveEmergency(active || null);
      if (active && active.userId.startsWith('bystander_')) {
        setBystanderMode(true);
      }
    }, (error) => {
      console.error("User history query error:", error);
    });
  }, [firebaseUser?.uid]);

  // Dynamically update emergency location in Firestore as GPS changes
  useEffect(() => {
    if (!activeEmergency || !gps.location) return;
    const prevLoc = activeEmergency.location;
    const distanceShift = Math.abs(prevLoc.lat - gps.location.lat) + Math.abs(prevLoc.lng - gps.location.lng);
    if (distanceShift > 0.00001) { // roughly 1 meter shift
      updateEmergency(activeEmergency.id, { location: gps.location });
    }
  }, [gps.location, activeEmergency]);

  // Listen to dispatched ambulance profile updates in real-time
  useEffect(() => {
    if (!activeEmergency?.ambulanceId) {
      setDispatchedAmbulance(null);
      return;
    }
    return onSnapshot(doc(db, 'users', activeEmergency.ambulanceId), (snap) => {
      if (snap.exists()) {
        setDispatchedAmbulance({ uid: snap.id, ...snap.data() } as AmbulanceProfile);
      }
    });
  }, [activeEmergency?.ambulanceId]);

  // Listen to all ambulances to show standby list
  useEffect(() => {
    return subscribeToAmbulances(setAmbulances);
  }, []);

  const handleAbort = useCallback(async () => {
    setDialogOpen(false);
    const id = activeEmergency?.id || pendingEmergencyIdRef.current;
    if (id) {
      await updateEmergency(id, { status: 'aborted' as const });
    }
    setActiveEmergency(null);
    pendingEmergencyIdRef.current = null;
  }, [activeEmergency]);

  const handleConfirmed = useCallback(async (result: AIAnalysisResult, sensor: SensorData) => {
    setDialogOpen(false);
    
    const id = activeEmergency?.id || pendingEmergencyIdRef.current;
    if (!id || !firebaseUser) return;

    // Use GPS location if available, otherwise fallback to mock Chennai location
    const emergencyLoc = gps.location || { lat: 13.0627, lng: 80.2545 };

    const updateData = {
      status: 'confirmed' as const,
      classification: result.classification,
      confidenceScore: result.confidenceScore,
      sensorData: sensor,
      location: emergencyLoc,
    };

    try {
      await updateEmergency(id, updateData);

      setActiveEmergency(prev => {
        if (!prev) return null;
        return {
          ...prev,
          ...updateData,
        };
      });
    } catch (err) {
      console.error("Failed to confirm emergency:", err);
    }
    
    pendingEmergencyIdRef.current = null;
  }, [activeEmergency, firebaseUser, gps.location]);

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
          <button
            onClick={() => {
              if (activeEmergency) {
                alert("Cannot toggle modes during an active emergency.");
                return;
              }
              setBystanderMode(prev => !prev);
            }}
            className={`p-2 rounded-lg transition-colors flex items-center gap-1 ${
              bystanderMode
                ? 'bg-orange-100 text-orange-600 border border-orange-200'
                : 'btn-ghost text-gray-500 hover:bg-gray-100'
            }`}
            title={bystanderMode ? 'Switch to Personal Mode' : 'Switch to Bystander Mode'}
          >
            {bystanderMode ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
            <span className="text-xs font-bold">Bystander</span>
          </button>
          <button onClick={signOut} className="btn-ghost p-2">
            <LogOut className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Active Emergency Banner */}
      <AnimatePresence>
        {activeEmergency && !bystanderMode && (
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
        {bystanderMode ? (
          <div className="space-y-4">
            {/* Bystander Status Header */}
            <div className="card p-5 bg-gradient-to-r from-orange-500 to-orange-600 text-white shadow-lg">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                  <ShieldAlert className="w-5 h-5 text-white" />
                </div>
                <div>
                  <h2 className="font-black text-lg">Anonymous Bystander Mode</h2>
                  <p className="text-xs text-orange-100 font-medium">Report an emergency for someone else</p>
                </div>
              </div>
            </div>

            {/* Explanatory Info Card */}
            {!activeEmergency && (
              <div className="card p-4 bg-gray-50 border border-gray-200/60 text-center space-y-3">
                <div className="w-12 h-12 bg-orange-100 rounded-full flex items-center justify-center mx-auto">
                  <Users className="w-6 h-6 text-orange-600" />
                </div>
                <h3 className="font-bold text-gray-900 text-sm">100% Privacy Protected</h3>
                <p className="text-xs text-gray-500 max-w-xs mx-auto leading-relaxed">
                  Summon immediate medical help to your current GPS coordinates. Your name, phone number, medical history, and contact card are **completely hidden** from dispatchers and hospitals.
                </p>
              </div>
            )}

            {/* GPS Proximity / Standby Map */}
            {(gps.location || activeEmergency?.location) && (
              <MapView
                center={gps.location || activeEmergency?.location || { lat: 13.0627, lng: 80.2545 }}
                showRoute={!!dispatchedAmbulance}
                markers={[
                  { 
                    lat: gps.location?.lat ?? activeEmergency?.location.lat ?? 13.0627, 
                    lng: gps.location?.lng ?? activeEmergency?.location.lng ?? 80.2545, 
                    label: 'Incident Location', 
                    color: 'red' as const, 
                    pulse: true 
                  },
                  ...(dispatchedAmbulance?.location ? [{
                    lat: dispatchedAmbulance.location.lat,
                    lng: dispatchedAmbulance.location.lng,
                    label: `Ambulance: ${dispatchedAmbulance.vehicleNo} (${dispatchedAmbulance.driverName})`,
                    color: 'blue' as const,
                    pulse: true
                  }] : activeEmergency ? ambulances.filter(a => a.status === 'available' && a.location).map(a => ({
                    lat: a.location!.lat,
                    lng: a.location!.lng,
                    label: `Available: ${a.vehicleNo} (${a.driverName})`,
                    color: 'blue' as const,
                    pulse: false
                  })) : [])
                ]}
              />
            )}

            {/* Active Emergency Status or Dispatch Trigger */}
            {activeEmergency ? (
              <div className="card p-5 border-l-4 border-l-orange-500 bg-orange-50/50 space-y-4">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center animate-pulse">
                    <Siren className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h3 className="font-bold text-gray-900 text-sm">
                      {dispatchedAmbulance ? "Ambulance Dispatched & Accepted" : "Emergency Alert Transmitted"}
                    </h3>
                    <p className="text-xs text-gray-500 capitalize">
                      Status: {dispatchedAmbulance ? "Accepted & en route" : "Awaiting driver acceptance"}
                    </p>
                  </div>
                </div>

                {dispatchedAmbulance ? (
                  <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-bold text-gray-900">{dispatchedAmbulance.driverName}</p>
                        <p className="text-xs text-gray-400">Driver ({dispatchedAmbulance.vehicleType})</p>
                      </div>
                      <span className="badge-red text-xs font-bold px-2.5 py-1 rounded-lg">
                        {dispatchedAmbulance.vehicleNo}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <a href={`tel:${dispatchedAmbulance.phone}`} className="btn-primary py-2 text-xs flex-1 justify-center gap-1 bg-orange-600 hover:bg-orange-700">
                        <Phone className="w-3.5 h-3.5" /> Call Driver
                      </a>
                    </div>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                        Available Standby Ambulances
                      </p>
                      <span className="flex h-2 w-2 relative">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                      </span>
                    </div>

                    {ambulances.filter(a => a.status === 'available').length === 0 ? (
                      <div className="text-center py-4">
                        <div className="flex justify-center gap-1.5 mb-2">
                          {[0,1,2].map(i => (
                            <div key={i} className="w-2 h-2 bg-orange-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                          ))}
                        </div>
                        <p className="text-xs text-gray-400 font-medium">Alerting dispatch hubs…</p>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {ambulances.filter(a => a.status === 'available').map(a => (
                          <div key={a.uid} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border border-gray-100/50">
                            <div>
                              <p className="text-xs font-extrabold text-gray-800">{a.vehicleNo}</p>
                              <p className="text-[10px] text-gray-500 font-medium">
                                Driver: {a.driverName}
                              </p>
                            </div>
                            <span className="text-[9px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded">
                              Standby
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <button onClick={cancelEmergency} className="btn-secondary w-full py-3 text-sm font-bold border-orange-200 text-orange-700 hover:bg-orange-50">
                  Cancel Emergency Alert
                </button>
              </div>
            ) : (
              <div className="card p-5 text-center space-y-4">
                <button
                  onClick={startBystanderEmergency}
                  className="relative inline-flex items-center justify-center w-36 h-36 rounded-full bg-orange-600 shadow-orange-lg active:scale-95 transition-all mx-auto"
                >
                  <span className="absolute inset-0 rounded-full bg-orange-600 animate-ping-slow opacity-30" />
                  <span className="absolute inset-3 rounded-full bg-orange-500" />
                  <div className="relative text-white text-center">
                    <ShieldAlert className="w-9 h-9 mx-auto mb-1" />
                    <span className="text-xs font-black tracking-wider block">CALL</span>
                    <span className="text-[10px] font-bold block opacity-90">AMBULANCE</span>
                  </div>
                </button>
                <div>
                  <h4 className="font-extrabold text-gray-800 text-sm">Tap to Summon Anonymous Help</h4>
                  <p className="text-[11px] text-gray-400 mt-1">This will instantly dispatch the closest standby ambulance.</p>
                </div>
              </div>
            )}
            
            {/* Back Button */}
            {!activeEmergency && (
              <button
                onClick={() => setBystanderMode(false)}
                className="btn-ghost w-full py-2.5 text-xs text-gray-500 hover:text-gray-700 font-medium flex items-center justify-center gap-1.5"
              >
                ← Return to Personal Profile Mode
              </button>
            )}
          </div>
        ) : (
          <>
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

                {/* Live Map / Tracker */}
                {(gps.location || activeEmergency?.location) && (
                  <MapView
                    center={gps.location || activeEmergency?.location || { lat: 13.0627, lng: 80.2545 }}
                    showRoute={!!dispatchedAmbulance}
                    markers={[
                      { 
                        lat: gps.location?.lat ?? activeEmergency?.location.lat ?? 13.0627, 
                        lng: gps.location?.lng ?? activeEmergency?.location.lng ?? 80.2545, 
                        label: 'You', 
                        color: 'red' as const, 
                        pulse: true 
                      },
                      ...(dispatchedAmbulance?.location ? [{
                        lat: dispatchedAmbulance.location.lat,
                        lng: dispatchedAmbulance.location.lng,
                        label: `Ambulance: ${dispatchedAmbulance.vehicleNo} (${dispatchedAmbulance.driverName})`,
                        color: 'blue' as const,
                        pulse: true
                      }] : activeEmergency ? ambulances.filter(a => a.status === 'available' && a.location).map(a => ({
                        lat: a.location!.lat,
                        lng: a.location!.lng,
                        label: `Available: ${a.vehicleNo} (${a.driverName})`,
                        color: 'blue' as const,
                        pulse: false
                      })) : [])
                    ]}
                  />
                )}

                {/* Conditionally render: Active tracker or Trigger options */}
                {activeEmergency ? (
                  <div className="card p-5 border-l-4 border-l-brand-600 bg-red-50/50 space-y-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center animate-pulse">
                        <Siren className="w-5 h-5 text-brand-600" />
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-sm">Emergency Assistance En Route</h3>
                        <p className="text-xs text-gray-500 capitalize">Status: {activeEmergency.status}</p>
                      </div>
                    </div>

                    {dispatchedAmbulance ? (
                      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between">
                          <div>
                            <p className="text-sm font-bold text-gray-900">{dispatchedAmbulance.driverName}</p>
                            <p className="text-xs text-gray-400">Driver ({dispatchedAmbulance.vehicleType})</p>
                          </div>
                          <span className="badge-red text-xs font-bold px-2.5 py-1 rounded-lg">
                            {dispatchedAmbulance.vehicleNo}
                          </span>
                        </div>

                        <div className="flex gap-2">
                          <a href={`tel:${dispatchedAmbulance.phone}`} className="btn-primary py-2 text-xs flex-1 justify-center gap-1">
                            <Phone className="w-3.5 h-3.5" /> Call Driver
                          </a>
                        </div>
                      </div>
                    ) : (
                      <div className="bg-white rounded-xl p-4 border border-gray-100 shadow-sm space-y-3">
                        <div className="flex items-center justify-between mb-2">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Available Ambulances Nearby
                          </p>
                          <span className="flex h-2 w-2 relative">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500"></span>
                          </span>
                        </div>

                        {ambulances.filter(a => a.status === 'available').length === 0 ? (
                          <div className="text-center py-4">
                            <div className="flex justify-center gap-1.5 mb-2">
                              {[0,1,2].map(i => (
                                <div key={i} className="w-2 h-2 bg-brand-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />
                              ))}
                            </div>
                            <p className="text-xs text-gray-400 font-medium">Alerting local dispatch hubs…</p>
                          </div>
                        ) : (
                          <div className="space-y-2">
                            {ambulances.filter(a => a.status === 'available').map(a => (
                              <div key={a.uid} className="flex items-center justify-between bg-gray-50 p-2.5 rounded-xl border border-gray-100/50">
                                <div>
                                  <p className="text-xs font-extrabold text-gray-800">{a.vehicleNo}</p>
                                  <p className="text-[10px] text-gray-500 font-medium">
                                    Type: {a.vehicleType} • Driver: {a.driverName}
                                  </p>
                                </div>
                                <span className="text-[9px] bg-green-100 text-green-700 font-bold px-2 py-0.5 rounded">
                                  Standby
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
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
                        In danger? Press the SOS button or shake your phone.
                      </p>
                      <button
                        onClick={() => { startEmergencyTrigger(42); }}
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
          </>
        )}
      </div>

      {/* Bottom Nav */}
      {!bystanderMode && (
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
      )}
    </div>
  );
}
