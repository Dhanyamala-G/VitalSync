// ─────────────────────────────────────────────
//  Ambulance Dashboard
//  AUTO-TRIGGER: GPS proximity < 200m → auto hospital recommendation
//  No manual "Find Hospital" button
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ambulance, Bell, MapPin, LogOut, Phone,
  Activity, Navigation, Building2, Volume2,
  Clock, CheckCircle, Mic, MicOff,
  Star, Bed, Droplets, Wind, AlertTriangle,
  Target, Zap, EyeOff, User,
} from 'lucide-react';
import { useAuthStore } from '../../store/useAuthStore';
import { useGPS } from '../../hooks/useGPS';
import { useVoice } from '../../hooks/useVoice';
import { useSirenAlarm } from '../../components/SirenAlarm';
import MapView from '../../components/MapView';
import type { MapMarker } from '../../components/MapView';
import {
  subscribeToEmergencies, subscribeToAmbulances, updateEmergency,
  fetchHospitals, createHospitalAlert, updateAmbulanceLocation,
} from '../../services/emergencyService';
import { recommendHospitals, haversineKm, fetchLiveNearbyHospitals } from '../../services/aiService';
import type {
  AmbulanceProfile, Emergency, HospitalProfile,
  HospitalRecommendation,
} from '../../types';

// ── Proximity threshold: 200 metres ──────────
const ARRIVAL_THRESHOLD_KM = 0.2;

export default function AmbulanceDashboard() {
  const { profile, signOut, firebaseUser } = useAuthStore();
  const amb = profile as AmbulanceProfile;

  const [tab,             setTab]             = useState<'alerts' | 'map' | 'hospital' | 'profile'>('alerts');
  const [emergencies,     setEmergencies]     = useState<Emergency[]>([]);
  const [fleetAmbulances, setFleetAmbulances] = useState<AmbulanceProfile[]>([]);
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

  const visibleAlerts = emergencies.filter(e => 
    (e.ambulanceId === firebaseUser?.uid && ['dispatched', 'confirmed', 'en_route'].includes(e.status)) ||
    (!e.ambulanceId && ['confirmed', 'triggered'].includes(e.status))
  );

  const hasActiveMission = !!(
    activeEmerg ||
    emergencies.some(e => e.ambulanceId === firebaseUser?.uid && ['dispatched', 'confirmed', 'en_route'].includes(e.status))
  );

  // Set of ambulance UIDs currently busy on an active dispatched mission
  const busyAmbulanceUids = useMemo(() => {
    return new Set(
      emergencies
        .filter(e => e.ambulanceId && ['dispatched', 'confirmed', 'en_route'].includes(e.status))
        .map(e => e.ambulanceId as string)
    );
  }, [emergencies]);

  // Other fleet ambulances
  const otherFleetAmbulances = fleetAmbulances.filter(
    a => a.uid !== firebaseUser?.uid && a.location && (a.location.lat !== 0 || a.location.lng !== 0)
  );

  const freeAmbulanceCount = otherFleetAmbulances.filter(
    a => !busyAmbulanceUids.has(a.uid) && a.status !== 'on_mission'
  ).length;

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

  // Dynamically discover and update live nearby hospitals based on current GPS location
  useEffect(() => {
    const lat = gps.location?.lat ?? 13.0627;
    const lng = gps.location?.lng ?? 80.2545;
    fetchHospitals().then(registered => {
      fetchLiveNearbyHospitals(lat, lng, registered as HospitalProfile[]).then(allHospitals => {
        setHospitals(allHospitals);
        const recs = recommendHospitals(lat, lng, allHospitals, activeEmerg?.userBloodGroup || '');
        setRecommendations(recs);
        if (recs.length > 0) {
          setBestHosp(prev => prev || recs[0]);
        }
      });
    });
  }, [gps.location?.lat, gps.location?.lng, activeEmerg?.userBloodGroup]);

  // Real-time fleet ambulances subscription
  useEffect(() => {
    return subscribeToAmbulances(setFleetAmbulances);
  }, []);

  // Sync active emergency with latest real-time updates from emergencies feed
  useEffect(() => {
    if (!activeEmerg) return;
    const latest = emergencies.find(e => e.id === activeEmerg.id);
    if (
      latest &&
      latest.ambulanceId === firebaseUser?.uid &&
      ['dispatched', 'confirmed', 'en_route'].includes(latest.status)
    ) {
      if (
        latest.location.lat !== activeEmerg.location.lat ||
        latest.location.lng !== activeEmerg.location.lng ||
        latest.status !== activeEmerg.status
      ) {
        setActiveEmerg(latest);
      }
    } else {
      // Emergency canceled/aborted/resolved/unaccepted -> immediately clear all patient tracking
      setActiveEmerg(null);
      setBestHosp(null);
      setDistanceKm(null);
      setSentAlert(false);
      setArrivedBanner(false);
    }
  }, [emergencies, activeEmerg, firebaseUser?.uid]);

  // Auto-engage active mission on mount or reload only if already accepted and dispatched to this ambulance
  useEffect(() => {
    if (!firebaseUser?.uid || activeEmerg) return;
    const activeMission = emergencies.find(
      e => e.ambulanceId === firebaseUser.uid && ['dispatched', 'confirmed', 'en_route'].includes(e.status)
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
    setIncomingAlert(null);
    if (activeEmerg?.id === emergency.id) {
      setActiveEmerg(null);
      setBestHosp(null);
      setDistanceKm(null);
      setSentAlert(false);
      setArrivedBanner(false);
    }
    await updateEmergency(emergency.id, { status: 'aborted' });
  }, [siren, activeEmerg]);

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
  if (gps.location) {
    mapMarkers.push({
      lat: gps.location.lat,
      lng: gps.location.lng,
      label: hasActiveMission
        ? `You: ${amb?.vehicleNo || 'Ambulance'} (On Mission)`
        : `You: ${amb?.vehicleNo || 'Ambulance'} (Standby Free)`,
      color: hasActiveMission ? 'orange' : 'blue',
      pulse: true,
      iconText: '🚑',
    });
  }
  // ONLY show patient marker if mission has been accepted by this driver
  if (activeEmerg?.location && activeEmerg.ambulanceId === firebaseUser?.uid) {
    mapMarkers.push({
      lat: activeEmerg.location.lat,
      lng: activeEmerg.location.lng,
      label: `Patient: ${activeEmerg.userName}`,
      color: 'red',
      pulse: true,
      iconText: '📍',
    });
  }
  // Show all nearby tracked hospitals on the map with purple 🏥 pins
  hospitals.forEach(h => {
    if (h.location && (h.location.lat !== 0 || h.location.lng !== 0)) {
      const isTarget = bestHosp?.hospital.uid === h.uid;
      mapMarkers.push({
        lat: h.location.lat,
        lng: h.location.lng,
        label: `🏥 ${h.name} (${h.beds?.emergency?.available ?? 0} ER beds, ${h.beds?.icu?.available ?? 0} ICU)`,
        color: 'purple',
        pulse: isTarget,
        iconText: '🏥',
      });
    }
  });
  
  // Show nearby fleet ambulances (Green for Free, Orange for On Mission)
  otherFleetAmbulances.forEach(a => {
    const isBusy = busyAmbulanceUids.has(a.uid) || a.status === 'on_mission';
    mapMarkers.push({
      lat: a.location!.lat,
      lng: a.location!.lng,
      label: isBusy
        ? `🟠 On Mission: ${a.vehicleNo} (${a.driverName || 'Driver'})`
        : `🟢 Free: ${a.vehicleNo} (${a.driverName || 'Driver'})`,
      color: isBusy ? 'orange' : 'green',
      pulse: isBusy,
      iconText: isBusy ? '🚨' : '🚑',
    });
  });

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
          <span className={`badge ${hasActiveMission ? 'badge-green font-bold' : visibleAlerts.length > 0 ? 'badge-red animate-pulse' : 'badge-green'}`}>
            {hasActiveMission ? 'Mission Active' : visibleAlerts.length > 0 ? `${visibleAlerts.length} Alert` : 'Standby'}
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
          <div>
            <div className="flex items-center justify-between mb-3">
                <p className="section-title mb-0">Live Alerts</p>
                {visibleAlerts.length > 0 && (
                  <span className={`badge ${hasActiveMission ? 'badge-green font-bold' : 'badge-red animate-pulse'}`}>
                    {hasActiveMission ? '1 Active Mission' : `${visibleAlerts.length} incoming`}
                  </span>
                )}
              </div>

              {visibleAlerts.length === 0 ? (
                <div className="card p-8 text-center">
                  <Bell className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                  <p className="text-gray-400 text-sm">No active alerts</p>
                  <p className="text-gray-300 text-xs mt-1">Monitoring for emergencies…</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {visibleAlerts.map(e => {
                    const isMyAcceptedMission = e.ambulanceId === firebaseUser?.uid || activeEmerg?.id === e.id;
                    return (
                      <motion.div
                        key={e.id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`alert-card transition-all ${isMyAcceptedMission ? 'border-2 border-green-500 bg-green-50/20 shadow-md' : ''}`}
                      >
                        <div className="flex items-start justify-between mb-3">
                          <div>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-bold text-sm text-gray-900">{e.userName}</span>
                              {isMyAcceptedMission ? (
                                <span className="badge-green font-extrabold text-[10px] flex items-center gap-1">
                                  <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                  ACCEPTED (EN ROUTE)
                                </span>
                              ) : (
                                <span className={e.classification === 'HIGH' ? 'badge-red' : 'badge-gray'}>{e.classification}</span>
                              )}
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
                          <MapPin className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                          {isMyAcceptedMission ? (
                            <span className="font-semibold text-gray-800">
                              GPS: {e.location.lat.toFixed(5)}, {e.location.lng.toFixed(5)}
                            </span>
                          ) : (
                            <span className="font-medium text-gray-400 italic flex items-center gap-1">
                              <EyeOff className="w-3 h-3 text-gray-400" />
                              Location Hidden (Accept to unlock GPS navigation)
                            </span>
                          )}
                          <span className="ml-auto flex items-center gap-1 font-semibold text-gray-600">
                            <Activity className="w-3 h-3 text-gray-400" />
                            {e.sensorData?.maxShakeMagnitude?.toFixed(1)} m/s²
                          </span>
                        </div>

                        <div className="flex gap-2">
                          {isMyAcceptedMission ? (
                            <>
                              <button
                                onClick={() => setTab('map')}
                                className="btn-primary flex-1 py-2.5 text-sm bg-green-600 hover:bg-green-700 font-bold"
                              >
                                Track Patient →
                              </button>
                              <button
                                onClick={() => declineEmergency(e)}
                                className="btn-secondary flex-1 py-2.5 text-sm border-red-200 text-red-600 hover:bg-red-50 font-semibold"
                              >
                                Decline Mission
                              </button>
                            </>
                          ) : (
                            <>
                              <button
                                onClick={() => acceptEmergency(e)}
                                disabled={hasActiveMission}
                                title={hasActiveMission ? "You have an active accepted mission" : "Accept Emergency"}
                                className={`btn-primary flex-1 py-2.5 text-sm ${
                                  hasActiveMission
                                    ? 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-200 hover:bg-gray-200 shadow-none'
                                    : ''
                                }`}
                              >
                                {hasActiveMission ? 'Occupied (Finish Current)' : 'Accept Mission'}
                              </button>
                              <button
                                onClick={() => declineEmergency(e)}
                                className="btn-secondary flex-1 py-2.5 text-sm"
                              >
                                Decline
                              </button>
                            </>
                          )}
                        </div>
                      </motion.div>
                    );
                  })}
                </div>
              )}
            </div>
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
              <div className="space-y-4 py-2">
                <div className="card p-6 text-center space-y-2 bg-gray-50/80 border border-gray-100 rounded-2xl">
                  <Navigation className="w-10 h-10 text-gray-300 mx-auto" />
                  <h4 className="font-bold text-gray-700 text-sm">No Active Patient Tracking</h4>
                  <p className="text-gray-400 text-xs max-w-xs mx-auto">
                    The request was canceled or removed from alerts. There is no patient location to track.
                  </p>
                </div>
                
                <div className="card p-3">
                  <p className="text-xs font-semibold text-gray-500 mb-2 flex items-center gap-1.5">
                    <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
                    Ambulance Standby Map & Fleet Network
                  </p>
                  <MapView
                    center={gps.location || { lat: 13.0627, lng: 80.2545 }}
                    showRoute={false}
                    markers={mapMarkers}
                    height="280px"
                    zoom={13}
                  />
                </div>
              </div>
            )}

            {/* ── NEARBY AVAILABLE FLEET AMBULANCES (MULTI-UNIT BACKUP) ── */}
            <div className="mt-4 pt-3 border-t border-gray-100">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <div className="w-6 h-6 rounded-lg bg-blue-100 text-blue-700 flex items-center justify-center">
                    <Ambulance className="w-3.5 h-3.5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-xs text-gray-900">Fleet Ambulances Nearby</h3>
                    <p className="text-[10px] text-gray-400">Mutual aid / Multi-casualty backup</p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="badge-green text-[9px] font-bold">
                    {freeAmbulanceCount} Free
                  </span>
                  <span className="badge-orange text-[9px] font-bold">
                    {otherFleetAmbulances.length - freeAmbulanceCount} On Mission
                  </span>
                </div>
              </div>

              {otherFleetAmbulances.length === 0 ? (
                <div className="bg-gray-50 p-4 rounded-2xl text-center text-xs text-gray-400">
                  No other active fleet ambulances detected nearby.
                </div>
              ) : (
                <div className="space-y-2">
                  {otherFleetAmbulances.map(unit => {
                    const isBusy = busyAmbulanceUids.has(unit.uid) || unit.status === 'on_mission';
                    const dist = gps.location && unit.location
                      ? haversineKm(gps.location.lat, gps.location.lng, unit.location.lat, unit.location.lng)
                      : null;
                    return (
                      <div
                        key={unit.uid}
                        className={`p-3 rounded-2xl border flex items-center justify-between gap-3 transition-all ${
                          isBusy ? 'bg-orange-50/40 border-orange-200/60' : 'bg-gray-50/80 border-gray-100'
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-gray-900 truncate">
                              {unit.vehicleNo || 'Ambulance Unit'}
                            </span>
                            {isBusy ? (
                              <span className="badge-yellow text-[9px] py-0.5 px-1.5 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-orange-500 rounded-full animate-pulse" />
                                On Mission
                              </span>
                            ) : (
                              <span className="badge-green text-[9px] py-0.5 px-1.5 font-bold flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                                Free
                              </span>
                            )}
                          </div>
                          <p className="text-[11px] text-gray-500 mt-0.5">
                            {unit.driverName || 'Driver'} · {unit.vehicleType || 'Basic Life Support'}
                          </p>
                          {dist !== null && (
                            <p className="text-[10px] text-brand-600 font-semibold mt-0.5">
                              {dist < 1 ? `${Math.round(dist * 1000)} m away` : `${dist.toFixed(1)} km away`}
                            </p>
                          )}
                        </div>

                        {unit.phone ? (
                          <a
                            href={`tel:${unit.phone}`}
                            className={`btn-primary py-2 px-3 text-xs flex items-center gap-1.5 font-bold shrink-0 rounded-xl shadow-sm ${
                              isBusy
                                ? 'bg-orange-600 hover:bg-orange-700 text-white'
                                : 'bg-green-600 hover:bg-green-700 text-white'
                            }`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                            {isBusy ? 'Contact Unit' : 'Call Backup'}
                          </a>
                        ) : (
                          <span className="text-[10px] text-gray-400">No Contact</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
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

        {/* ── PROFILE TAB ─────────────────────── */}
        {tab === 'profile' && (
          <div className="space-y-4">
            <div className="card overflow-hidden border border-brand-100 shadow-md">
              <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-5 py-6 text-white">
                <div className="flex items-center gap-3.5">
                  <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center text-white font-black text-2xl shadow-inner shrink-0">
                    🚑
                  </div>
                  <div>
                    <h2 className="text-white font-extrabold text-lg tracking-tight">
                      {amb?.vehicleNo || 'Ambulance Unit'}
                    </h2>
                    <p className="text-red-100 text-xs">
                      Driver: {amb?.driverName || firebaseUser?.displayName || 'Ambulance Pilot'}
                    </p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <span className="bg-white/20 backdrop-blur-sm text-white px-2.5 py-0.5 rounded-full text-xs font-bold">
                        {amb?.vehicleType || 'Advanced Life Support'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-4 bg-white space-y-3">
                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                  <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                    <Phone className="w-3.5 h-3.5 text-brand-600" /> Driver Contact
                  </span>
                  <span className="font-semibold text-gray-800">
                    {amb?.phone || 'Not provided'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                  <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                    <Activity className="w-3.5 h-3.5 text-green-600" /> Operational Status
                  </span>
                  <span className={`badge ${hasActiveMission ? 'badge-yellow font-bold' : 'badge-green font-bold'}`}>
                    {hasActiveMission ? 'On Mission (Dispatched)' : 'Available (Standby)'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs py-1 border-b border-gray-50">
                  <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                    <Building2 className="w-3.5 h-3.5 text-blue-600" /> Dispatch Email
                  </span>
                  <span className="font-semibold text-gray-800">
                    {amb?.email || firebaseUser?.email || 'dispatch@vitalsync.health'}
                  </span>
                </div>
              </div>
            </div>

            {/* Vehicle Capabilities Card */}
            <div className="card p-5 space-y-3 shadow-sm border border-gray-100">
              <p className="font-bold text-sm text-gray-900">Vehicle Equipment & Capabilities</p>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100/60 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="font-medium text-gray-700">Oxygen Support</span>
                </div>
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100/60 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="font-medium text-gray-700">Defibrillator / ECG</span>
                </div>
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100/60 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="font-medium text-gray-700">First Aid & Trauma</span>
                </div>
                <div className="p-2.5 bg-gray-50 rounded-xl border border-gray-100/60 flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="font-medium text-gray-700">GPS Live Telemetry</span>
                </div>
              </div>
            </div>

            {/* Actions Card */}
            <div className="card p-4 space-y-2.5 shadow-sm border border-gray-100">
              <p className="section-title mb-1">Account</p>
              <button
                onClick={() => signOut()}
                className="btn-secondary w-full py-2.5 text-xs text-red-600 hover:bg-red-50 border-red-200 font-bold flex items-center justify-center gap-2 rounded-xl"
              >
                <LogOut className="w-4 h-4 text-red-600" />
                Sign Out
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Bottom Nav */}
      <nav className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-100 z-30 pb-safe">
        <div className="max-w-md mx-auto flex items-center justify-around">
          <button onClick={() => setTab('alerts')} className={`nav-tab ${tab === 'alerts' ? 'active' : ''}`}>
            <Bell className="w-5 h-5" />
            <span>Alerts</span>
            {visibleAlerts.length > 0 && (
              <span className={`absolute -top-1 -right-1 w-4 h-4 text-white text-xs rounded-full flex items-center justify-center ${hasActiveMission ? 'bg-green-600' : 'bg-brand-600'}`}>
                {visibleAlerts.length}
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
          <button onClick={() => setTab('profile')} className={`nav-tab ${tab === 'profile' ? 'active' : ''}`}>
            <User className="w-5 h-5" />
            <span>Profile</span>
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
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm overflow-y-auto"
            style={{ zIndex: 9999 }}
          >
            <motion.div
              initial={{ scale: 0.9, y: 20 }}
              animate={{ scale: 1, y: 0 }}
              exit={{ scale: 0.9, y: 20 }}
              className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl border-2 border-brand-500 relative z-[10000]"
              style={{ zIndex: 10000 }}
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
