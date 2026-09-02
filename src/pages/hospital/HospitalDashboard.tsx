// ─────────────────────────────────────────────
//  Hospital Dashboard
//  • Live hospital stats (editable)
//  • Incoming ambulance alerts with ETA
//  • Patient count from voice update
//  • Patient treatment report & alert dismissal
// ─────────────────────────────────────────────
import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Building2, Bed, Droplets, Wind, Users,
  LogOut, Bell, Clock, Ambulance, Edit2,
  Check, X, Phone, MapPin, Activity,
  Heart, Stethoscope, ChevronDown, ChevronUp,
  FileText, CheckCircle2, Printer,
} from 'lucide-react';
import { doc, updateDoc, serverTimestamp, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase/config';
import { useAuthStore } from '../../store/useAuthStore';
import { subscribeToHospitalAlerts, markPatientTreatedAndDismissAlert } from '../../services/emergencyService';
import type { HospitalProfile, HospitalAlert, BloodBank, Emergency, AmbulanceProfile, UserProfile, PatientTreatmentReport } from '../../types';
import MapView from '../../components/MapView';

const BLOOD_TYPES = ['Apos','Aneg','Bpos','Bneg','Opos','Oneg','ABpos','ABneg'] as const;
const BLOOD_LABELS: Record<string, string> = {
  Apos:'A+', Aneg:'A-', Bpos:'B+', Bneg:'B-',
  Opos:'O+', Oneg:'O-', ABpos:'AB+', ABneg:'AB-',
};

const COMMON_INTERVENTIONS = [
  'IV Access & Fluids Infusion',
  'Supplemental Oxygen Therapy',
  '12-Lead ECG Monitoring',
  'Wound Dressing & Suturing',
  'Analgesics & Pain Management',
  'Blood Transfusion Administered',
  'C-Spine Immobilization',
  'Airway Clearance / Intubation',
];

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
  const [alertSubTab,  setAlertSubTab]  = useState<'incoming' | 'treated'>('incoming');
  const [alerts,       setAlerts]       = useState<HospitalAlert[]>([]);
  const [expandedBed,  setExpandedBed]  = useState(false);
  const [localStats,   setLocalStats]   = useState<HospitalProfile | null>(null);
  const [selectedAlertId, setSelectedAlertId] = useState<string | null>(null);
  const [activeEmergency, setActiveEmergency] = useState<Emergency | null>(null);
  const [ambulanceProfile, setAmbulanceProfile] = useState<AmbulanceProfile | null>(null);
  const [patientProfile, setPatientProfile] = useState<UserProfile | null>(null);

  // Treatment Modal & Report State
  const [treatingAlert, setTreatingAlert] = useState<HospitalAlert | null>(null);
  const [viewingReport, setViewingReport] = useState<PatientTreatmentReport | null>(null);
  const [treatmentSaving, setTreatmentSaving] = useState(false);
  const [treatmentSuccess, setTreatmentSuccess] = useState(false);

  // Treatment Form State
  const [reportDoctor, setReportDoctor] = useState('Dr. Duty Emergency Surgeon');
  const [reportTriage, setReportTriage] = useState('Level 2: Emergent (Stabilized)');
  const [reportBp, setReportBp] = useState('120/80 mmHg');
  const [reportHr, setReportHr] = useState('76 bpm');
  const [reportSpo2, setReportSpo2] = useState('98%');
  const [reportTemp, setReportTemp] = useState('98.6 °F');
  const [reportInterventions, setReportInterventions] = useState<string[]>([
    'IV Access & Fluids Infusion',
    'Supplemental Oxygen Therapy',
    '12-Lead ECG Monitoring',
  ]);
  const [reportMedications, setReportMedications] = useState('Paracetamol 1g IV, Normal Saline 500ml IV');
  const [reportDisposition, setReportDisposition] = useState('Stabilized & Discharged with Home Care Instructions');
  const [reportNotes, setReportNotes] = useState('Patient received in Emergency Department, primary assessment conducted, vitals stabilized, and comprehensive post-care advised.');

  // Open treatment dialog with intelligent prefilling
  const openTreatmentModal = (alert: HospitalAlert) => {
    setTreatingAlert(alert);
    setSelectedAlertId(alert.id);
    const docName = localStats?.doctorsOnDuty?.[0]?.name ? `Dr. ${localStats.doctorsOnDuty[0].name}` : 'Dr. Lead Trauma Specialist';
    setReportDoctor(docName);
    if (alert.condition) {
      setReportNotes(`Patient admitted following emergency dispatch with condition: "${alert.condition}". Emergency resuscitation and stabilization completed successfully.`);
    }
  };

  // Confirm treatment and remove alert
  const handleConfirmTreatment = async () => {
    if (!treatingAlert) return;
    setTreatmentSaving(true);
    try {
      const generatedReport: PatientTreatmentReport = {
        reportId: `REP-${Date.now().toString().slice(-6)}`,
        emergencyId: treatingAlert.emergencyId,
        patientName: activeEmergency?.userName || patientProfile?.name || 'Emergency Patient',
        patientAge: patientProfile?.age,
        patientBloodGroup: activeEmergency?.userBloodGroup || patientProfile?.bloodGroup || 'Unknown',
        patientPhone: activeEmergency?.userPhone || patientProfile?.phone || 'N/A',
        admittedHospital: localStats?.name || hosp?.name || 'Hospital ER',
        attendingDoctor: reportDoctor,
        triageLevel: reportTriage,
        vitals: {
          bloodPressure: reportBp,
          heartRate: reportHr,
          spO2: reportSpo2,
          temperature: reportTemp,
        },
        interventions: reportInterventions,
        medicationsAdministered: reportMedications.split(',').map(m => m.trim()).filter(Boolean),
        clinicalSummary: reportNotes,
        patientDisposition: reportDisposition,
        treatedAt: Date.now(),
        dischargeNotes: reportNotes,
        respondingAmbulance: {
          vehicleNo: treatingAlert.ambulanceVehicleNo,
          driverName: ambulanceProfile?.driverName,
        },
      };

      await markPatientTreatedAndDismissAlert(treatingAlert.id, treatingAlert.emergencyId, generatedReport);
      
      setViewingReport(generatedReport);
      setTreatingAlert(null);
      setSelectedAlertId(null);
      setTreatmentSuccess(true);
      setTimeout(() => setTreatmentSuccess(false), 6000);
    } catch (err) {
      console.error("Error finalizing treatment report:", err);
    } finally {
      setTreatmentSaving(false);
    }
  };

  const toggleIntervention = (item: string) => {
    setReportInterventions(prev =>
      prev.includes(item) ? prev.filter(i => i !== item) : [...prev, item]
    );
  };

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
    const hospName = hosp?.name || localStats?.name || '';
    return subscribeToHospitalAlerts(firebaseUser.uid, hospName, setAlerts);
  }, [firebaseUser?.uid, hosp?.name, localStats?.name]);

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
            {/* Treatment Success Notification */}
            <AnimatePresence>
              {treatmentSuccess && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -10 }}
                  className="bg-emerald-600 text-white p-3.5 rounded-2xl mb-3 flex items-center justify-between shadow-lg"
                >
                  <div className="flex items-center gap-2 text-xs font-bold">
                    <CheckCircle2 className="w-4 h-4 text-emerald-100" />
                    Patient treated successfully · Case report archived & alert cleared!
                  </div>
                  <button onClick={() => setTreatmentSuccess(false)} className="text-white/80 hover:text-white">
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Sub-tab Pill Switcher */}
            {(() => {
              const activeAlerts = alerts.filter(a => a.status !== 'treated');
              const treatedAlerts = alerts.filter(a => a.status === 'treated');

              return (
                <>
                  <div className="flex bg-gray-100 p-1 rounded-2xl mb-3">
                    <button
                      onClick={() => setAlertSubTab('incoming')}
                      className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                        alertSubTab === 'incoming'
                          ? 'bg-white text-brand-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <Ambulance className="w-3.5 h-3.5" />
                      Active Incoming ({activeAlerts.length})
                    </button>
                    <button
                      onClick={() => setAlertSubTab('treated')}
                      className={`flex-1 py-2 text-xs font-black rounded-xl transition-all flex items-center justify-center gap-1.5 ${
                        alertSubTab === 'treated'
                          ? 'bg-white text-emerald-700 shadow-sm'
                          : 'text-gray-500 hover:text-gray-700'
                      }`}
                    >
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Treated Patients ({treatedAlerts.length})
                    </button>
                  </div>

                  {/* ACTIVE INCOMING AMBULANCES VIEW */}
                  {alertSubTab === 'incoming' && (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="section-title mb-0">Active ER Emergency Dispatches</p>
                        {activeAlerts.filter(a => a.status === 'en_route').length > 0 && (
                          <span className="badge-red animate-pulse">
                            {activeAlerts.filter(a => a.status === 'en_route').length} en route
                          </span>
                        )}
                      </div>

                      {activeAlerts.length === 0 ? (
                        <div className="card p-8 text-center">
                          <Ambulance className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                          <p className="text-gray-400 text-sm">No incoming ambulances in transit</p>
                          <p className="text-gray-300 text-xs mt-1">New paramedic dispatches will alert here automatically</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {activeAlerts.map(alert => (
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
                                      {alert.status === 'en_route' ? 'En Route' : 'Arrived at ER'}
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
                                <div className="bg-brand-50 rounded-xl p-3 flex items-start gap-2 mb-3">
                                  <Activity className="w-3.5 h-3.5 text-brand-600 mt-0.5 shrink-0" />
                                  <div>
                                    <p className="text-xs font-semibold text-brand-700 mb-0.5">Paramedic Update</p>
                                    <p className="text-sm text-gray-700 italic">"{alert.condition}"</p>
                                  </div>
                                </div>
                              )}

                              {/* Action Button: Mark Patient Treated & Clear Alert */}
                              <div className="pt-2 border-t border-gray-100">
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    openTreatmentModal(alert);
                                  }}
                                  className="btn-primary w-full py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-xl shadow flex items-center justify-center gap-1.5"
                                >
                                  <Stethoscope className="w-4 h-4" />
                                  Mark Patient Treated & Generate Case Report
                                </button>
                              </div>

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

                  {/* TREATED PATIENTS & DISCHARGED HISTORY VIEW */}
                  {alertSubTab === 'treated' && (
                    <>
                      <div className="flex items-center justify-between mb-2">
                        <p className="section-title mb-0">Treated Patients & Discharge Reports</p>
                        <span className="badge-green font-bold text-[10px]">
                          {treatedAlerts.length} Archived
                        </span>
                      </div>

                      {treatedAlerts.length === 0 ? (
                        <div className="card p-8 text-center">
                          <CheckCircle2 className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                          <p className="text-gray-400 text-sm">No treated patients yet</p>
                          <p className="text-gray-300 text-xs mt-1">Completed ER cases will be safely archived here with clinical reports</p>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {treatedAlerts.map(alert => {
                            const report = alert.treatmentReport;
                            return (
                              <motion.div
                                key={alert.id}
                                initial={{ opacity: 0, y: 5 }}
                                animate={{ opacity: 1, y: 0 }}
                                className="card p-4 border border-emerald-100 bg-white shadow-sm space-y-3"
                              >
                                <div className="flex items-start justify-between">
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-extrabold text-sm text-gray-900">
                                        {report?.patientName || 'Treated Patient'}
                                      </span>
                                      <span className="badge-green font-bold text-[10px] flex items-center gap-1">
                                        <CheckCircle2 className="w-3 h-3" /> Treated & Resolved
                                      </span>
                                    </div>
                                    <p className="text-xs text-gray-500 mt-0.5">
                                      Transport: {alert.ambulanceVehicleNo} · Doctor: {report?.attendingDoctor || 'ER Physician'}
                                    </p>
                                  </div>
                                  <span className="text-[10px] text-gray-400 font-semibold">
                                    {alert.treatedAt ? timeAgo(alert.treatedAt) : timeAgo(alert.timestamp)}
                                  </span>
                                </div>

                                {report && (
                                  <div className="bg-emerald-50/50 rounded-xl p-3 border border-emerald-100/60 text-xs space-y-1.5">
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-500 font-medium">Outcome:</span>
                                      <span className="font-bold text-emerald-800">{report.patientDisposition}</span>
                                    </div>
                                    <div className="flex items-center justify-between">
                                      <span className="text-gray-500 font-medium">Vitals:</span>
                                      <span className="font-bold text-gray-700">BP: {report.vitals.bloodPressure} · HR: {report.vitals.heartRate} · SpO₂: {report.vitals.spO2}</span>
                                    </div>
                                    <div className="pt-1 text-[11px] text-gray-600 italic">
                                      "{report.clinicalSummary}"
                                    </div>
                                  </div>
                                )}

                                <div className="flex gap-2">
                                  <button
                                    onClick={() => {
                                      if (report) {
                                        setViewingReport(report);
                                      } else {
                                        // Fallback report if legacy
                                        setViewingReport({
                                          reportId: `REP-${alert.id.slice(-6)}`,
                                          emergencyId: alert.emergencyId,
                                          patientName: 'Emergency Patient',
                                          patientBloodGroup: 'Unknown',
                                          patientPhone: 'N/A',
                                          admittedHospital: localStats?.name || 'Hospital ER',
                                          attendingDoctor: 'Dr. Lead Emergency Surgeon',
                                          triageLevel: 'Level 2: Emergent',
                                          vitals: { bloodPressure: '120/80 mmHg', heartRate: '76 bpm', spO2: '98%', temperature: '98.6 °F' },
                                          interventions: ['Emergency Triage', 'IV Fluids', 'Vitals Stabilization'],
                                          medicationsAdministered: ['Standard ER Protocol'],
                                          clinicalSummary: alert.condition || 'Emergency treatment completed.',
                                          patientDisposition: 'Stabilized & Discharged',
                                          treatedAt: alert.treatedAt || alert.timestamp,
                                          dischargeNotes: 'Patient treated and discharged in stable condition.',
                                          respondingAmbulance: { vehicleNo: alert.ambulanceVehicleNo }
                                        });
                                      }
                                    }}
                                    className="btn-secondary w-full py-2 text-xs border-emerald-200 text-emerald-800 hover:bg-emerald-50 font-bold rounded-xl flex items-center justify-center gap-1.5"
                                  >
                                    <FileText className="w-4 h-4 text-emerald-600" />
                                    View & Print Detailed Medical Case Report
                                  </button>
                                </div>
                              </motion.div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  )}
                </>
              );
            })()}
          </>
        )}

        {/* ── DETAILS TAB ────────────────────── */}
        {tab === 'details' && (
          <div className="card overflow-hidden space-y-4">
            <div className="bg-gradient-to-r from-purple-700 via-brand-600 to-brand-700 px-5 py-6 text-white shadow-sm">
              <Building2 className="w-10 h-10 text-white/80 mb-2" />
              <h2 className="text-white font-bold text-xl">{localStats.name}</h2>
              <p className="text-purple-100 text-sm mt-1">{localStats.address}</p>
            </div>

            {/* Live Campus Map */}
            {localStats.location && (
              <div className="p-4 pt-0">
                <p className="text-xs font-bold text-gray-500 mb-2 uppercase tracking-wider">
                  Campus Coordinates & Location
                </p>
                <MapView
                  center={localStats.location}
                  zoom={14}
                  height="220px"
                  markers={[
                    {
                      lat: localStats.location.lat,
                      lng: localStats.location.lng,
                      label: `${localStats.name} (Thandalam Campus)`,
                      color: 'purple',
                      pulse: true,
                      iconText: '🏥',
                      category: 'Tertiary Care Teaching Hospital',
                      details: localStats.address,
                    }
                  ]}
                />
              </div>
            )}

            <div className="p-5 pt-0 space-y-4">
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
                    {localStats.location?.lat?.toFixed(5)}° N, {localStats.location?.lng?.toFixed(5)}° E
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

      {/* ── MODAL 1: TREATMENT & DISCHARGE FORM MODAL ── */}
      <AnimatePresence>
        {treatingAlert && (
          <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto">
            <motion.div
              initial={{ y: '100%', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '100%', opacity: 0 }}
              className="bg-white w-full max-w-lg rounded-t-3xl sm:rounded-3xl p-5 sm:p-6 space-y-4 max-h-[90vh] overflow-y-auto shadow-2xl"
            >
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center">
                    <Stethoscope className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-base text-gray-900 leading-tight">Patient Treatment & Case Form</h3>
                    <p className="text-xs text-gray-400">Complete treatment details to resolve and clear alert</p>
                  </div>
                </div>
                <button
                  onClick={() => setTreatingAlert(null)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Patient Brief Banner */}
              <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-3.5 flex items-center justify-between">
                <div>
                  <p className="font-black text-sm text-emerald-950">
                    {activeEmergency?.userName || patientProfile?.name || 'Emergency Patient'}
                  </p>
                  <p className="text-xs text-emerald-800">
                    Blood: <span className="font-bold">{activeEmergency?.userBloodGroup || patientProfile?.bloodGroup || 'Unknown'}</span> · Transport: {treatingAlert.ambulanceVehicleNo}
                  </p>
                </div>
                <span className="badge-green font-bold text-[10px]">ER Admitted</span>
              </div>

              {/* Treatment Form Inputs */}
              <div className="space-y-3.5 text-xs">
                {/* Attending Doctor */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Attending ER Physician / Surgeon</label>
                  <input
                    type="text"
                    value={reportDoctor}
                    onChange={e => setReportDoctor(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:bg-white focus:border-brand-500 outline-none"
                    placeholder="e.g. Dr. A. Sharma (Chief Trauma Surgeon)"
                  />
                </div>

                {/* Triage Priority */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Triage Severity Level</label>
                  <select
                    value={reportTriage}
                    onChange={e => setReportTriage(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:bg-white focus:border-brand-500 outline-none"
                  >
                    <option value="Level 1: Immediate (Resuscitation)">Level 1: Immediate (Resuscitation - Life Threatening)</option>
                    <option value="Level 2: Emergent (Stabilized)">Level 2: Emergent (High Risk / Stabilized)</option>
                    <option value="Level 3: Urgent">Level 3: Urgent (Moderate Risk)</option>
                    <option value="Level 4: Less Urgent">Level 4: Less Urgent (Stable / Ambulatory)</option>
                    <option value="Level 5: Non-Urgent">Level 5: Non-Urgent (Routine Care)</option>
                  </select>
                </div>

                {/* Vitals Grid */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1.5">Recorded Vitals on Treatment</label>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                    <div className="bg-gray-50 p-2 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold block">Blood Pressure</span>
                      <input
                        type="text"
                        value={reportBp}
                        onChange={e => setReportBp(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 mt-1"
                      />
                    </div>
                    <div className="bg-gray-50 p-2 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold block">Heart Rate</span>
                      <input
                        type="text"
                        value={reportHr}
                        onChange={e => setReportHr(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 mt-1"
                      />
                    </div>
                    <div className="bg-gray-50 p-2 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold block">SpO₂ Oxygen</span>
                      <input
                        type="text"
                        value={reportSpo2}
                        onChange={e => setReportSpo2(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 mt-1"
                      />
                    </div>
                    <div className="bg-gray-50 p-2 rounded-xl border border-gray-100">
                      <span className="text-[10px] text-gray-400 font-bold block">Temperature</span>
                      <input
                        type="text"
                        value={reportTemp}
                        onChange={e => setReportTemp(e.target.value)}
                        className="w-full bg-white border border-gray-200 rounded-lg px-2 py-1 text-xs font-bold text-gray-800 mt-1"
                      />
                    </div>
                  </div>
                </div>

                {/* Interventions Administered */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Clinical Interventions Administered</label>
                  <div className="flex flex-wrap gap-1.5 mt-1">
                    {COMMON_INTERVENTIONS.map(item => {
                      const isSelected = reportInterventions.includes(item);
                      return (
                        <button
                          key={item}
                          type="button"
                          onClick={() => toggleIntervention(item)}
                          className={`text-[11px] px-2.5 py-1 rounded-lg font-bold border transition-all ${
                            isSelected
                              ? 'bg-emerald-600 border-emerald-600 text-white shadow-sm'
                              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
                          }`}
                        >
                          {isSelected ? '✓ ' : '+ '}{item}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Medications Given */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Medications Administered</label>
                  <input
                    type="text"
                    value={reportMedications}
                    onChange={e => setReportMedications(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:bg-white focus:border-brand-500 outline-none"
                    placeholder="e.g. Paracetamol 1g IV, Normal Saline 500ml"
                  />
                </div>

                {/* Patient Disposition */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Final Patient Disposition</label>
                  <select
                    value={reportDisposition}
                    onChange={e => setReportDisposition(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-xs font-semibold text-gray-800 focus:bg-white focus:border-brand-500 outline-none"
                  >
                    <option value="Stabilized & Discharged with Home Care Instructions">Stabilized & Discharged with Home Care Instructions</option>
                    <option value="Admitted to Intensive Care Unit (ICU)">Admitted to Intensive Care Unit (ICU)</option>
                    <option value="Admitted to General Inpatient Ward">Admitted to General Inpatient Ward</option>
                    <option value="Transferred to Specialized Trauma / Super-Speciality Department">Transferred to Specialized Trauma / Super-Speciality Department</option>
                  </select>
                </div>

                {/* Clinical Notes */}
                <div>
                  <label className="font-bold text-gray-700 block mb-1">Physician Clinical & Discharge Summary</label>
                  <textarea
                    rows={3}
                    value={reportNotes}
                    onChange={e => setReportNotes(e.target.value)}
                    className="w-full bg-gray-50 border border-gray-200 rounded-xl p-2.5 text-xs text-gray-800 focus:bg-white focus:border-brand-500 outline-none resize-none"
                    placeholder="Provide clinical summary, examination findings, and follow-up advice..."
                  />
                </div>
              </div>

              {/* Submit Buttons */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => setTreatingAlert(null)}
                  disabled={treatmentSaving}
                  className="btn-secondary flex-1 py-3 text-xs font-bold rounded-2xl"
                >
                  Cancel
                </button>
                <button
                  onClick={handleConfirmTreatment}
                  disabled={treatmentSaving}
                  className="btn-primary flex-2 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-2xl shadow-lg flex items-center justify-center gap-2"
                >
                  {treatmentSaving ? (
                    <>
                      <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      Saving & Generating Report…
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4" />
                      Confirm Treatment & Dismiss Alert
                    </>
                  )}
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── MODAL 2: DETAILED MEDICAL CASE & DISCHARGE REPORT MODAL ── */}
      <AnimatePresence>
        {viewingReport && (
          <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-3 sm:p-4 overflow-y-auto">
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="bg-white w-full max-w-2xl rounded-3xl p-6 space-y-5 max-h-[92vh] overflow-y-auto shadow-2xl border border-gray-200"
            >
              {/* Header & Hospital Letterhead */}
              <div className="flex items-start justify-between pb-4 border-b-2 border-emerald-600">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 bg-emerald-600 text-white rounded-2xl flex items-center justify-center font-black text-2xl shadow-sm">
                    🏥
                  </div>
                  <div>
                    <h2 className="font-black text-lg text-gray-900 leading-tight">
                      {viewingReport.admittedHospital || localStats?.name || 'Saveetha Medical College and Hospital'}
                    </h2>
                    <p className="text-xs text-gray-500 font-medium">
                      Emergency & Trauma Care Department · Comprehensive Clinical Summary
                    </p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="badge bg-emerald-100 text-emerald-800 text-[10px] font-black">
                        REPORT ID: {viewingReport.reportId}
                      </span>
                      <span className="text-[10px] text-gray-400 font-semibold">
                        {new Date(viewingReport.treatedAt).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' })}
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setViewingReport(null)}
                  className="w-8 h-8 rounded-full bg-gray-100 hover:bg-gray-200 text-gray-600 flex items-center justify-center shrink-0"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Patient Demographics Box */}
              <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
                <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider">
                  Patient Demographics & Transport Log
                </p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <p className="text-gray-400 font-medium">Patient Name</p>
                    <p className="font-extrabold text-gray-900">{viewingReport.patientName}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Blood Group</p>
                    <span className="badge-red text-[10px] font-black px-2 py-0.5 rounded">
                      {viewingReport.patientBloodGroup}
                    </span>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Phone</p>
                    <p className="font-bold text-gray-800">{viewingReport.patientPhone}</p>
                  </div>
                  <div>
                    <p className="text-gray-400 font-medium">Transport Ambulance</p>
                    <p className="font-bold text-brand-700">{viewingReport.respondingAmbulance?.vehicleNo || 'Fleet Ambulance'}</p>
                  </div>
                </div>
              </div>

              {/* Vitals & Triage */}
              <div className="bg-emerald-50/50 rounded-2xl p-4 border border-emerald-100/70 space-y-2.5">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-black text-emerald-800 uppercase tracking-wider">
                    Emergency Vitals & Clinical Assessment
                  </p>
                  <span className="badge bg-emerald-600 text-white font-extrabold text-[10px]">
                    {viewingReport.triageLevel}
                  </span>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center text-xs">
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100/60 shadow-2xs">
                    <p className="text-[10px] text-gray-400 font-semibold">Blood Pressure</p>
                    <p className="font-black text-gray-900 mt-0.5">{viewingReport.vitals.bloodPressure}</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100/60 shadow-2xs">
                    <p className="text-[10px] text-gray-400 font-semibold">Heart Rate</p>
                    <p className="font-black text-gray-900 mt-0.5">{viewingReport.vitals.heartRate}</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100/60 shadow-2xs">
                    <p className="text-[10px] text-gray-400 font-semibold">SpO₂ Oxygen</p>
                    <p className="font-black text-emerald-600 mt-0.5">{viewingReport.vitals.spO2}</p>
                  </div>
                  <div className="bg-white p-2.5 rounded-xl border border-emerald-100/60 shadow-2xs">
                    <p className="text-[10px] text-gray-400 font-semibold">Temperature</p>
                    <p className="font-black text-gray-900 mt-0.5">{viewingReport.vitals.temperature}</p>
                  </div>
                </div>
              </div>

              {/* Interventions & Medications */}
              <div className="space-y-3 text-xs">
                {viewingReport.interventions?.length > 0 && (
                  <div>
                    <p className="font-black text-gray-500 uppercase tracking-wider text-[10px] mb-1.5">
                      Interventions Administered:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {viewingReport.interventions.map(i => (
                        <span key={i} className="badge bg-emerald-100 text-emerald-900 font-bold px-2.5 py-1 rounded-lg">
                          ✓ {i}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {viewingReport.medicationsAdministered?.length > 0 && (
                  <div>
                    <p className="font-black text-gray-500 uppercase tracking-wider text-[10px] mb-1.5">
                      Medications Given:
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {viewingReport.medicationsAdministered.map(m => (
                        <span key={m} className="badge bg-blue-50 text-blue-800 font-bold px-2.5 py-1 rounded-lg border border-blue-100">
                          💊 {m}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Final Disposition & Notes */}
                <div className="bg-gray-50 rounded-2xl p-4 border border-gray-100 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-gray-600">Final Patient Disposition:</span>
                    <span className="font-extrabold text-emerald-800">{viewingReport.patientDisposition}</span>
                  </div>
                  <div className="pt-2 border-t border-gray-200/60">
                    <p className="text-[10px] font-black text-gray-400 uppercase tracking-wider mb-1">
                      Clinical Notes & Follow-up Advice:
                    </p>
                    <p className="text-gray-800 leading-relaxed font-medium">
                      {viewingReport.clinicalSummary}
                    </p>
                  </div>
                </div>

                {/* Doctor Sign-off */}
                <div className="pt-3 border-t border-gray-200 flex items-center justify-between">
                  <div>
                    <p className="text-[10px] text-gray-400 font-bold uppercase">Attending Physician</p>
                    <p className="text-xs font-black text-gray-900">{viewingReport.attendingDoctor}</p>
                    <p className="text-[10px] text-emerald-700 font-semibold">Verified Electronic Medical Record (EMR)</p>
                  </div>
                  <div className="w-16 h-16 border-2 border-dashed border-emerald-400 rounded-2xl flex items-center justify-center text-center p-1 text-emerald-800">
                    <div className="text-[9px] font-black leading-tight">
                      SEAL<br />VERIFIED
                    </div>
                  </div>
                </div>
              </div>

              {/* Action Buttons */}
              <div className="flex gap-2 pt-2 border-t border-gray-100">
                <button
                  onClick={() => window.print()}
                  className="btn-secondary flex-1 py-3 text-xs font-bold rounded-2xl flex items-center justify-center gap-1.5 bg-gray-100 hover:bg-gray-200 text-gray-800"
                >
                  <Printer className="w-4 h-4 text-gray-600" />
                  Print / Save Medical Report
                </button>
                <button
                  onClick={() => setViewingReport(null)}
                  className="btn-primary flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black rounded-2xl shadow-lg flex items-center justify-center gap-1.5"
                >
                  <CheckCircle2 className="w-4 h-4" />
                  Close Report
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
