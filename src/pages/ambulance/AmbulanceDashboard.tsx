import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Ambulance, Bell, MapPin, LogOut, Phone,
  Activity, Navigation, Building2, Volume2,
  Clock, CheckCircle, CheckCircle2, Mic, MicOff,
  Star, Bed, Droplets, Wind, AlertTriangle,
  Target, User, Sparkles, Radio, X, Power,
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
  updateAmbulanceStatus,
  createAmbulanceBackupRequest, subscribeToAmbulanceBackupRequests,
} from '../../services/emergencyService';
import { recommendHospitals, haversineKm, fetchLiveNearbyHospitals } from '../../services/aiService';
import { MOCK_HOSPITALS } from '../../utils/mockData';
import type {
  AmbulanceProfile, Emergency, HospitalProfile,
  HospitalRecommendation,
} from '../../types';

// ── Proximity threshold: 200 metres ──────────
const ARRIVAL_THRESHOLD_KM = 0.2;

function extractPatientCount(text: string): number {
  if (!text) return 1;
  const wordToNum: Record<string, number> = {
    one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    single: 1, double: 2, couple: 2, trio: 3
  };

  // Check digit patterns e.g. "2 patients", "count: 3", "4 casualties", "2 people"
  const digitMatch = text.match(/(\d+)\s*(?:patient|casualt|victim|person|people|individual|injured|count|case)/i);
  if (digitMatch && digitMatch[1]) {
    const parsed = parseInt(digitMatch[1], 10);
    if (parsed > 0 && parsed <= 50) return parsed;
  }

  // Check word patterns e.g. "two patients", "three casualties"
  const wordMatch = text.match(/\b(one|two|three|four|five|six|seven|eight|nine|ten|single|double|couple|trio)\s*(?:patient|casualt|victim|person|people|individual|injured|count|case)/i);
  if (wordMatch && wordMatch[1] && wordToNum[wordMatch[1].toLowerCase()]) {
    return wordToNum[wordMatch[1].toLowerCase()];
  }

  // General leading number check e.g. "2, trauma..."
  const leadingMatch = text.match(/^\s*(\d+)\b/);
  if (leadingMatch && leadingMatch[1]) {
    const parsed = parseInt(leadingMatch[1], 10);
    if (parsed > 0 && parsed <= 50) return parsed;
  }

  return 1;
}

export default function AmbulanceDashboard() {
  const { profile, signOut, firebaseUser } = useAuthStore();
  const amb = profile as AmbulanceProfile;

  const [tab,             setTab]             = useState<'alerts' | 'map' | 'hospital' | 'profile'>('alerts');
  const [emergencies,     setEmergencies]     = useState<Emergency[]>([]);
  const [fleetAmbulances, setFleetAmbulances] = useState<AmbulanceProfile[]>([]);
  const [activeEmerg,     setActiveEmerg]     = useState<Emergency | null>(null);
  const [declinedIds,       setDeclinedIds]       = useState<Set<string>>(new Set());
  const [showIncomingModal, setShowIncomingModal] = useState(false);
  const [hospitals,       setHospitals]       = useState<HospitalProfile[]>(MOCK_HOSPITALS as HospitalProfile[]);
  const [recommendations, setRecommendations] = useState<HospitalRecommendation[]>([]);
  const [voiceNote,       setVoiceNote]       = useState('');
  const [patientCount,    setPatientCount]    = useState(1);
  const [voiceCountDetected, setVoiceCountDetected] = useState(false);
  const [bestHosp,        setBestHosp]        = useState<HospitalRecommendation | null>(null);
  const [sending,         setSending]         = useState(false);
  const [sentAlert,       setSentAlert]       = useState(false);
  const [arrivedBanner,   setArrivedBanner]   = useState(false);
  const [distanceKm,      setDistanceKm]      = useState<number | null>(null);
  const [hospitalHandoverDone, setHospitalHandoverDone] = useState(false);
  const [isFleetUnitDisabled, setIsFleetUnitDisabled]   = useState(false);
  const [lastHandoverHospital, setLastHandoverHospital] = useState('');

  // Sync disabled state with profile status from Firestore
  useEffect(() => {
    if (amb?.status === 'offline') {
      setIsFleetUnitDisabled(true);
    } else if (amb?.status === 'available' || amb?.status === 'on_mission') {
      setIsFleetUnitDisabled(false);
    }
  }, [amb?.status]);

  // Fleet Backup & Mutual Aid State
  const [showBackupModal, setShowBackupModal] = useState(false);
  const [backupReason, setBackupReason] = useState('Extra Ambulance Needed (Multi-Casualty)');
  const [backupSuccess, setBackupSuccess] = useState(false);
  const [sendingBackup, setSendingBackup] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [activeBackupRequests, setActiveBackupRequests] = useState<any[]>([]);

  const prevCountRef  = useRef(0);
  const arrivedRef    = useRef(false);   // prevent double-trigger

  const gps    = useGPS(true);
  const siren  = useSirenAlarm();
  const voice  = useVoice(t => setVoiceNote(t));

  // Sync patient count when voice note updates
  useEffect(() => {
    if (voiceNote) {
      const detected = extractPatientCount(voiceNote);
      if (detected > 1 || /patient|casualt|victim|person/i.test(voiceNote)) {
        setPatientCount(detected);
        setVoiceCountDetected(true);
      }
    }
  }, [voiceNote]);

  // Subscribe to real-time fleet backup requests from other ambulance drivers
  useEffect(() => {
    return subscribeToAmbulanceBackupRequests(setActiveBackupRequests);
  }, []);

  // Compute distance and ETA for all unassigned incoming emergencies, sorted by distance ascending (least distance first)
  const unassignedAlerts = useMemo(() => {
    const ambLat = gps.location?.lat ?? 13.0627;
    const ambLng = gps.location?.lng ?? 80.2545;

    const unassigned = emergencies.filter(
      e => e.status === 'confirmed' && !e.ambulanceId && !declinedIds.has(e.id)
    );

    const withDist = unassigned.map(e => {
      const dist = haversineKm(ambLat, ambLng, e.location.lat, e.location.lng);
      const etaMins = Math.max(1, Math.round(dist * 2.4)); // ~25 km/h urban speed estimate
      return {
        ...e,
        distanceKm: dist,
        etaMins,
      };
    });

    // Sort by distance ascending: closest first
    withDist.sort((a, b) => a.distanceKm - b.distanceKm);

    return withDist;
  }, [emergencies, gps.location, declinedIds]);

  // Combined visible alerts: active mission first (if any), followed by all unassigned incoming requests sorted by distance
  const visibleAlerts = useMemo(() => {
    const list: (Emergency & { distanceKm?: number; etaMins?: number })[] = [];
    
    // 1. My active mission if any
    const myMission = emergencies.find(
      e => e.ambulanceId === firebaseUser?.uid && ['dispatched', 'confirmed', 'en_route'].includes(e.status)
    );
    if (myMission) {
      const ambLat = gps.location?.lat ?? 13.0627;
      const ambLng = gps.location?.lng ?? 80.2545;
      const dist = haversineKm(ambLat, ambLng, myMission.location.lat, myMission.location.lng);
      list.push({
        ...myMission,
        distanceKm: dist,
        etaMins: Math.max(1, Math.round(dist * 2.4)),
      });
    }

    // 2. All unassigned incoming emergencies sorted by distance
    list.push(...unassignedAlerts);

    return list;
  }, [emergencies, firebaseUser?.uid, gps.location, unassignedAlerts]);

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

  const formatDistance = (km?: number) => {
    if (km === undefined || km === null) return 'Calculating…';
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(1)} km`;
  };

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

      if (activeEmerg || myActiveMission || isFleetUnitDisabled) {
        setShowIncomingModal(false);
        siren.stop();
      } else {
        const unassigned = list.filter(e => e.status === 'confirmed' && !e.ambulanceId && !declinedIds.has(e.id));
        if (unassigned.length > 0) {
          setShowIncomingModal(true);
          siren.play();
        } else {
          setShowIncomingModal(false);
          siren.stop();
        }
      }
      
      prevCountRef.current = list.length;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeEmerg, firebaseUser?.uid, isFleetUnitDisabled, declinedIds]);

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

      // Auto-load hospital recommendations based strictly on user location
      const recs = recommendHospitals(
        activeEmerg.location.lat,
        activeEmerg.location.lng,
        hospitals,
        activeEmerg.userBloodGroup || 'trauma',
      );
      setRecommendations(recs);
      if (recs.length > 0 && !bestHosp) setBestHosp(recs[0]);
      setTab('hospital');

      // Dismiss banner after 5 s
      setTimeout(() => setArrivedBanner(false), 5000);
    }
  }, [gps.location, activeEmerg, hospitals, bestHosp]);

  // Keep hospital recommendations synced strictly with user location
  useEffect(() => {
    if (!activeEmerg || activeEmerg.ambulanceId !== firebaseUser?.uid) {
      setRecommendations([]);
      setBestHosp(null);
      return;
    }
    const recs = recommendHospitals(
      activeEmerg.location.lat,
      activeEmerg.location.lng,
      hospitals,
      activeEmerg.userBloodGroup || '',
    );
    setRecommendations(recs);
    setBestHosp(prev => {
      if (prev && recs.some(r => r.hospital.uid === prev.hospital.uid)) {
        return recs.find(r => r.hospital.uid === prev.hospital.uid) || recs[0] || null;
      }
      return recs[0] || null;
    });
  }, [activeEmerg, hospitals, firebaseUser?.uid]);

  const acceptEmergency = useCallback(async (emergency: Emergency) => {
    siren.stop();
    setShowIncomingModal(false);
    arrivedRef.current = false;
    setDistanceKm(null);
    setSentAlert(false);
    setIsFleetUnitDisabled(false);
    await updateEmergency(emergency.id, {
      status:       'dispatched',
      ambulanceId:  firebaseUser?.uid,
    });
    if (firebaseUser?.uid) {
      await updateAmbulanceStatus(firebaseUser.uid, 'on_mission');
      if (gps.location) {
        await updateAmbulanceLocation(firebaseUser.uid, gps.location.lat, gps.location.lng);
      }
    }
    setActiveEmerg(emergency);

    // Suggest best hospitals immediately based strictly on USER location
    const recs = recommendHospitals(
      emergency.location.lat,
      emergency.location.lng,
      hospitals,
      emergency.userBloodGroup || '',
    );
    setRecommendations(recs);
    if (recs.length > 0) setBestHosp(recs[0]);

    setTab('hospital');
  }, [firebaseUser?.uid, siren, gps.location, hospitals]);

  const declineEmergency = useCallback(async (emergency: Emergency) => {
    if (activeEmerg?.id === emergency.id) {
      siren.stop();
      setActiveEmerg(null);
      setBestHosp(null);
      setDistanceKm(null);
      setSentAlert(false);
      setArrivedBanner(false);
      await updateEmergency(emergency.id, { status: 'aborted' });
    } else {
      setDeclinedIds(prev => new Set(prev).add(emergency.id));
      if (unassignedAlerts.length <= 1) {
        siren.stop();
        setShowIncomingModal(false);
      }
    }
  }, [siren, activeEmerg, unassignedAlerts.length]);

  const isTransitToHospital = !!(activeEmerg && (sentAlert || activeEmerg.status === 'en_route'));

  const distToTargetHospital = useMemo(() => {
    if (!bestHosp?.hospital.location) return null;
    const ambLat = gps.location?.lat ?? 13.0627;
    const ambLng = gps.location?.lng ?? 80.2545;
    return haversineKm(ambLat, ambLng, bestHosp.hospital.location.lat, bestHosp.hospital.location.lng);
  }, [gps.location, bestHosp]);

  // Handover is ONLY enabled once hospital location matches ambulance location (~10-15m / 0.015 km)
  const isNearHospital = useMemo(() => {
    if (distToTargetHospital === null) return false;
    return distToTargetHospital <= 0.015;
  }, [distToTargetHospital]);

  const completeHospitalHandover = useCallback(async () => {
    if (!activeEmerg) return;
    if (!isNearHospital) {
      console.warn("Handover blocked: ambulance has not reached hospital location yet.");
      return;
    }
    const targetHospName = bestHosp?.hospital.name || 'Hospital ER';
    try {
      await updateEmergency(activeEmerg.id, {
        status: 'resolved',
        resolvedAt: Date.now(),
      });
      if (firebaseUser?.uid) {
        // Disable fleet unit upon hospital handover (sets status to offline)
        await updateAmbulanceStatus(firebaseUser.uid, 'offline');
        if (gps.location) {
          await updateAmbulanceLocation(firebaseUser.uid, gps.location.lat, gps.location.lng);
        }
      }
    } catch (err) {
      console.error("Complete handover error:", err);
    } finally {
      setActiveEmerg(null);
      setBestHosp(null);
      setSentAlert(false);
      setArrivedBanner(false);
      setHospitalHandoverDone(true);
      setIsFleetUnitDisabled(true);
      setLastHandoverHospital(targetHospName);
      setTab('alerts');
      setTimeout(() => setHospitalHandoverDone(false), 8000);
    }
  }, [activeEmerg, isNearHospital, bestHosp, firebaseUser?.uid, gps.location]);

  const reEnableFleetUnit = useCallback(async () => {
    if (firebaseUser?.uid) {
      await updateAmbulanceStatus(firebaseUser.uid, 'available');
    }
    setIsFleetUnitDisabled(false);
  }, [firebaseUser?.uid]);

  // Auto-handover when ambulance gets within ~10-15 metres (0.015 km) of hospital
  useEffect(() => {
    if (!isTransitToHospital || !isNearHospital) return;
    completeHospitalHandover();
  }, [isNearHospital, isTransitToHospital, completeHospitalHandover]);

  const sendHospitalAlert = useCallback(async () => {
    if (!bestHosp || !activeEmerg || !firebaseUser) return;
    setSending(true);
    try {
      await createHospitalAlert({
        hospitalId:         bestHosp.hospital.uid,
        hospitalName:       bestHosp.hospital.name,
        ambulanceId:        firebaseUser.uid,
        ambulanceVehicleNo: amb?.vehicleNo || '',
        emergencyId:        activeEmerg.id,
        patientCount:       patientCount,
        condition:          voiceNote || 'Trauma patient en route',
        etaMinutes:         bestHosp.etaMinutes,
        status:             'en_route',
        timestamp:          Date.now(),
      });
      await updateEmergency(activeEmerg.id, {
        hospitalId:   bestHosp.hospital.uid,
        hospitalName: bestHosp.hospital.name,
        status:       'en_route',
      });
      setSentAlert(true);
      setTab('map'); // Keep map navigation active and visible!
    } finally {
      setSending(false);
    }
  }, [bestHosp, activeEmerg, firebaseUser, amb?.vehicleNo, voiceNote, patientCount]);

  const handleSendBackupRequest = async () => {
    if (!firebaseUser) return;
    setSendingBackup(true);
    try {
      await createAmbulanceBackupRequest({
        ambulanceId: firebaseUser.uid,
        vehicleNo: amb?.vehicleNo || 'Ambulance Unit',
        driverName: amb?.driverName || 'Driver',
        phone: amb?.phone || '',
        location: gps.location || { lat: 13.0627, lng: 80.2545 },
        reason: backupReason,
        emergencyId: activeEmerg?.id || null,
      });
      setBackupSuccess(true);
      setTimeout(() => {
        setBackupSuccess(false);
        setShowBackupModal(false);
      }, 2500);
    } catch (err) {
      console.error("Backup request error:", err);
    } finally {
      setSendingBackup(false);
    }
  };

  const mapMarkers: MapMarker[] = [];
  const ambLat = gps.location?.lat ?? 13.0627;
  const ambLng = gps.location?.lng ?? 80.2545;

  if (gps.location) {
    mapMarkers.push({
      lat: gps.location.lat,
      lng: gps.location.lng,
      label: isFleetUnitDisabled
        ? `You: ${amb?.vehicleNo || 'Ambulance'} (Disabled - Post-Handover)`
        : isTransitToHospital
        ? `You: ${amb?.vehicleNo || 'Ambulance'} (Patient Onboard → ${bestHosp?.hospital.name || 'Hospital'})`
        : hasActiveMission
        ? `You: ${amb?.vehicleNo || 'Ambulance'} (On Mission)`
        : `You: ${amb?.vehicleNo || 'Ambulance'} (Standby Free)`,
      color: isFleetUnitDisabled ? 'gray' : isTransitToHospital ? 'orange' : hasActiveMission ? 'orange' : 'blue',
      pulse: !isFleetUnitDisabled && (hasActiveMission || isTransitToHospital),
      iconText: isFleetUnitDisabled ? '⛔' : '🚑',
      category: isFleetUnitDisabled
        ? 'Your Unit (Disabled / Post-Handover)'
        : isTransitToHospital
        ? 'Your Unit (In Transit to ER)'
        : hasActiveMission
        ? 'Your Unit (Dispatched & En Route)'
        : 'Your Unit (Standby / Available)',
      details: isFleetUnitDisabled
        ? `Vehicle: ${amb?.vehicleNo || 'Ambulance'} · Status: Disabled Post-Handover`
        : isTransitToHospital
        ? `Destination: ${bestHosp?.hospital.name} · ER ETA: ~${Math.max(1, Math.round((distToTargetHospital ?? 1) * 2.4))}m`
        : `Vehicle: ${amb?.vehicleNo || 'Ambulance'} · Driver: ${amb?.driverName || 'You'}`,
      distance: isTransitToHospital && distToTargetHospital !== null
        ? `${formatDistance(distToTargetHospital)} to ER`
        : undefined,
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
      category: 'Emergency Patient Location',
      details: `Patient: ${activeEmerg.userName} · Blood: ${activeEmerg.userBloodGroup || 'Unknown'} · Phone: ${activeEmerg.userPhone}`,
      distance: `${formatDistance(distanceKm || undefined)} away`,
    });
  }
  // Show all nearby tracked hospitals on the map with purple 🏥 pins and rich touch popups
  hospitals.forEach(h => {
    if (h.location && (h.location.lat !== 0 || h.location.lng !== 0)) {
      const isTarget = bestHosp?.hospital.uid === h.uid;
      const dist = haversineKm(ambLat, ambLng, h.location.lat, h.location.lng);
      mapMarkers.push({
        lat: h.location.lat,
        lng: h.location.lng,
        label: h.name,
        color: 'purple',
        pulse: isTarget,
        iconText: '🏥',
        category: isTarget ? '⭐ CHOSEN TARGET HOSPITAL' : (h.specialties?.[0] || 'Hospital Hub'),
        details: `🛏️ ER: ${h.beds?.emergency?.available ?? 0} Beds · ICU: ${h.beds?.icu?.available ?? 0} Beds · O₂: ${h.oxygen?.cylinders ?? 20} cyl`,
        distance: `${dist.toFixed(1)} km away`,
      });
    }
  });
  
  // Show nearby fleet ambulances (Green for Free, Orange for On Mission, Gray for Disabled)
  otherFleetAmbulances.forEach(a => {
    const isBusy = busyAmbulanceUids.has(a.uid) || a.status === 'on_mission';
    const isOffline = a.status === 'offline';
    const dist = haversineKm(ambLat, ambLng, a.location!.lat, a.location!.lng);
    mapMarkers.push({
      lat: a.location!.lat,
      lng: a.location!.lng,
      label: isOffline
        ? `⛔ Disabled: ${a.vehicleNo} (${a.driverName || 'Driver'})`
        : isBusy
        ? `🟠 On Mission: ${a.vehicleNo} (${a.driverName || 'Driver'})`
        : `🟢 Free: ${a.vehicleNo} (${a.driverName || 'Driver'})`,
      color: isOffline ? 'gray' : isBusy ? 'orange' : 'green',
      pulse: isBusy,
      iconText: isOffline ? '⛔' : isBusy ? '🚨' : '🚑',
      category: isOffline ? 'Fleet Ambulance (Disabled / Post-Handover)' : isBusy ? 'Fleet Ambulance (On Mission)' : 'Fleet Ambulance (Standby Free)',
      details: `Vehicle: ${a.vehicleNo} · Driver: ${a.driverName || 'Driver'} (${a.vehicleType}) · Status: ${isOffline ? 'Disabled' : isBusy ? 'On Mission' : 'Available'}`,
      distance: `${dist.toFixed(1)} km away`,
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
          <span className={`badge ${
            isFleetUnitDisabled
              ? 'bg-gray-100 text-gray-700 font-bold border border-gray-300'
              : hasActiveMission
              ? 'badge-green font-bold'
              : visibleAlerts.length > 0
              ? 'badge-red animate-pulse'
              : 'badge-green'
          }`}>
            {isFleetUnitDisabled ? '⛔ Unit Disabled' : hasActiveMission ? 'Mission Active' : visibleAlerts.length > 0 ? `${visibleAlerts.length} Alert` : 'Standby'}
          </span>
          <button onClick={signOut} className="btn-ghost p-2"><LogOut className="w-4 h-4" /></button>
        </div>
      </div>

      {/* Hospital Handover Success Banner */}
      <AnimatePresence>
        {hospitalHandoverDone && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-emerald-600 text-white shadow-md">
            <div className="max-w-md mx-auto px-4 py-3 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-200 shrink-0" />
                <div>
                  <p className="font-extrabold text-xs">🎯 Hospital Handover Complete!</p>
                  <p className="text-emerald-100 text-[11px]">Patient admitted. Unit is available for new emergency dispatches.</p>
                </div>
              </div>
              <span className="badge bg-white text-emerald-800 text-[10px] font-black shrink-0">Standby Free</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Incoming Fleet Backup Broadcast Banner from other drivers */}
      <AnimatePresence>
        {activeBackupRequests.length > 0 && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-orange-600 text-white shadow-md">
            <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Radio className="w-4 h-4 text-orange-200 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <p className="font-extrabold text-xs truncate">📢 Fleet Backup Alert ({activeBackupRequests[0].vehicleNo})</p>
                  <p className="text-orange-100 text-[10px] truncate">{activeBackupRequests[0].reason}</p>
                </div>
              </div>
              {activeBackupRequests[0].phone && (
                <a
                  href={`tel:${activeBackupRequests[0].phone}`}
                  className="btn-primary py-1 px-2.5 text-[10px] bg-white text-orange-800 hover:bg-orange-50 font-bold rounded-lg shrink-0 shadow-sm"
                >
                  Call Unit
                </a>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Arrival Auto-Trigger Banner at Patient */}
      <AnimatePresence>
        {arrivedBanner && !isTransitToHospital && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-green-600 text-white">
            <div className="max-w-md mx-auto px-4 py-3 flex items-center gap-3">
              <Target className="w-5 h-5 animate-ping-slow" />
              <div>
                <p className="font-bold text-sm">🎯 Arrived at Patient Location!</p>
                <p className="text-green-100 text-xs">Patient onboard · Select destination hospital…</p>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* In Transit to Hospital Banner */}
      <AnimatePresence>
        {isTransitToHospital && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-purple-700 text-white shadow-md">
            <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Building2 className="w-4 h-4 text-purple-200 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <p className="font-extrabold text-xs truncate">In Transit → {bestHosp?.hospital.name || 'Hospital ER'}</p>
                  <p className="text-purple-200 text-[11px]">
                    {distToTargetHospital !== null
                      ? `${formatDistance(distToTargetHospital)} to ER · ~${Math.max(1, Math.round(distToTargetHospital * 2.4))}m ETA`
                      : 'Navigating to hospital…'}
                  </p>
                </div>
              </div>
              <button
                onClick={completeHospitalHandover}
                disabled={!isNearHospital}
                title={isNearHospital ? "Complete ER Handover" : `Handover locked until arrival at hospital (${formatDistance(distToTargetHospital ?? undefined)} away)`}
                className={`py-1.5 px-3 text-xs font-black rounded-xl shrink-0 shadow-sm flex items-center gap-1.5 transition-all ${
                  isNearHospital
                    ? 'bg-emerald-500 hover:bg-emerald-600 text-white animate-pulse cursor-pointer'
                    : 'bg-white/15 text-purple-200 cursor-not-allowed border border-white/20 opacity-75'
                }`}
              >
                {isNearHospital ? (
                  <>
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Complete Handover
                  </>
                ) : (
                  <>
                    <span className="text-[10px]">🔒 Handover Locked</span>
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active En Route to Patient Banner */}
      <AnimatePresence>
        {activeEmerg && !isTransitToHospital && !arrivedBanner && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }}
            className="bg-brand-600 text-white">
            <div className="max-w-md mx-auto px-4 py-2.5 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2.5 min-w-0">
                <Navigation className="w-4 h-4 animate-pulse shrink-0" />
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">En Route to Patient → {activeEmerg.userName}</p>
                  {distanceKm !== null && (
                    <p className="text-red-100 text-xs">
                      {distanceKm < 1
                        ? `${Math.round(distanceKm * 1000)} m away`
                        : `${distanceKm.toFixed(1)} km away`}
                      {distanceKm < 0.5 && ' · Almost there!'}
                    </p>
                  )}
                </div>
              </div>
              <button
                onClick={() => setShowBackupModal(true)}
                className="btn-secondary py-1 px-2.5 text-[10px] bg-white/20 hover:bg-white/30 text-white border-white/30 font-bold rounded-lg flex items-center gap-1 shrink-0"
              >
                <Radio className="w-3 h-3" /> Backup
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="page-content">

        {/* ── ALERTS TAB ─────────────────────── */}
        {tab === 'alerts' && (
          <div>
            {/* Disabled Unit Status Banner */}
            {isFleetUnitDisabled && !hasActiveMission && (
              <div className="card p-5 bg-gradient-to-r from-gray-950 via-gray-900 to-gray-950 text-white shadow-xl border-2 border-red-500/50 rounded-3xl mb-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-2xl bg-red-500/20 border border-red-500/40 flex items-center justify-center text-2xl shrink-0 shadow-inner">
                      ⛔
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="badge bg-red-500 text-white text-[10px] font-black uppercase tracking-wider">
                          FLEET UNIT DISABLED
                        </span>
                        <span className="text-[10px] text-gray-400 font-semibold">Post-Handover Status</span>
                      </div>
                      <h3 className="font-extrabold text-base text-white mt-1">
                        {amb?.vehicleNo || 'Ambulance Unit'} is Disabled
                      </h3>
                      <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">
                        Patient has been successfully admitted to {lastHandoverHospital || 'Hospital ER'}. This unit is currently disabled from receiving emergency dispatches.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="pt-1">
                  <button
                    onClick={reEnableFleetUnit}
                    className="btn-primary w-full py-3 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-black rounded-2xl shadow-lg flex items-center justify-center gap-2"
                  >
                    <Power className="w-4 h-4 text-white" />
                    Re-Enable Fleet Unit (Go Online & Available)
                  </button>
                </div>
              </div>
            )}

            <div className="flex items-center justify-between mb-3">
              <p className="section-title mb-0">Live Alerts</p>
              {visibleAlerts.length > 0 && (
                <span className={`badge ${hasActiveMission ? 'badge-green font-bold' : isFleetUnitDisabled ? 'badge-gray font-bold' : 'badge-red animate-pulse'}`}>
                  {hasActiveMission ? '1 Active Mission' : isFleetUnitDisabled ? 'Unit Disabled' : `${visibleAlerts.length} in queue`}
                </span>
              )}
            </div>

            {/* Simultaneous Incidents AI Triage Banner */}
            {unassignedAlerts.length > 1 && !hasActiveMission && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl p-4 mb-4 flex items-start gap-3 shadow-sm">
                <div className="w-8 h-8 rounded-xl bg-amber-500 text-white flex items-center justify-center shrink-0 shadow-sm mt-0.5">
                  <Sparkles className="w-4 h-4" />
                </div>
                <div>
                  <p className="text-xs font-black text-amber-900 uppercase tracking-tight">
                    AI Dispatch Triage ({unassignedAlerts.length} Simultaneous Requests)
                  </p>
                  <p className="text-[11px] text-amber-800 mt-1 leading-relaxed">
                    AI suggests prioritizing <strong>{unassignedAlerts[0].userName}</strong> ({formatDistance(unassignedAlerts[0].distanceKm)} away, ~{unassignedAlerts[0].etaMins}m ETA) for minimum response time. You have full discretion to choose any patient below.
                  </p>
                </div>
              </div>
            )}

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
                  const isClosestUnassigned = !isMyAcceptedMission && unassignedAlerts.length > 0 && e.id === unassignedAlerts[0].id;
                  
                  return (
                    <motion.div
                      key={e.id}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      className={`alert-card transition-all ${
                        isMyAcceptedMission
                          ? 'border-2 border-green-500 bg-green-50/20 shadow-md ring-2 ring-green-400/20'
                          : isClosestUnassigned
                          ? 'border-2 border-brand-500 bg-brand-50/30 shadow-md ring-2 ring-brand-400/20'
                          : 'border border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-3">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap mb-1">
                            <span className="font-bold text-sm text-gray-900">{e.userName}</span>
                            {isMyAcceptedMission ? (
                              <span className="badge-green font-extrabold text-[10px] flex items-center gap-1">
                                <span className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
                                ACCEPTED (EN ROUTE)
                              </span>
                            ) : (
                              <>
                                {isClosestUnassigned && (
                                  <span className="badge bg-amber-500 text-white font-extrabold text-[10px] flex items-center gap-1">
                                    <Sparkles className="w-3 h-3" /> AI RECOMMENDED (CLOSEST)
                                  </span>
                                )}
                                <span className={e.classification === 'HIGH' ? 'badge-red' : 'badge-gray'}>{e.classification}</span>
                              </>
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

                      {/* Distance & GPS Proximity Pill */}
                      <div className={`flex items-center gap-2 mb-3 text-xs rounded-xl px-3 py-2.5 border ${
                        isClosestUnassigned
                          ? 'bg-brand-100/50 border-brand-200 text-brand-900'
                          : 'bg-gray-50 border-gray-100 text-gray-700'
                      }`}>
                        <Navigation className="w-3.5 h-3.5 text-brand-600 shrink-0" />
                        <div className="flex items-center gap-2 flex-1 flex-wrap">
                          <span className="font-extrabold text-gray-900">
                            {formatDistance(e.distanceKm)} away
                          </span>
                          <span className="text-gray-400 font-normal">·</span>
                          <span className="font-semibold text-brand-700">
                            Est. ETA: ~{e.etaMins ?? Math.max(1, Math.round((e.distanceKm ?? 1) * 2.4))} mins
                          </span>
                        </div>
                        <span className="ml-auto flex items-center gap-1 font-semibold text-gray-600 shrink-0">
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
                                isClosestUnassigned ? 'bg-brand-600 hover:bg-brand-700 shadow-md ring-2 ring-brand-500/20' : ''
                              } ${
                                hasActiveMission
                                  ? 'bg-gray-200 text-gray-400 cursor-not-allowed border-gray-200 hover:bg-gray-200 shadow-none'
                                  : ''
                              }`}
                            >
                              {hasActiveMission ? 'Occupied (Finish Current)' : `Accept Mission (${formatDistance(e.distanceKm)})`}
                            </button>
                            <button
                              onClick={() => declineEmergency(e)}
                              className="btn-secondary py-2.5 px-4 text-sm"
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
            <div className="flex items-center justify-between mb-3">
              <p className="section-title mb-0">Live Navigation & Tracking</p>
              {isTransitToHospital && (
                <span className="badge-purple text-[10px] font-black animate-pulse flex items-center gap-1">
                  <span className="w-1.5 h-1.5 bg-purple-600 rounded-full" />
                  IN TRANSIT TO HOSPITAL
                </span>
              )}
            </div>

            {activeEmerg ? (
              <>
                {isTransitToHospital ? (
                  <div className="mb-4 p-4 bg-gradient-to-r from-purple-50 to-brand-50 border border-purple-200/90 rounded-2xl space-y-3 shadow-xs">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-10 h-10 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-sm shrink-0">
                          <Building2 className="w-5 h-5" />
                        </div>
                        <div className="min-w-0">
                          <span className="badge-purple text-[9px] font-black uppercase tracking-wider">
                            Patient Onboard · Destination
                          </span>
                          <h3 className="font-extrabold text-sm text-gray-900 mt-0.5 truncate">
                            {bestHosp?.hospital.name || 'Hospital ER'}
                          </h3>
                          <p className="text-xs text-gray-500 truncate">
                            Patient: {activeEmerg.userName} ({activeEmerg.userBloodGroup || 'Blood Group N/A'})
                          </p>
                        </div>
                      </div>
                      <div className="text-right bg-white/90 backdrop-blur-xs p-2 rounded-xl border border-purple-100 shrink-0 shadow-2xs">
                        <p className="text-base font-black text-purple-700">
                          {formatDistance(distToTargetHospital || undefined)}
                        </p>
                        <p className="text-[10px] text-gray-400 font-bold">
                          ~{Math.max(1, Math.round((distToTargetHospital ?? 1) * 2.4))}m to ER
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <button
                        onClick={completeHospitalHandover}
                        className="btn-primary flex-1 py-2 text-xs bg-emerald-600 hover:bg-emerald-700 text-white font-black flex items-center justify-center gap-1.5 shadow-sm rounded-xl"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" /> Complete ER Handover (10m reached)
                      </button>
                      <button
                        onClick={() => setShowBackupModal(true)}
                        className="btn-secondary py-2 px-3 text-xs border-orange-200 text-orange-700 hover:bg-orange-50 font-bold flex items-center gap-1 rounded-xl shrink-0"
                      >
                        <Radio className="w-3.5 h-3.5 text-orange-600" /> Request Backup
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="flex items-center justify-between mb-4 p-3 bg-brand-50 rounded-xl border border-brand-100">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <AlertTriangle className="w-5 h-5 text-brand-600 shrink-0" />
                      <div className="min-w-0">
                        <p className="font-bold text-sm text-gray-900 truncate">Patient: {activeEmerg.userName}</p>
                        <p className="text-xs text-gray-500">{activeEmerg.userBloodGroup} Blood · {activeEmerg.userPhone}</p>
                      </div>
                    </div>
                    {distanceKm !== null && (
                      <div className="text-right shrink-0">
                        <p className="text-sm font-black text-brand-700">
                          {distanceKm < 1 ? `${Math.round(distanceKm * 1000)}m` : `${distanceKm.toFixed(1)}km`}
                        </p>
                        <p className="text-[10px] text-gray-400 font-semibold">to patient</p>
                      </div>
                    )}
                  </div>
                )}

                <MapView
                  center={
                    isTransitToHospital && bestHosp?.hospital.location
                      ? gps.location || bestHosp.hospital.location
                      : gps.location || activeEmerg.location
                  }
                  routePoints={
                    isTransitToHospital && bestHosp?.hospital.location && gps.location
                      ? [gps.location, bestHosp.hospital.location]
                      : !isTransitToHospital && gps.location && activeEmerg?.location
                      ? [gps.location, activeEmerg.location]
                      : undefined
                  }
                  markers={mapMarkers}
                  height="320px"
                  zoom={13}
                />

                <div className="mt-3 bg-gray-50 rounded-xl p-3 flex items-center justify-between gap-2 border border-gray-100 text-xs">
                  <div className="flex items-center gap-2">
                    <Target className="w-4 h-4 text-brand-600 shrink-0" />
                    <p className="text-gray-700 font-medium">
                      {isTransitToHospital && bestHosp
                        ? `Route active to ${bestHosp.hospital.name} (Auto-completes within 10m)`
                        : bestHosp
                        ? `Destination set to ${bestHosp.hospital.name}`
                        : 'En route to patient incident location'}
                    </p>
                  </div>
                  <button
                    onClick={() => setShowBackupModal(true)}
                    className="text-orange-600 hover:text-orange-700 font-bold flex items-center gap-1 text-[11px] shrink-0"
                  >
                    <Radio className="w-3 h-3" /> Fleet Backup
                  </button>
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
            {!hasActiveMission || !activeEmerg ? (
              <div className="card p-8 text-center space-y-4 bg-gray-50/80 border border-gray-100 rounded-2xl">
                <div className="w-16 h-16 bg-gray-100 text-gray-400 rounded-2xl flex items-center justify-center mx-auto shadow-inner">
                  <Building2 className="w-8 h-8" />
                </div>
                <div>
                  <h4 className="font-bold text-gray-800 text-base">No Active Mission Accepted</h4>
                  <p className="text-gray-500 text-xs max-w-sm mx-auto mt-1 leading-relaxed">
                    Hospital triage recommendations and live bed availability will automatically activate once you accept an emergency mission and lock onto the patient's location.
                  </p>
                </div>
                <button
                  onClick={() => setTab('alerts')}
                  className="btn-primary py-2.5 px-5 text-xs mx-auto inline-flex items-center gap-2"
                >
                  <Activity className="w-4 h-4" /> View Live Emergency Alerts ({unassignedAlerts.length})
                </button>
              </div>
            ) : sentAlert ? (
              <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="card p-6 space-y-4 bg-purple-50/70 border border-purple-200">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-12 h-12 bg-purple-600 text-white rounded-2xl flex items-center justify-center shadow-md shrink-0">
                      <Building2 className="w-6 h-6" />
                    </div>
                    <div className="min-w-0">
                      <span className="badge-purple text-[10px] font-black uppercase tracking-wider">Hospital Notified & In Transit</span>
                      <h3 className="font-extrabold text-base text-gray-900 mt-0.5 truncate">{bestHosp?.hospital.name}</h3>
                      <p className="text-xs text-gray-500">
                        Patient: {activeEmerg.userName} ({activeEmerg.userBloodGroup || 'Blood Group N/A'}) · {patientCount} patient{patientCount > 1 ? 's' : ''}
                      </p>
                    </div>
                  </div>
                  <div className="text-right bg-white p-2 rounded-xl border border-purple-100 shrink-0 shadow-2xs">
                    <p className="text-lg font-black text-purple-700">{formatDistance(distToTargetHospital || undefined)}</p>
                    <p className="text-[10px] text-gray-400 font-bold">~{Math.max(1, Math.round((distToTargetHospital ?? 1) * 2.4))}m to ER</p>
                  </div>
                </div>

                {voiceNote && (
                  <div className="bg-white rounded-xl p-3 border border-purple-100 text-left">
                    <p className="text-[10px] font-bold text-gray-400 uppercase mb-1">Voice Update Broadcasted to ER:</p>
                    <p className="text-xs text-gray-700 italic">"{voiceNote}"</p>
                  </div>
                )}

                <MapView
                  center={gps.location || bestHosp?.hospital.location || { lat: 13.0627, lng: 80.2545 }}
                  routePoints={
                    bestHosp?.hospital.location && gps.location
                      ? [gps.location, bestHosp.hospital.location]
                      : undefined
                  }
                  markers={mapMarkers}
                  height="220px"
                  zoom={13}
                />

                <div className="space-y-2 pt-1">
                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={completeHospitalHandover}
                      disabled={!isNearHospital}
                      className={`flex-1 py-3 text-xs font-black rounded-xl shadow-md flex items-center justify-center gap-1.5 transition-all ${
                        isNearHospital
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white animate-bounce cursor-pointer'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed border border-gray-200 opacity-80'
                      }`}
                    >
                      {isNearHospital ? (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-white" />
                          Complete ER Handover (At Hospital ER)
                        </>
                      ) : (
                        <>
                          <span>🔒 Handover Disabled ({formatDistance(distToTargetHospital ?? undefined)} from ER)</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setShowBackupModal(true)}
                      className="btn-secondary py-3 px-4 text-xs border-orange-200 text-orange-700 hover:bg-orange-50 font-bold rounded-xl flex items-center gap-1 shrink-0"
                    >
                      <Radio className="w-4 h-4 text-orange-600" /> Request Backup
                    </button>
                  </div>
                  
                  {!isNearHospital ? (
                    <div className="p-2.5 rounded-xl bg-purple-50 border border-purple-100 flex items-center gap-2 text-[11px] text-purple-800">
                      <span className="w-2 h-2 rounded-full bg-purple-500 animate-ping shrink-0" />
                      <span>
                        <strong>Handover Locked:</strong> Unlocks once the ambulance location matches {bestHosp?.hospital.name || 'the hospital ER'} (~10m).
                      </span>
                    </div>
                  ) : (
                    <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 flex items-center gap-2 text-[11px] text-emerald-800">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>
                        <strong>At Hospital ER:</strong> Ambulance GPS matches hospital location. Handover is unlocked.
                      </span>
                    </div>
                  )}
                </div>
              </motion.div>
            ) : (
              <>
                {/* Active Mission Header */}
                <div className="card p-4 bg-blue-50/70 border border-blue-200/80 rounded-2xl">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center text-blue-700">
                        <User className="w-5 h-5" />
                      </div>
                      <div>
                        <p className="font-bold text-gray-900 text-sm">{activeEmerg.userName} (Patient)</p>
                        <p className="text-xs text-gray-500">
                          Blood: <span className="font-semibold text-gray-700">{activeEmerg.userBloodGroup || 'Unknown'}</span> · AI suggestions calculated from patient's GPS
                        </p>
                      </div>
                    </div>
                    {arrivedBanner && (
                      <span className="badge-green text-[10px] font-bold px-2 py-1 flex items-center gap-1">
                        <Target className="w-3 h-3" /> Arrived at Scene
                      </span>
                    )}
                  </div>
                </div>

                {/* Voice Update */}
                <div className="card p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="section-title mb-0">Voice Update for Hospital</p>
                      <p className="text-xs text-gray-400">Speak patient details — transcribed and sent automatically</p>
                    </div>
                    {voiceCountDetected && (
                      <span className="badge-green text-[10px] font-bold">
                        👥 {patientCount} patient{patientCount > 1 ? 's' : ''} detected
                      </span>
                    )}
                  </div>

                  <div className={`flex items-center gap-3 p-3 rounded-xl border-2 transition-all ${
                    voice.isListening ? 'border-brand-400 bg-brand-50' : 'border-gray-100 bg-gray-50'
                  }`}>
                    <button
                      onClick={voice.isListening ? voice.stopListening : voice.startListening}
                      className={`w-12 h-12 rounded-full flex items-center justify-center transition-all shrink-0 ${
                        voice.isListening ? 'bg-brand-600 text-white animate-pulse shadow-brand' : 'bg-white text-gray-400 border border-gray-200'
                      }`}
                    >
                      {voice.isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-700">
                        {voice.isListening ? '🔴 Recording voice update…' : 'Tap to record message'}
                      </p>
                      {voiceNote
                        ? <p className="text-xs text-gray-600 mt-1 italic break-words">"{voiceNote}"</p>
                        : <p className="text-xs text-gray-400">e.g. "2 trauma casualties, 1 unconscious, O+ blood"</p>
                      }
                    </div>
                    {voiceNote && <Volume2 className="w-4 h-4 text-brand-600 shrink-0" />}
                  </div>

                  {/* Patient Count Adjuster */}
                  <div className="flex items-center justify-between bg-white border border-gray-100 p-2.5 rounded-xl text-xs">
                    <span className="font-semibold text-gray-700 flex items-center gap-1.5">
                      <User className="w-3.5 h-3.5 text-brand-600" /> Patient Count:
                    </span>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => setPatientCount(c => Math.max(1, c - 1))}
                        className="w-7 h-7 bg-gray-100 hover:bg-gray-200 text-gray-700 font-black rounded-lg flex items-center justify-center transition-colors"
                      >
                        -
                      </button>
                      <span className="font-extrabold text-sm text-gray-900 w-5 text-center">{patientCount}</span>
                      <button
                        onClick={() => setPatientCount(c => c + 1)}
                        className="w-7 h-7 bg-brand-600 hover:bg-brand-700 text-white font-black rounded-lg flex items-center justify-center transition-colors"
                      >
                        +
                      </button>
                    </div>
                  </div>
                </div>

                {/* AI Recommended Hospitals */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <div>
                      <p className="section-title mb-0">Hospitals Near Patient</p>
                      <p className="text-[11px] text-gray-400">Ranked by proximity to patient & emergency bed availability</p>
                    </div>
                    <span className="text-[10px] bg-gray-100 text-gray-600 px-2 py-0.5 rounded-full font-medium">
                      Select any hospital below
                    </span>
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
                      <p className="text-gray-400 text-sm">Evaluating closest hospitals from patient position…</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {recommendations.map((rec, idx) => {
                        const isAiTopPick = idx === 0;
                        const isSelectedByDriver = bestHosp?.hospital.uid === rec.hospital.uid;

                        return (
                          <motion.div
                            key={rec.hospital.uid}
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ delay: idx * 0.08 }}
                            onClick={() => setBestHosp(rec)}
                            className={`rounded-2xl border-2 p-4 cursor-pointer transition-all ${
                              isSelectedByDriver
                                ? 'border-brand-600 bg-brand-50/70 shadow-md ring-2 ring-brand-500/20'
                                : isAiTopPick
                                ? 'border-amber-300 bg-amber-50/30 hover:border-amber-400'
                                : 'border-gray-100 bg-white hover:border-gray-300'
                            }`}
                          >
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <div className="flex flex-wrap items-center gap-2 mb-1.5">
                                  {isAiTopPick && (
                                    <span className="inline-flex items-center gap-1 bg-amber-500 text-white text-[10px] font-black uppercase tracking-wider px-2.5 py-0.5 rounded-full shadow-xs">
                                      <Star className="w-3 h-3 fill-white" /> AI RECOMMENDED PICK (OPTIMAL)
                                    </span>
                                  )}
                                  {isSelectedByDriver && (
                                    <span className={`inline-flex items-center gap-1 text-[10px] font-bold px-2.5 py-0.5 rounded-full ${
                                      isAiTopPick
                                        ? 'bg-brand-600 text-white'
                                        : 'bg-blue-600 text-white'
                                    }`}>
                                      <CheckCircle className="w-3 h-3" />
                                      {isAiTopPick ? 'AI Pick Selected' : 'Driver Manual Selection'}
                                    </span>
                                  )}
                                  <span className="font-bold text-gray-900 text-sm">{rec.hospital.name}</span>
                                </div>
                                <p className="text-xs text-gray-500 mb-2">{rec.hospital.address}</p>
                                <div className="flex flex-wrap gap-1">
                                  {rec.reasons.map((r, i) => (
                                    <span key={i} className="text-xs bg-white/80 border border-gray-200/60 text-gray-700 px-2 py-0.5 rounded-full font-medium">
                                      {r}
                                    </span>
                                  ))}
                                </div>
                              </div>
                              <div className="text-right ml-3 shrink-0">
                                <div className="text-2xl font-black text-brand-700">{rec.score}</div>
                                <p className="text-[10px] text-gray-400 uppercase font-semibold">Triage Score</p>
                              </div>
                            </div>

                            <div className="mt-3 grid grid-cols-3 gap-2">
                              <div className="bg-white rounded-lg p-2 text-center border border-gray-100 shadow-2xs">
                                <Bed className="w-3.5 h-3.5 text-brand-500 mx-auto mb-0.5" />
                                <p className="text-xs font-bold">{rec.hospital.beds?.emergency?.available ?? '—'}</p>
                                <p className="text-[10px] text-gray-400">ER beds</p>
                              </div>
                              <div className="bg-white rounded-lg p-2 text-center border border-gray-100 shadow-2xs">
                                <Droplets className="w-3.5 h-3.5 text-red-500 mx-auto mb-0.5" />
                                <p className="text-xs font-bold">{rec.hospital.blood?.Opos ?? '—'}</p>
                                <p className="text-[10px] text-gray-400">O+ units</p>
                              </div>
                              <div className="bg-white rounded-lg p-2 text-center border border-gray-100 shadow-2xs">
                                <Wind className="w-3.5 h-3.5 text-blue-500 mx-auto mb-0.5" />
                                <p className="text-xs font-bold">{rec.hospital.oxygen?.cylinders ?? '—'}</p>
                                <p className="text-[10px] text-gray-400">O₂ cyl.</p>
                              </div>
                            </div>
                          </motion.div>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Map + Notify Button */}
                {bestHosp && (
                  <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                    <MapView
                      center={gps.location || bestHosp.hospital.location || activeEmerg?.location || { lat: 13.0627, lng: 80.2545 }}
                      routePoints={
                        bestHosp?.hospital.location && (gps.location || activeEmerg?.location)
                          ? [(gps.location || activeEmerg?.location)!, bestHosp.hospital.location]
                          : undefined
                      }
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

                <div className="flex items-center justify-between text-xs py-2 border-b border-gray-50">
                  <span className="text-gray-400 flex items-center gap-1.5 font-medium">
                    <Activity className="w-3.5 h-3.5 text-green-600" /> Operational Status
                  </span>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${
                      isFleetUnitDisabled
                        ? 'bg-gray-100 text-gray-700 font-bold border border-gray-300'
                        : hasActiveMission
                        ? 'badge-yellow font-bold'
                        : 'badge-green font-bold'
                    }`}>
                      {isFleetUnitDisabled ? '⛔ Disabled (Post-Handover)' : hasActiveMission ? 'On Mission (Dispatched)' : 'Available (Standby)'}
                    </span>
                    <button
                      onClick={isFleetUnitDisabled ? reEnableFleetUnit : () => updateAmbulanceStatus(firebaseUser!.uid, 'offline').then(() => setIsFleetUnitDisabled(true))}
                      className={`text-[10px] px-2.5 py-1 rounded-lg font-bold transition-colors ${
                        isFleetUnitDisabled
                          ? 'bg-emerald-600 hover:bg-emerald-700 text-white'
                          : 'bg-gray-200 hover:bg-gray-300 text-gray-700'
                      }`}
                    >
                      {isFleetUnitDisabled ? 'Re-Enable Unit' : 'Disable Unit'}
                    </button>
                  </div>
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

      {/* Visual Incoming Alert Pop-up Modal (Supports single and multiple simultaneous requests) */}
      <AnimatePresence>
        {showIncomingModal && unassignedAlerts.length > 0 && !activeEmerg && (
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
              className="w-full max-w-lg bg-white rounded-3xl overflow-hidden shadow-2xl border-2 border-brand-500 relative z-[10000] max-h-[90vh] flex flex-col"
              style={{ zIndex: 10000 }}
            >
              {/* Modal Top Header */}
              <div className="bg-brand-600 p-4 text-white flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2.5">
                  <motion.div animate={{ scale: [1, 1.15, 1] }} transition={{ repeat: Infinity, duration: 1.2 }}>
                    <AlertTriangle className="w-6 h-6 text-white fill-white/20" />
                  </motion.div>
                  <div>
                    <h2 className="font-black text-sm sm:text-base tracking-tight uppercase">
                      {unassignedAlerts.length > 1 ? `${unassignedAlerts.length} SIMULTANEOUS EMERGENCIES` : 'NEW EMERGENCY ALERT'}
                    </h2>
                    <p className="text-[11px] text-red-100 font-medium">
                      {unassignedAlerts.length > 1 ? 'Review proximity & select a patient to accept' : 'Immediate dispatch requested'}
                    </p>
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
                  <Volume2 className={`w-3.5 h-3.5 ${siren.isPlaying ? 'animate-bounce text-yellow-300' : 'text-white/60'}`} />
                  <span className="text-[10px]">{siren.isPlaying ? 'Siren On' : 'Silent'}</span>
                </button>
              </div>

              {/* Multi-alert recommendation banner */}
              {unassignedAlerts.length > 1 && (
                <div className="bg-amber-50 border-b border-amber-200 px-4 py-2.5 flex items-center gap-2 shrink-0">
                  <Sparkles className="w-4 h-4 text-amber-600 shrink-0" />
                  <p className="text-[11px] text-amber-900 leading-tight">
                    <strong>AI Recommendation:</strong> Prioritize <strong>{unassignedAlerts[0].userName}</strong> ({formatDistance(unassignedAlerts[0].distanceKm)} away, ~{unassignedAlerts[0].etaMins}m ETA) for minimum response time.
                  </p>
                </div>
              )}

              {/* Scrollable list of incoming emergency cards */}
              <div className="p-4 overflow-y-auto space-y-3 flex-1">
                {unassignedAlerts.map((e, idx) => {
                  const isClosest = idx === 0;
                  return (
                    <div
                      key={e.id}
                      className={`rounded-2xl p-4 transition-all border ${
                        isClosest
                          ? 'border-brand-500 bg-brand-50/40 shadow-sm ring-2 ring-brand-400/20'
                          : 'border-gray-200 bg-white hover:border-gray-300'
                      }`}
                    >
                      <div className="flex items-start justify-between mb-2">
                        <div>
                          <div className="flex items-center gap-1.5 flex-wrap">
                            {isClosest && (
                              <span className="badge bg-amber-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full flex items-center gap-1">
                                <Sparkles className="w-3 h-3" /> AI RECOMMENDED (CLOSEST)
                              </span>
                            )}
                            <span className="badge-red text-[10px] font-bold">
                              {formatDistance(e.distanceKm)} AWAY · ~{e.etaMins}m ETA
                            </span>
                          </div>
                          <p className="text-base font-black text-gray-900 mt-1">{e.userName}</p>
                          <p className="text-xs text-gray-500 font-medium">{e.userBloodGroup} Blood · {e.userPhone}</p>
                        </div>

                        <div className="text-right shrink-0">
                          <div className="text-xl font-black text-brand-700">{e.confidenceScore}%</div>
                          <p className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">AI Score</p>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2 text-[11px] text-gray-600 bg-white/80 p-2.5 rounded-xl border border-gray-100 mb-3">
                        <div>
                          <span className="text-gray-400 block font-medium">Distance:</span>
                          <strong className="text-gray-900">{formatDistance(e.distanceKm)}</strong>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">Est. ETA:</span>
                          <strong className="text-brand-600">~{e.etaMins} mins</strong>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">Max Shake:</span>
                          <span className="font-semibold text-gray-800">{e.sensorData?.maxShakeMagnitude?.toFixed(1) || '0'} m/s²</span>
                        </div>
                        <div>
                          <span className="text-gray-400 block font-medium">Stillness:</span>
                          <span className="font-semibold text-gray-800">{e.sensorData?.stillnessDuration?.toFixed(1) || '0'}s</span>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button
                          onClick={() => declineEmergency(e)}
                          className="btn-secondary py-2.5 text-xs font-semibold px-3 text-gray-600 hover:text-gray-800 border-gray-200"
                        >
                          Decline
                        </button>
                        <button
                          onClick={() => acceptEmergency(e)}
                          className={`btn-primary flex-1 py-2.5 text-xs font-bold justify-center ${
                            isClosest ? 'bg-brand-600 hover:bg-brand-700 shadow-md ring-2 ring-brand-500/20' : ''
                          }`}
                        >
                          Accept Patient ({formatDistance(e.distanceKm)})
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Modal Footer */}
              <div className="p-3 bg-gray-50 border-t border-gray-100 flex justify-between items-center text-xs shrink-0">
                <p className="text-[11px] text-gray-500">
                  {unassignedAlerts.length} total request{unassignedAlerts.length > 1 ? 's' : ''} in queue
                </p>
                <button
                  onClick={() => {
                    siren.stop();
                    setShowIncomingModal(false);
                  }}
                  className="btn-ghost py-1.5 px-3 text-xs font-semibold text-gray-600 hover:text-gray-900"
                >
                  Review on Alerts Tab →
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── FLEET BACKUP & MUTUAL AID MODAL ── */}
      <AnimatePresence>
        {showBackupModal && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0, y: 15 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 15 }}
              className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-5 space-y-4 border border-gray-100"
            >
              <div className="flex items-center justify-between pb-3 border-b border-gray-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-9 h-9 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center">
                    <Radio className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-extrabold text-sm text-gray-900">Request Fleet Backup</h3>
                    <p className="text-xs text-gray-400">Notify other ambulances in Chennai</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowBackupModal(false)}
                  className="p-1.5 rounded-full text-gray-400 hover:text-gray-600 hover:bg-gray-100"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              {backupSuccess ? (
                <div className="p-5 bg-green-50 border border-green-200 rounded-2xl text-center space-y-2">
                  <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto" />
                  <p className="font-extrabold text-sm text-green-900">Backup Alert Broadcasted!</p>
                  <p className="text-xs text-green-700">All available units in the fleet network have received your request.</p>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-bold text-gray-700 mb-2">
                      Select Backup Reason:
                    </label>
                    <div className="space-y-1.5">
                      {[
                        'Extra Ambulance Needed (Multi-Casualty)',
                        'Critical Patient CPR / Medical Escort Support',
                        'Vehicle Breakdown / Road Obstruction Assistance',
                        'Route Assistance / Traffic Detour Escort',
                      ].map(r => (
                        <button
                          key={r}
                          type="button"
                          onClick={() => setBackupReason(r)}
                          className={`w-full text-left p-2.5 rounded-xl border text-xs font-semibold transition-all ${
                            backupReason === r
                              ? 'border-orange-500 bg-orange-50/80 text-orange-900 font-bold'
                              : 'border-gray-200 bg-gray-50 text-gray-700 hover:bg-gray-100'
                          }`}
                        >
                          {r}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Nearby Free Units List */}
                  <div>
                    <p className="text-xs font-bold text-gray-700 mb-1.5 flex items-center justify-between">
                      <span>Nearby Standby Ambulances</span>
                      <span className="badge-green text-[9px] font-bold">{freeAmbulanceCount} Available</span>
                    </p>
                    <div className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                      {otherFleetAmbulances.filter(a => !busyAmbulanceUids.has(a.uid) && a.status !== 'on_mission').length === 0 ? (
                        <p className="text-xs text-gray-400 italic p-2 bg-gray-50 rounded-xl text-center">No other standby units in immediate range</p>
                      ) : (
                        otherFleetAmbulances.filter(a => !busyAmbulanceUids.has(a.uid) && a.status !== 'on_mission').map(u => {
                          const dist = gps.location && u.location
                            ? haversineKm(gps.location.lat, gps.location.lng, u.location.lat, u.location.lng)
                            : null;
                          return (
                            <div key={u.uid} className="flex items-center justify-between p-2 bg-gray-50 rounded-xl border border-gray-100 text-xs">
                              <div>
                                <p className="font-bold text-gray-900">{u.vehicleNo}</p>
                                <p className="text-[10px] text-gray-500">{u.driverName} ({dist ? formatDistance(dist) : 'Nearby'})</p>
                              </div>
                              {u.phone ? (
                                <a
                                  href={`tel:${u.phone}`}
                                  className="btn-primary py-1 px-2.5 text-[11px] bg-green-600 hover:bg-green-700 text-white font-bold rounded-lg flex items-center gap-1 shadow-xs"
                                >
                                  <Phone className="w-3 h-3" /> Call
                                </a>
                              ) : (
                                <span className="text-[10px] text-gray-400">Online</span>
                              )}
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>

                  <div className="flex gap-2 pt-2 border-t border-gray-100">
                    <button
                      type="button"
                      onClick={() => setShowBackupModal(false)}
                      className="btn-secondary flex-1 py-2.5 text-xs font-bold"
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      onClick={handleSendBackupRequest}
                      disabled={sendingBackup}
                      className="btn-primary flex-1 py-2.5 text-xs bg-orange-600 hover:bg-orange-700 text-white font-black flex items-center justify-center gap-1.5 shadow-md"
                    >
                      {sendingBackup ? (
                        <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                      ) : (
                        <>
                          <Radio className="w-3.5 h-3.5" /> Broadcast to Fleet
                        </>
                      )}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
