// ─────────────────────────────────────────────
//  Hospital Dashboard
//  • Live hospital stats (editable)
//  • Incoming ambulance alerts with ETA
//  • Patient count from voice update
// ─────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Bed, Droplets, Wind, Users,
  LogOut, Bell, Clock, Ambulance, Edit2,
  Check, X, Phone, MapPin, Activity,
  Heart, Stethoscope, ChevronDown, ChevronUp,
} from 'lucide-react';
import { doc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuthStore } from '../../store/useAuthStore';
import { subscribeToHospitalAlerts } from '../../services/emergencyService';
import type { HospitalProfile, HospitalAlert, BloodBank, Emergency, AmbulanceProfile, UserProfile } from '../../types';
import MapView from '../../components/MapView';

const BLOOD_TYPES = ['Apos','Aneg','Bpos','Bneg','Opos','Oneg','ABpos','ABneg'] as const;
const BLOOD_LABELS: Record<string, string> = {
  Apos:'A+', Aneg:'A-', Bpos:'B+', Bneg:'B-',
  Opos:'O+', Oneg:'O-', ABpos:'AB+', ABneg:'AB-',
};

function EditableNumber({
  value, onSave, color = 'brand',
}: {
  value: number; onSave: (v: number) => void; color?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [val,     setVal]     = useState(String(value));

  const colorMap: Record<string, string> = {
    brand: 'text-brand-700', green: 'text-green-700',
    blue: 'text-blue-700', orange: 'text-orange-700',
  };

  return editing ? (
    <div className="flex items-center gap-1">
      <input
        type="number" value={val}
        onChange={e => setVal(e.target.value)}
        className="w-16 text-center border border-brand-300 rounded-lg text-sm font-bold py-0.5"
        autoFocus
      />
      <button onClick={() => { onSave(Number(val)); setEditing(false); }}
        className="w-6 h-6 bg-green-500 rounded flex items-center justify-center">
        <Check className="w-3 h-3 text-white" />
      </button>
      <button onClick={() => { setVal(String(value)); setEditing(false); }}
        className="w-6 h-6 bg-gray-200 rounded flex items-center justify-center">
        <X className="w-3 h-3 text-gray-600" />
      </button>
    </div>
  ) : (
    <button onClick={() => setEditing(true)} className="flex items-center gap-1 group">
      <span className={`text-2xl font-black ${colorMap[color] || colorMap.brand}`}>{value}</span>
      <Edit2 className="w-3 h-3 text-gray-300 group-hover:text-gray-500 transition-colors" />
    </button>
  );
}

export default function HospitalDashboard() {
  const { profile, signOut, firebaseUser } = useAuthStore();
  const hosp = profile as HospitalProfile;

  const [tab,          setTab]          = useState<'overview' | 'alerts' | 'details'>('overview');
  const [alerts,       setAlerts]       = useState<HospitalAlert[]>([]);
  const [expandedBed,  setExpandedBed]  = useState(false);
  const [localStats,   setLocalStats]   = useState<HospitalProfile | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null);
  const [ambulanceProfile, setAmbulanceProfile] = useState<AmbulanceProfile | null>(null);
  const [patientProfile, setPatientProfile] = useState<UserProfile | null>(null);

  // Listen to the selected alert's emergency and ambulance details in real-time
  useEffect(() => {
    if (!selectedAlertId) {
      setActiveEmergency(null);
      setAmbulanceProfile(null);
      setPatientProfile(null);
      return;
    }
    const alert = alerts.find(a => a.id === selectedAlertId);
    if (!alert) return;

    // Listen to emergency doc
    const unsubEmergency = onSnapshot(doc(db, 'emergencies', alert.emergencyId), (snap) => {
      if (snap.exists()) {
        setActiveEmergency({ id: snap.id, ...snap.data() } as Emergency);
      }
    });

    // Listen to ambulance doc
    const unsubAmbulance = onSnapshot(doc(db, 'users', alert.ambulanceId), (snap) => {
      if (snap.exists()) {
        setAmbulanceProfile({ uid: snap.id, ...snap.data() } as AmbulanceProfile);
      }
    });

    return () => {
      unsubEmergency();
      unsubAmbulance();
    };
  }, [selectedAlertId, alerts]);

  // Listen to the patient's full medical profile if it is a personal run
  useEffect(() => {
    if (!activeEmergency || activeEmergency.userId.startsWith('bystander_')) {
      setPatientProfile(null);
      return;
    }
    return onSnapshot(doc(db, 'users', activeEmergency.userId), (snap) => {
      if (snap.exists()) {
        setPatientProfile({ uid: snap.id, ...snap.data() } as UserProfile);
      }
    });
  }, [activeEmergency]);

  useEffect(() => { setLocalStats(hosp); }, [hosp]);

  useEffect(() => {
    if (!firebaseUser?.uid) return;
    return subscribeToHospitalAlerts(firebaseUser.uid, setAlerts);
  }, [firebaseUser?.uid]);

  // Auto-switch to alerts tab when a new alert comes in for instant demo feedback
  useEffect(() => {
    if (alerts.length > 0) {
      setTab('alerts');
    }
  }, [alerts.length]);

  const saveField = async (path: string, value: number) => {
    if (!firebaseUser?.uid) return;
    await updateDoc(doc(db, 'users', firebaseUser.uid), {
      [path]: value,
      updatedAt: serverTimestamp(),
    });
  };

  const updateBed = (type: 'general' | 'icu' | 'emergency', field: 'total' | 'available', val: number) => {
    if (!localStats) return;
    const updated = {
      ...localStats,
      beds: {
        ...localStats.beds,
        [type]: { ...localStats.beds[type], [field]: val },
      },
    };
    setLocalStats(updated);
    saveField(`beds.${type}.${field}`, val);
  };

  const updateBlood = (type: keyof BloodBank, val: number) => {
    if (!localStats) return;
    setLocalStats(s => s ? { ...s, blood: { ...s.blood, [type]: val } } : s);
    saveField(`blood.${type}`, val);
  };

  const updateOxygen = (val: number) => {
    if (!localStats) return;
    setLocalStats(s => s ? { ...s, oxygen: { ...s.oxygen!, cylinders: val } } : s);
    saveField('oxygen.cylinders', val);
  };

  const updateVentilators = (val: number) => {
    if (!localStats) return;
    setLocalStats(s => s ? { ...s, ventilators: val } : s);
    saveField('ventilators', val);
  };

  const timeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  const bedUtil = (avail: number, total: number) =>
    total > 0 ? Math.round(((total - avail) / total) * 100) : 0;

  if (!localStats) return null;

  return (
    <div className="page">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-full flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm leading-tight">{localStats.name}</h1>
            <p className="text-xs text-gray-400 truncate max-w-[180px]">{localStats.address}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {alerts.filter(a => a.status === 'en_route').length > 0 && (
            <span className="badge-red animate-pulse">
              {alerts.filter(a => a.status === 'en_route').length} incoming
            </span>
          )}
          <button onClick={signOut} className="btn-ghost p-2"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      <div className="page-content">

        {/* ── OVERVIEW TAB ───────────────────── */}
        {tab === 'overview' && (
          <>
            {/* Quick Stats */}
            <div className="grid grid-cols-2 gap-3">
              <div className="card p-4 border-l-4 border-l-brand-600">
                <div className="flex items-center justify-between mb-2">
                  <Bed className="w-4 h-4 text-brand-500" />
                  <span className="text-xs text-gray-400">General</span>
                </div>
                <EditableNumber
                  value={localStats.beds.general.available}
                  onSave={v => updateBed('general', 'available', v)}
                />
                <p className="text-xs text-gray-400 mt-0.5">/ {localStats.beds.general.total} total</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-500 rounded-full transition-all"
                    style={{ width: `${bedUtil(localStats.beds.general.available, localStats.beds.general.total)}%` }}
                  />
                </div>
              </div>

              <div className="card p-4 border-l-4 border-l-red-700">
                <div className="flex items-center justify-between mb-2">
                  <Activity className="w-4 h-4 text-red-600" />
                  <span className="text-xs text-gray-400">ICU</span>
                </div>
                <EditableNumber
                  value={localStats.beds.icu.available}
                  color="brand"
                  onSave={v => updateBed('icu', 'available', v)}
                />
                <p className="text-xs text-gray-400 mt-0.5">/ {localStats.beds.icu.total} total</p>
                <div className="mt-2 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-red-600 rounded-full transition-all"
                    style={{ width: `${bedUtil(localStats.beds.icu.available, localStats.beds.icu.total)}%` }}
                  />
                </div>
              </div>

              <div className="card p-4 border-l-4 border-l-blue-500">
                <div className="flex items-center justify-between mb-2">
                  <Wind className="w-4 h-4 text-blue-500" />
                  <span className="text-xs text-gray-400">Oxygen</span>
                </div>
                <EditableNumber
                  value={localStats.oxygen?.cylinders ?? 0}
                  color="blue"
                  onSave={updateOxygen}
                />
                <p className="text-xs text-gray-400 mt-0.5">cylinders</p>
              </div>

              <div className="card p-4 border-l-4 border-l-purple-500">
                <div className="flex items-center justify-between mb-2">
                  <Heart className="w-4 h-4 text-purple-500 fill-purple-500" />
                  <span className="text-xs text-gray-400">Ventilators</span>
                </div>
                <EditableNumber
                  value={localStats.ventilators ?? 0}
                  color="brand"
                  onSave={updateVentilators}
                />
                <p className="text-xs text-gray-400 mt-0.5">available</p>
              </div>
            </div>

            {/* Blood Bank */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="section-title mb-0">Blood Bank</p>
                <Droplets className="w-4 h-4 text-brand-600" />
              </div>
              <div className="grid grid-cols-4 gap-2">
                {BLOOD_TYPES.map(type => {
                  const count = localStats.blood?.[type as keyof BloodBank] ?? 0;
                  const low = count < 3;
                  return (
                    <div key={type} className={`rounded-xl p-2.5 text-center border ${low ? 'border-red-200 bg-red-50' : 'border-gray-100 bg-gray-50'}`}>
                      <p className={`text-xs font-bold mb-1 ${low ? 'text-red-600' : 'text-gray-700'}`}>
                        {BLOOD_LABELS[type]}
                      </p>
                      <EditableNumber
                        value={count}
                        color={low ? 'brand' : 'brand'}
                        onSave={v => updateBlood(type as keyof BloodBank, v)}
                      />
                      <p className="text-xs text-gray-400 mt-0.5">units</p>
                      {low && <p className="text-xs text-red-500 font-semibold">Low!</p>}
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Specialties */}
            <div className="card p-4">
              <div className="flex items-center justify-between mb-3">
                <p className="section-title mb-0">Specialties</p>
                <Stethoscope className="w-4 h-4 text-brand-600" />
              </div>
              <div className="flex flex-wrap gap-2">
                {(localStats.specialties || []).map(s => (
                  <span key={s} className="badge-blue">{s}</span>
                ))}
              </div>
            </div>

            {/* Doctors on Duty */}
            {localStats.doctorsOnDuty?.length > 0 && (
              <div className="card p-4">
                <p className="section-title">Doctors On Duty</p>
                <div className="space-y-2">
                  {localStats.doctorsOnDuty.map((d, i) => (
                    <div key={i} className="flex items-center gap-3 py-2 border-b border-gray-50 last:border-0">
                      <div className="w-8 h-8 bg-brand-50 rounded-full flex items-center justify-center">
                        <Users className="w-4 h-4 text-brand-600" />
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">Dr. {d.name}</p>
                        <p className="text-xs text-gray-400">{d.specialty}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Beds detail expandable */}
            <div className="card overflow-hidden">
              <button
                onClick={() => setExpandedBed(s => !s)}
                className="w-full flex items-center justify-between p-4"
              >
                <div className="flex items-center gap-2">
                  <Bed className="w-4 h-4 text-brand-600" />
                  <span className="text-sm font-semibold text-gray-800">Emergency Beds</span>
                </div>
                {expandedBed ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
              </button>
              <AnimatePresence>
                {expandedBed && (
                  <motion.div initial={{ height: 0 }} animate={{ height: 'auto' }} exit={{ height: 0 }} className="overflow-hidden">
                    <div className="px-4 pb-4 space-y-3 border-t border-gray-50 pt-3">
                      {(['general','icu','emergency'] as const).map(type => (
                        <div key={type} className="flex items-center justify-between">
                          <span className="text-sm text-gray-600 capitalize">{type === 'icu' ? 'ICU' : type}</span>
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400">Avail:</span>
                            <EditableNumber
                              value={localStats.beds[type].available}
                              onSave={v => updateBed(type, 'available', v)}
                            />
                            <span className="text-xs text-gray-300">/</span>
                            <span className="text-sm font-medium text-gray-600">{localStats.beds[type].total}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </>
        )}

        {/* ── ALERTS TAB ─────────────────────── */}
        {tab === 'alerts' && (
          <>
            <div className="flex items-center justify-between mb-1">
              <p className="section-title mb-0">Incoming Ambulances</p>
              {alerts.filter(a => a.status === 'en_route').length > 0 && (
                <span className="badge-red animate-pulse">
                  {alerts.filter(a => a.status === 'en_route').length} en route
                </span>
              )}
            </div>

            {alerts.length === 0 ? (
              <div className="card p-8 text-center">
                <Ambulance className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No incoming ambulances</p>
                <p className="text-gray-300 text-xs mt-1">Alerts will appear here automatically</p>
              </div>
            ) : (
              <div className="space-y-3">
                {alerts.map(alert => (
                  <motion.div
                    key={alert.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    onClick={() => setSelectedAlertId(selectedAlertId === alert.id ? null : alert.id)}
                    className={`rounded-2xl border-l-4 bg-white shadow-card p-4 cursor-pointer hover:border-brand-300 transition-all ${
                      selectedAlertId === alert.id
                        ? 'border-l-brand-600 shadow-md ring-1 ring-brand-200/50'
                        : alert.status === 'en_route' ? 'border-l-brand-600/70 border-gray-100' : 'border-l-green-500 border-gray-100'
                    }`}
                  >
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 mb-1">
                          <Ambulance className="w-4 h-4 text-brand-600" />
                          <span className="font-bold text-sm text-gray-900">{alert.ambulanceVehicleNo}</span>
                          <span className={alert.status === 'en_route' ? 'badge-yellow' : 'badge-green'}>
                            {alert.status === 'en_route' ? 'En Route' : 'Arrived'}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 flex items-center gap-1">
                          <Clock className="w-3 h-3" /> {timeAgo(alert.timestamp)}
                        </p>
                      </div>
                      <div className="text-right bg-brand-50 rounded-xl px-3 py-2">
                        <p className="text-xl font-black text-brand-700">{alert.etaMinutes}</p>
                        <p className="text-xs text-brand-500 font-medium">min ETA</p>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 gap-2 mb-3">
                      <div className="bg-gray-50 rounded-xl p-2.5 flex items-center gap-2">
                        <Users className="w-4 h-4 text-brand-600" />
                        <div>
                          <p className="text-sm font-bold text-gray-900">{alert.patientCount}</p>
                          <p className="text-xs text-gray-400">patient{alert.patientCount > 1 ? 's' : ''}</p>
                        </div>
                      </div>
                      <div className="bg-gray-50 rounded-xl p-2.5 flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-brand-600" />
                        <div>
                          <p className="text-xs font-medium text-gray-700">Distance</p>
                          <p className="text-xs text-gray-400">
                            {selectedAlertId === alert.id ? "Tracking Active" : "Click to track"}
                          </p>
                        </div>
                      </div>
                    </div>

                    {alert.condition && (
                      <div className="bg-brand-50 rounded-xl p-3 flex items-start gap-2">
                        <Activity className="w-3.5 h-3.5 text-brand-600 mt-0.5 shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-brand-700 mb-0.5">Paramedic Update</p>
                          <p className="text-sm text-gray-700 italic">"{alert.condition}"</p>
                        </div>
                      </div>
                    )}

                    {selectedAlertId === alert.id && (
                      <div className="mt-4 pt-4 border-t border-gray-100 space-y-4" onClick={e => e.stopPropagation()}>
                        {/* Live Map Tracker */}
                        {((ambulanceProfile?.location) || (activeEmergency?.location) || (localStats?.location)) && (
                          <div>
                            <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">
                              Live Route Tracking
                            </p>
                            <MapView
                              center={ambulanceProfile?.location || activeEmergency?.location || localStats!.location}
                              routePoints={
                                ambulanceProfile?.location && localStats?.location
                                  ? [ambulanceProfile.location, localStats.location]
                                  : undefined
                              }
                              zoom={13}
                              height="200px"
                              markers={[
                                ...(ambulanceProfile?.location ? [{
                                  lat: ambulanceProfile.location.lat,
                                  lng: ambulanceProfile.location.lng,
                                  label: `Ambulance (${ambulanceProfile.vehicleNo})`,
                                  color: 'blue' as const,
                                  pulse: true
                                }] : []),
                                ...(activeEmergency?.location ? [{
                                  lat: activeEmergency.location.lat,
                                  lng: activeEmergency.location.lng,
                                  label: `Patient Location`,
                                  color: 'red' as const,
                                  pulse: true
                                }] : []),
                                ...(localStats?.location ? [{
                                  lat: localStats.location.lat,
                                  lng: localStats.location.lng,
                                  label: localStats.name,
                                  color: 'green' as const
                                }] : [])
                              ]}
                            />
                          </div>
                        )}

                        {/* Patient Medical Details */}
                        <div className="bg-gray-50 rounded-2xl p-4 space-y-3">
                          <p className="text-xs font-bold text-gray-500 uppercase tracking-wider">
                            Patient Medical Profile
                          </p>

                          {activeEmergency?.userId.startsWith('bystander_') ? (
                            <div className="space-y-2">
                              <span className="badge-yellow text-xs font-bold">Anonymous Bystander Mode</span>
                              <div className="grid grid-cols-2 gap-2 text-xs">
                                <div>
                                  <p className="text-gray-400">Name</p>
                                  <p className="font-semibold text-gray-700">Anonymous Bystander (Reported)</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Phone</p>
                                  <p className="font-semibold text-gray-700">Hidden for Privacy</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Blood Group</p>
                                  <p className="font-semibold text-gray-700">N/A</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Severity</p>
                                  <p className="font-semibold text-red-600">HIGH (Bystander Confirmed)</p>
                                </div>
                              </div>
                            </div>
                          ) : activeEmergency ? (
                            <div className="space-y-3">
                              <div className="grid grid-cols-3 gap-2 text-xs">
                                <div>
                                  <p className="text-gray-400">Name</p>
                                  <p className="font-bold text-gray-800">{activeEmergency.userName}</p>
                                </div>
                                <div>
                                  <p className="text-gray-400">Phone</p>
                                  <a href={`tel:${activeEmergency.userPhone}`} className="font-bold text-brand-600 underline">
                                    {activeEmergency.userPhone}
                                  </a>
                                </div>
                                <div>
                                  <p className="text-gray-400">Blood Group</p>
                                  <span className="badge-red text-[10px] font-bold px-2 py-0.5 rounded">
                                    {activeEmergency.userBloodGroup}
                                  </span>
                                </div>
                              </div>

                              {patientProfile && (
                                <div className="space-y-2.5 pt-2 border-t border-gray-200/50">
                                  {patientProfile.conditions?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-gray-400">Conditions</p>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {patientProfile.conditions.map(c => (
                                          <span key={c} className="text-[10px] bg-red-50 text-red-600 font-medium px-2 py-0.5 rounded-full">
                                            {c}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {patientProfile.allergies?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-gray-400">Allergies</p>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {patientProfile.allergies.map(a => (
                                          <span key={a} className="text-[10px] bg-yellow-50 text-yellow-700 font-medium px-2 py-0.5 rounded-full">
                                            {a}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}

                                  {patientProfile.medications?.length > 0 && (
                                    <div>
                                      <p className="text-[10px] font-bold text-gray-400">Medications</p>
                                      <div className="flex flex-wrap gap-1 mt-1">
                                        {patientProfile.medications.map(m => (
                                          <span key={m} className="text-[10px] bg-blue-50 text-blue-600 font-medium px-2 py-0.5 rounded-full">
                                            {m}
                                          </span>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-gray-400">Loading details…</p>
                          )}
                        </div>
                      </div>
                    )}
                  </motion.div>
                ))}
              </div>
            )}
          </>
        )}

        {/* ── DETAILS TAB ────────────────────── */}
        {tab === 'details' && (
          <div className="card overflow-hidden">
            <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-6">
              <Building2 className="w-10 h-10 text-white/70 mb-2" />
              <h2 className="text-white font-bold text-xl">{localStats.name}</h2>
              <p className="text-red-100 text-sm mt-1">{localStats.address}</p>
            </div>
            <div className="p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-brand-600" />
                <div>
                  <p className="text-xs text-gray-400">Phone</p>
                  <p className="text-sm font-medium">{localStats.phone}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <MapPin className="w-4 h-4 text-brand-600" />
                <div>
                  <p className="text-xs text-gray-400">Location (GPS)</p>
                  <p className="text-sm font-medium">
                    {localStats.location?.lat?.toFixed(5)}, {localStats.location?.lng?.toFixed(5)}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-2">Specialties</p>
                <div className="flex flex-wrap gap-2">
                  {localStats.specialties?.map(s => <span key={s} className="badge-blue">{s}</span>)}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button onClick={() => setTab('overview')} className={`nav-tab ${tab === 'overview' ? 'active' : ''}`}>
            <Activity className="w-5 h-5" />
            <span>Overview</span>
          </button>
          <button onClick={() => setTab('alerts')} className={`nav-tab relative ${tab === 'alerts' ? 'active' : ''}`}>
            <Bell className="w-5 h-5" />
            <span>Alerts</span>
            {alerts.filter(a => a.status === 'en_route').length > 0 && (
              <span className="absolute top-1 right-2 w-4 h-4 bg-brand-600 text-white text-xs rounded-full flex items-center justify-center font-bold">
                {alerts.filter(a => a.status === 'en_route').length}
              </span>
            )}
          </button>
          <button onClick={() => setTab('details')} className={`nav-tab ${tab === 'details' ? 'active' : ''}`}>
            <Building2 className="w-5 h-5" />
            <span>Details</span>
          </button>
        </div>
      </nav>
    </div>
  );
}
