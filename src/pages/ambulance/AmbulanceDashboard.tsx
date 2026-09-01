// ─────────────────────────────────────────────
//  Ambulance Dashboard
//  AUTO-TRIGGER: GPS proximity < 200m → auto hospital recommendation
//  No manual "Find Hospital" button
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ambulance, Bell, MapPin, LogOut, Phone,
  Activity, Navigation, Building2, Volume2,
  Clock, CheckCircle, Mic, MicOff,
  Star, Bed, Droplets, Wind, AlertTriangle,
  Target, Zap,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useGPS } from '../../hooks/useGPS';
import { useVoice } from '../../hooks/useVoice';
import { useSirenAlarm } from '../../components/SirenAlarm';
import MapView from '../../components/MapView';
import type { MapMarker } from '../../components/MapView';
import {
  subscribeToEmergencies, updateEmergency,
  fetchHospitals, createHospitalAlert, updateAmbulanceLocation,
} from '../../services/emergencyService';
import { recommendHospitals, haversineKm } from '../../services/aiService';
import type {
  AmbulanceProfile, Emergency, HospitalProfile,
  HospitalRecommendation,
} from '../../types';

// ── Proximity threshold: 200 metres ──────────
const ARRIVAL_THRESHOLD_KM = 0.2;

export default function AmbulanceDashboard() {
  const { profile, signOut, firebaseUser } = useAuthStore();
  const amb = profile as AmbulanceProfile;

  const [tab,             setTab]             = useState<'alerts' | 'map' | 'hospital'>('alerts');
  const [emergencies,     setEmergencies]     = useState<Emergency[]>([]);
  const [activeEmerg,     setActiveEmerg]     = useState<Emergency | null>(null);
  const [incomingAlert,   setIncomingAlert]   = useState<Emergency | null>(null);
  const [hospitals,       setHospitals]       = useState<HospitalProfile[]>([]);
  const [recommendations, setRecommendations] = useState<HospitalRecommendation[]>([]);
  const [voiceNote,       setVoiceNote]       = useState('');
  const [bestHosp,        setBestHosp]        = useState<HospitalRecommendation | null>(null);
  const [sending,         setSending]         = useState(false);
  const [sentAlert,       setSentAlert]       = useState(false);
  const [arrivedBanner,   setArrivedBanner]   = useState(false);
  const [distanceKm,      setDistanceKm]      = useState<number | null>(null);

  const prevCountRef  = useRef(0);
  const arrivedRef    = useRef(false);   // prevent double-trigger

  const gps    = useGPS(true);
  const siren  = useSirenAlarm();
  const voice  = useVoice(t => setVoiceNote(t));

  const unassignedAlerts = emergencies.filter(e => ['confirmed', 'triggered'].includes(e.status));

  // Push ambulance GPS to Firestore every 10 s
  useEffect(() => {
    if (!firebaseUser?.uid || !gps.location) return;
    updateAmbulanceLocation(firebaseUser.uid, gps.location.lat, gps.location.lng);
  }, [firebaseUser?.uid, gps.location]);

  // Real-time emergency feed + siren + popup trigger
  useEffect(() => {
    return subscribeToEmergencies(list => {
      setEmergencies(list);
      
      const myActiveMission = list.find(
        e => e.ambulanceId === firebaseUser?.uid && ['dispatched', 'confirmed', 'en_route'].includes(e.status)
      );

      if (activeEmerg || myActiveMission) {
        setIncomingAlert(null);
        siren.stop();
      } else {
        const unassigned = list.find(e => ['confirmed', 'triggered'].includes(e.status) && !e.ambulanceId);
        if (unassigned) {
          setIncomingAlert(unassigned);
          siren.play();
        } else {
          setIncomingAlert(null);
          siren.stop();
        }
      }
      
      prevCountRef.current = list.length;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmerg, firebaseUser?.uid]);

  // Fetch hospitals once
  useEffect(() => {
    fetchHospitals().then(h => setHospitals(h as HospitalProfile[]));
  }, []);

  // Sync active emergency with latest real-time updates from emergencies feed
  useEffect(() => {
    if (!activeEmerg) return;
    const latest = emergencies.find(e => e.id === activeEmerg.id);
    if (latest) {
      if (
        latest.location.lat !== activeEmerg.location.lat ||
        latest.location.lng !== activeEmerg.location.lng ||
        latest.status !== activeEmerg.status
      ) {
        setActiveEmerg(latest);
      }
    } else {
      // Reset back to standby/available if the emergency is no longer active (aborted/resolved/arrived)
      setActiveEmerg(null);
    }
  }, [emergencies, activeEmerg]);

  // Auto-engage active mission on mount or reload if already dispatched to this ambulance
  useEffect(() => {
    if (!firebaseUser?.uid || activeEmerg) return;
    const activeMission = emergencies.find(
      e => e.ambulanceId === firebaseUser.uid && ['dispatched', 'confirmed'].includes(e.status)
    );
    if (activeMission) {
      setActiveEmerg(activeMission);
      setTab('map');
    }
  }, [emergencies, firebaseUser?.uid, activeEmerg]);

  // ── AUTO-ARRIVAL DETECTION ─────────────────────────────────
  // When ambulance GPS is within 200 m of patient → auto-trigger
  useEffect(() => {
    if (!activeEmerg || !gps.location || arrivedRef.current) return;
    const dist = haversineKm(
      gps.location.lat, gps.location.lng,
      activeEmerg.location.lat, activeEmerg.location.lng,
    );
    setDistanceKm(dist);

    if (dist < ARRIVAL_THRESHOLD_KM) {
      arrivedRef.current = true;
      setArrivedBanner(true);

      // Auto-load hospital recommendations
      const recs = recommendHospitals(
        gps.location.lat, gps.location.lng,
        hospitals,
        'trauma',
      );
      setRecommendations(recs);
      if (recs.length > 0) setBestHosp(recs[0]); // auto-select top pick
      setTab('hospital');

      // Dismiss banner after 5 s
      setTimeout(() => setArrivedBanner(false), 5000);
    }
  }, [gps.location, activeEmerg, hospitals]);

  const acceptEmergency = useCallback(async (emergency: Emergency) => {
    siren.stop();
    setIncomingAlert(null);
    arrivedRef.current = false;
    setDistanceKm(null);
    setSentAlert(false);
    await updateEmergency(emergency.id, {
      status:       'dispatched',
      ambulanceId:  firebaseUser?.uid,
    });
    if (firebaseUser?.uid && gps.location) {
      await updateAmbulanceLocation(firebaseUser.uid, gps.location.lat, gps.location.lng);
    }
    setActiveEmerg(emergency);

    // Suggest best hospitals immediately on acceptance
    const ambLat = gps.location?.lat ?? emergency.location.lat;
    const ambLng = gps.location?.lng ?? emergency.location.lng;
    const recs = recommendHospitals(
      ambLat,
      ambLng,
      hospitals,
      emergency.userBloodGroup || '',
    );
    setRecommendations(recs);
    if (recs.length > 0) setBestHosp(recs[0]);

    setTab('hospital');
  }, [firebaseUser?.uid, siren, gps.location, hospitals]);

  const declineEmergency = useCallback(async (emergency: Emergency) => {
    siren.stop();
    await updateEmergency(emergency.id, { status: 'aborted' });
  }, [siren]);

  const sendHospitalAlert = useCallback(async () => {
    if (!bestHosp || !activeEmerg || !firebaseUser) return;
    setSending(true);
    try {
      await createHospitalAlert({
        hospitalId:         bestHosp.hospital.uid,
        ambulanceId:        firebaseUser.uid,
        ambulanceVehicleNo: amb?.vehicleNo || '',
        emergencyId:        activeEmerg.id,
        patientCount:       1,
        condition:          voiceNote || 'Trauma patient en route',
        etaMinutes:         bestHosp.etaMinutes,
        status:             'en_route',
        timestamp:          Date.now(),
      });
      await updateEmergency(activeEmerg.id, {
        hospitalId: bestHosp.hospital.uid,
        status:     'arrived',
      });
      setSentAlert(true);
    } finally {
      setSending(false);
    }
  }, [bestHosp, activeEmerg, firebaseUser, amb?.vehicleNo, voiceNote]);

  const mapMarkers: MapMarker[] = [];
  if (gps.location)           mapMarkers.push({ lat: gps.location.lat, lng: gps.location.lng, label: 'You (Ambulance)', color: 'blue', pulse: true });
  if (activeEmerg?.location)  mapMarkers.push({ lat: activeEmerg.location.lat, lng: activeEmerg.location.lng, label: `Patient: ${activeEmerg.userName}`, color: 'red', pulse: true });
  if (bestHosp)               mapMarkers.push({ lat: bestHosp.hospital.location.lat, lng: bestHosp.hospital.location.lng, label: bestHosp.hospital.name, color: 'green' });

  const timeAgo = (ts: number) => {
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.floor(s / 60)}m ago`;
    return `${Math.floor(s / 3600)}h ago`;
  };

  return (
    <div className="page">
      {/* Top Bar */}
      <div className="top-bar">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-brand-600 rounded-full flex items-center justify-center">
            <Ambulance className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="font-bold text-gray-900 text-sm">{amb?.vehicleNo || 'Ambulance'}</h1>
            <p className="text-xs text-gray-400">{amb?.vehicleType} · {amb?.driverName}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`badge ${unassignedAlerts.length > 0 ? 'badge-red animate-pulse' : 'badge-green'}`}>
            {unassignedAlerts.length > 0 ? `${unassignedAlerts.length} Alert` : 'Standby'}
          </span>
          <button onClick={signOut} className="btn-ghost p-2"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Arrival Auto-Trigger Banner */}
      <AnimatePresence>
        {arrivedBanner && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-green-600 text-white">
            <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
              <Target className="w-5 h-5 animate-ping-slow" />
              <div>
                <p className="font-bold text-sm">🎯 Destination Reached!</p>
                <p className="text-green-100 text-xs">AI is loading best hospitals automatically…</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Mission Banner */}
      <AnimatePresence>
        {activeEmerg && !arrivedBanner && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-brand-600 text-white">
            <div className="max-w-md mx-auto px-4 py-2.5 flex items-center gap-3">
              <Navigation className="w-4 h-4 animate-pulse" />
              <div className="flex-1">
                <p className="text-xs font-semibold">En Route → {activeEmerg.userName}</p>
                {distanceKm !== null && (
                  <p className="text-red-100 text-xs">
                    {distanceKm < 1
                      ? `${Math.round(distanceKm * 1000)} m away`
                      : `${distanceKm.toFixed(1)} km away`}
                    {distanceKm < 0.5 && ' · Almost there!'}
                  </p>
                )}
              </div>
              <Zap className="w-4 h-4 text-yellow-300" />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="page-content">

        {/* ── ALERTS TAB ─────────────────────── */}
        {tab === 'alerts' && (
          <>
            <div className="card p-5">
              <p className="section-title">Vehicle Details</p>
              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="stat-tile">
                  <span className="stat-value text-lg">{amb?.vehicleNo || '—'}</span>
                  <span className="stat-label">Vehicle No.</span>
                </div>
                <div className="stat-tile">
                  <span className="stat-value text-lg">{amb?.vehicleType || '—'}</span>
                  <span className="stat-label">Type</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                <span className="text-sm text-gray-600">{amb?.phone}</span>
                <span className="ml-auto badge-green">Available</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="section-title mb-0">Live Alerts</p>
                {unassignedAlerts.length > 0 && (
                  <span className="badge-red animate-pulse">{unassignedAlerts.length} incoming</span>
                )}
              </div>

              {unassignedAlerts.length === 0 ? (
                <div className="card p-8 text-center">
                  <Bell className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">No active alerts</p>
                  <p className="text-gray-300 text-xs mt-1">Monitoring for emergencies…</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {unassignedAlerts.map(e => (
                    <motion.div key={e.id} initial={{ opacity: 0, x: -10 }} animate={{ opacity: 1, x: 0 }} className="alert-card">
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-2 mb-1">
                            <span className="font-bold text-sm text-gray-900">{e.userName}</span>
                            <span className={e.classification === 'HIGH' ? 'badge-red' : 'badge-gray'}>{e.classification}</span>
                          </div>
                          <p className="text-xs text-gray-500 flex items-center gap-1">
                            <Clock className="w-3 h-3" /> {timeAgo(e.timestamp)}
                          </p>
                          <p className="text-xs text-gray-400 mt-0.5">{e.userBloodGroup} · {e.userPhone}</p>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-black text-brand-700">{e.confidenceScore}%</div>
                          <p className="text-xs text-gray-400">AI score</p>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mb-3 text-xs text-gray-500 bg-gray-50 rounded-lg px-3 py-2">
                        <MapPin className="w-3 h-3 text-brand-600" />
                        {e.location.lat.toFixed(5)}, {e.location.lng.toFixed(5)}
                        <span className="ml-auto flex items-center gap-1">
                          <Activity className="w-3 h-3" />
                          {e.sensorData?.maxShakeMagnitude?.toFixed(1)} m/s²
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <button onClick={() => acceptEmergency(e)} className="btn-primary flex-1 py-2.5 text-sm">
                          Accept Mission
                        </button>
                        <button onClick={() => declineEmergency(e)} className="btn-secondary flex-1 py-2.5 text-sm">
                          Decline
                        </button>
                      </div>
                    </motion.div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {/* ── MAP TAB ────────────────────────── */}
        {tab === 'map' && (
          <div className="card p-4">
            <p className="section-title">Live Tracking</p>
            {activeEmerg ? (
              <>
                <div className="flex items-center gap-3 mb-4 p-3 bg-brand-50 rounded-xl">
                  <AlertTriangle className="w-5 h-5 text-brand-600" />
                  <div className="flex-1">
                    <p className="font-semibold text-sm text-gray-900">{activeEmerg.userName}</p>
                    <p className="text-xs text-gray-500">{activeEmerg.userBloodGroup} · {activeEmerg.userPhone}</p>
                  </div>
                  {distanceKm !== null && (
                    <div className="text-right">
                      <p className="text-sm font-bold text-brand-700">
                        {distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`}
                      </p>
                      <p className="text-xs text-gray-400">away</p>
                    </div>
                  )}
                </div>
                <MapView center={gps.location || activeEmerg.location} showRoute={true} markers={mapMarkers} height="320px" zoom={14} />
                <div className="mt-3 bg-green-50 rounded-xl p-3 flex items-center gap-2">
                  <Target className="w-4 h-4 text-green-600" />
                  <p className="text-xs text-green-700 font-medium">
                    Hospital finder will auto-activate when you arrive (within 200m)
                  </p>
                </div>
              </>
            ) : (
              <div className="text-center py-10">
                <Navigation className="w-10 h-10 text-gray-200 mx-auto mb-2" />
                <p className="text-gray-400 text-sm">Accept an alert to start tracking</p>
              </div>
            )}
          </div>
        )}

        {/* ── HOSPITAL TAB ───────────────────── */}
        {tab === 'hospital' && (
          <>
            {sentAlert ? (
              <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-8 text-center">
                <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-3" />
                <h3 className="font-bold text-gray-900 text-lg">Hospital Notified!</h3>
                <p className="text-gray-500 text-sm mt-2">{bestHosp?.hospital.name} has been alerted.</p>
                <p className="text-brand-600 font-semibold mt-1">ETA: {bestHosp?.etaMinutes} minutes</p>
                {voiceNote && (
                  <div className="mt-3 bg-gray-50 rounded-xl p-3 text-left">
                    <p className="text-xs text-gray-400 mb-1">Message sent to hospital:</p>
                    <p className="text-sm text-gray-700 italic">"{voiceNote}"</p>
                  </div>
                )}
                <button onClick={() => { setSentAlert(false); setTab('map'); }} className="btn-secondary mt-4">
                  Back to Map
                </button>
              </motion.div>
            ) : (
              <>
                {/* Arrival confirmed header */}
                <div className="card p-4 bg-green-50 border-green-200">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
                      <Target className="w-5 h-5 text-green-600" />
                    </div>
                    <div>
                      <p className="font-bold text-green-800 text-sm">Arrived at Destination</p>
                      <p className="text-green-600 text-xs">AI has selected the best hospital automatically</p>
                    </div>
                  </div>
                </div>

                {/* Voice Update */}
                <div className="card p-4">
                  <p className="section-title">Voice Update for Hospital</p>
                  <p className="text-xs text-gray-400 mb-3">Speak patient details — transcribed and sent automatically</p>
                  <div className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    voice.isListening ? 'border-brand-400 bg-brand-50' : 'border-gray-100 bg-gray-50'
                  }`}>
                    <button
                      onClick={voice.isListening ? voice.stopListening : voice.startListening}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all ${
                        voice.isListening ? 'bg-brand-600 text-white animate-pulse shadow-brand' : 'bg-white text-gray-400 border border-gray-200'
                      }`}
                    >
                      {voice.isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                    </button>
                    <div className="flex-1">
                      <p className="text-sm font-medium text-gray-700">
                        {voice.isListening ? '🔴 Recording…' : 'Tap to record message'}
                      </p>
                      {voiceNote
                        ? <p className="text-xs text-gray-600 mt-1 italic">"{voiceNote}"</p>
                        : <p className="text-xs text-gray-400">e.g. "1 trauma patient, unconscious, O+ blood"</p>
                      }
                    </div>
                    {voiceNote && <Volume2 className="w-4 h-4 text-brand-600 shrink-0" />}
                  </div>
                </div>

                {/* AI Recommended Hospitals */}
                <div>
                  <div className="flex items-center gap-2 mb-3">
                    <p className="section-title mb-0">AI Hospital Recommendations</p>
                    <span className="badge-blue text-xs ml-auto">Auto-selected</span>
                  </div>

                  {recommendations.length === 0 ? (
                    <div className="card p-6 text-center">
                      <div className="flex justify-center gap-2 mb-3">
                        {[0,1,2].map(i => (
                          <motion.div key={i} className="w-3 h-3 bg-brand-600 rounded-full"
                            animate={{ scale: [0,1,0] }}
                            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }} />
                        ))}
                      </div>
                      <p className="text-gray-400 text-sm">Loading hospital recommendations…</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recommendations.map((rec, idx) => (
                        <motion.div
                          key={rec.hospital.uid}
                          initial={{ opacity: 0, y: 10 }}
                          animate={{ opacity: 1, y: 0 }}
                          transition={{ delay: idx * 0.08 }}
                          onClick={() => setBestHosp(rec)}
                          className={`rounded-2xl border-2 p-4 cursor-pointer hover:border-brand-300 transition-colors ${
                            bestHosp?.hospital.uid === rec.hospital.uid
                              ? 'border-brand-600 bg-brand-50 shadow-brand'
                              : 'border-gray-100 bg-white'
                          }`}
                        >
                          <div className="flex items-start justify-between">
                            <div className="flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                {idx === 0 && <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />}
                                {bestHosp?.hospital.uid === rec.hospital.uid && (
                                  <span className="badge-red text-xs">AI Pick</span>
                                )}
                                <span className="font-bold text-gray-900 text-sm">{rec.hospital.name}</span>
                              </div>
                              <p className="text-xs text-gray-500 mb-2">{rec.hospital.address}</p>
                              <div className="flex flex-wrap gap-1">
                                {rec.reasons.slice(0, 2).map((r, i) => (
                                  <span key={i} className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full">{r}</span>
                                ))}
                              </div>
                            </div>
                            <div className="text-right ml-3 shrink-0">
                              <div className="text-2xl font-black text-brand-700">{rec.score}</div>
                              <p className="text-xs text-gray-400">AI score</p>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-3 gap-2">
                            <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                              <Bed className="w-3.5 h-3.5 text-brand-500 mx-auto mb-0.5" />
                              <p className="text-xs font-bold">{rec.hospital.beds?.emergency?.available ?? '—'}</p>
                              <p className="text-xs text-gray-400">beds</p>
                            </div>
                            <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                              <Droplets className="w-3.5 h-3.5 text-red-500 mx-auto mb-0.5" />
                              <p className="text-xs font-bold">{rec.hospital.blood?.Opos ?? '—'}</p>
                              <p className="text-xs text-gray-400">O+ units</p>
                            </div>
                            <div className="bg-white rounded-lg p-2 text-center border border-gray-100">
                              <Wind className="w-3.5 h-3.5 text-blue-500 mx-auto mb-0.5" />
                              <p className="text-xs font-bold">{rec.hospital.oxygen?.cylinders ?? '—'}</p>
                              <p className="text-xs text-gray-400">O₂ cyl.</p>
                            </div>
                          </div>
                        </motion.div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Map + Notify Button */}
                {bestHosp && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <MapView
                      center={gps.location || bestHosp.hospital.location || activeEmerg?.location || { lat: 13.0627, lng: 80.2545 }}
                      showRoute={true}
                      markers={mapMarkers}
                      height="200px"
                      zoom={13}
                    />
                    <button onClick={sendHospitalAlert} disabled={sending} className="btn-primary w-full mt-3">
                      {sending ? (
                        <span className="flex items-center gap-2">
                          <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                          Notifying {bestHosp.hospital.name}…
                        </span>
                      ) : (
                        <>
                          <Navigation className="w-4 h-4" />
                          Notify {bestHosp.hospital.name} · {bestHosp.etaMinutes} min ETA
                        </>
                      )}
                    </button>
                  </motion.div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button onClick={() => setTab('alerts')} className={`nav-tab ${tab === 'alerts' ? 'active' : ''}`}>
            <Bell className="w-5 h-5" />
            <span>Alerts</span>
            {unassignedAlerts.length > 0 && (
              <span className="absolute -top-1 -right-1 w-4 h-4 bg-brand-600 text-white text-xs rounded-full flex items-center justify-center">
                {unassignedAlerts.length}
              </span>
            )}
          </button>
          <button onClick={() => setTab('map')} className={`nav-tab ${tab === 'map' ? 'active' : ''}`}>
            <MapPin className="w-5 h-5" />
            <span>Track</span>
          </button>
          <button onClick={() => setTab('hospital')} className={`nav-tab relative ${tab === 'hospital' ? 'active' : ''}`}>
            <Building2 className="w-5 h-5" />
            <span>Hospital</span>
            {arrivedBanner && (
              <span className="absolute -top-1 -right-1 w-2 h-2 bg-green-500 rounded-full animate-ping" />
            )}
          </button>
        </div>
      </nav>

      {/* Visual Incoming Alert Pop-up Modal */}
      <AnimatePresence>
        {incomingAlert && !activeEmerg && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
            style={{ background: 'rgba(0,0,0,0.8)' }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl border-2 border-brand-500"
            >
              <div className="bg-brand-600 p-5 text-white flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                    <AlertTriangle className="w-8 h-8 text-white fill-white/20" />
                  </motion.div>
                  <div>
                    <h2 className="font-black text-base tracking-tight">NEW EMERGENCY ALERT</h2>
                    <p className="text-xs text-red-100 font-medium">Immediate dispatch requested</p>
                  </div>
                </div>

                <button
                  onClick={() => {
                    if (siren.isPlaying) {
                      siren.stop();
                    } else {
                      siren.play();
                    }
                  }}
                  title={siren.isPlaying ? "Silence Siren" : "Play Siren"}
                  className="p-1.5 px-2.5 rounded-xl bg-white/20 hover:bg-white/30 text-white transition-all flex items-center gap-1.5 text-xs font-bold shrink-0"
                >
                  <Volume2 className={`w-4 h-4 ${siren.isPlaying ? 'animate-bounce text-yellow-300' : 'text-white/60'}`} />
                  <span className="text-[10px]">{siren.isPlaying ? 'Siren On' : 'Silent'}</span>
                </button>
              </div>

              <div className="p-6 space-y-4">
                <div className="bg-brand-50 rounded-2xl p-4 border border-brand-100 text-center">
                  <span className="badge-red text-xs font-bold mb-1">HIGH CONFIDENCE</span>
                  <p className="text-xl font-black text-gray-900">{incomingAlert.userName}</p>
                  <p className="text-xs text-gray-500 mt-1">{incomingAlert.userBloodGroup} Blood · {incomingAlert.userPhone}</p>
                </div>

                <div className="space-y-2.5 text-sm text-gray-600">
                  <div className="flex justify-between">
                    <span className="font-semibold">AI Confidence:</span>
                    <span className="font-bold text-brand-600">{incomingAlert.confidenceScore}%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="font-semibold">Max Shake:</span>
                    <span className="font-bold text-gray-800">{incomingAlert.sensorData?.maxShakeMagnitude.toFixed(1)} m/s²</span>
                  </div>
                  <div className="bg-gray-50 p-3 rounded-xl border border-gray-100 text-xs italic">
                    "{incomingAlert.sensorData?.stillnessDuration.toFixed(1)}s stillness. Camera & audio feeds transmitted."
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button
                    onClick={() => {
                      declineEmergency(incomingAlert);
                      setIncomingAlert(null);
                    }}
                    className="btn-secondary flex-1 py-3 text-sm font-bold"
                  >
                    Decline
                  </button>
                  <button
                    onClick={() => {
                      acceptEmergency(incomingAlert);
                      setIncomingAlert(null);
                    }}
                    className="btn-primary flex-1 py-3 text-sm font-bold"
                  >
                    Accept Alert
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
