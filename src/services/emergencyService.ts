// ─────────────────────────────────────────────
//  Emergency Service — Firestore CRUD
// ─────────────────────────────────────────────
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, where, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Emergency, HospitalAlert, AmbulanceProfile } from '../types';
import { haversineKm } from './aiService';

// Helper to safely get milliseconds from Firestore timestamp, number, or Date
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function getTimestampMillis(val: any): number {
  if (!val) return Date.now();
  if (typeof val === 'number') return val;
  if (typeof val.toMillis === 'function') return val.toMillis();
  if (val.seconds !== undefined) return val.seconds * 1000;
  const parsed = new Date(val).getTime();
  return isNaN(parsed) ? Date.now() : parsed;
}

// ── Emergencies ───────────────────────────────
export async function createEmergency(data: Omit<Emergency, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'emergencies'), {
    ...data,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateEmergency(id: string, data: Partial<Emergency>): Promise<void> {
  await updateDoc(doc(db, 'emergencies', id), data);
}

export function subscribeToEmergencies(
  callback: (emergencies: Emergency[]) => void,
) {
  // BULLETPROOF: Query all and filter client-side to bypass all Firestore index limits
  const q = query(collection(db, 'emergencies'));
  return onSnapshot(q, (snap) => {
    const list = snap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          timestamp: getTimestampMillis(data.timestamp),
        } as Emergency;
      })
      .filter(e => ['confirmed', 'dispatched', 'en_route'].includes(e.status));
      
    // Sort by timestamp descending
    list.sort((a, b) => b.timestamp - a.timestamp);
    callback(list);
  }, (error) => {
    console.error("subscribeToEmergencies query error:", error);
  });
}
export function subscribeToEmergency(id: string, callback: (e: Emergency | null) => void) {
  return onSnapshot(doc(db, 'emergencies', id), (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const data = snap.data();
    callback({
      id: snap.id,
      ...data,
      timestamp: getTimestampMillis(data.timestamp),
    } as Emergency);
  });
}

// ── Check Existing Nearby Active Emergencies ────
export async function getActiveNearbyBystanderEmergencies(
  lat: number,
  lng: number,
  radiusKm = 0.5 // 500 meters
): Promise<{ emergency: Emergency; distanceMeters: number }[]> {
  try {
    const snap = await getDocs(collection(db, 'emergencies'));
    const now = Date.now();
    const list: { emergency: Emergency; distanceMeters: number }[] = [];

    snap.docs.forEach(d => {
      const data = d.data();
      const ts = getTimestampMillis(data.timestamp);
      // Active emergency in progress within last 60 minutes
      if (
        ['triggered', 'confirmed', 'dispatched'].includes(data.status) &&
        Math.abs(now - ts) < 60 * 60 * 1000 &&
        data.location &&
        typeof data.location.lat === 'number' &&
        typeof data.location.lng === 'number'
      ) {
        const distKm = haversineKm(lat, lng, data.location.lat, data.location.lng);
        if (distKm <= radiusKm) {
          list.push({
            emergency: {
              id: d.id,
              ...data,
              timestamp: ts,
            } as Emergency,
            distanceMeters: Math.round(distKm * 1000),
          });
        }
      }
    });

    return list.sort((a, b) => a.distanceMeters - b.distanceMeters);
  } catch (err) {
    console.error('Failed to query nearby emergencies:', err);
    return [];
  }
}

// ── Ambulances ────────────────────────────────
export async function updateAmbulanceLocation(uid: string, lat: number, lng: number): Promise<void> {
  await updateDoc(doc(db, 'users', uid), {
    'location.lat': lat,
    'location.lng': lng,
    'location.timestamp': Date.now(),
  });
}

export async function updateAmbulanceStatus(uid: string, status: AmbulanceProfile['status']): Promise<void> {
  await updateDoc(doc(db, 'users', uid), { status });
}

export function subscribeToAmbulances(callback: (ambulances: AmbulanceProfile[]) => void) {
  const q = query(collection(db, 'users'), where('role', '==', 'ambulance'));
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ uid: d.id, ...d.data() } as AmbulanceProfile)));
  });
}

// ── Hospitals ─────────────────────────────────
export async function fetchHospitals() {
  const q     = query(collection(db, 'users'), where('role', '==', 'hospital'));
  const snap  = await getDocs(q);
  return snap.docs.map(d => ({ uid: d.id, ...d.data() }));
}

// ── Hospital Alerts ───────────────────────────
export async function createHospitalAlert(data: Omit<HospitalAlert, 'id'>): Promise<string> {
  const ref = await addDoc(collection(db, 'hospital_alerts'), {
    ...data,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateHospitalAlert(id: string, data: Partial<HospitalAlert>): Promise<void> {
  await updateDoc(doc(db, 'hospital_alerts', id), data);
}

export async function markPatientTreatedAndDismissAlert(
  alertId: string,
  emergencyId: string,
  report: import('../types').PatientTreatmentReport
): Promise<void> {
  // Update hospital alert to 'treated' with complete patient treatment report attached
  await updateDoc(doc(db, 'hospital_alerts', alertId), {
    status: 'treated',
    treatedAt: Date.now(),
    treatmentReport: report,
  });

  // Resolve and archive emergency in emergencies collection
  if (emergencyId) {
    try {
      await updateDoc(doc(db, 'emergencies', emergencyId), {
        status: 'resolved',
        resolvedAt: Date.now(),
        treatmentReport: report,
      });
    } catch (e) {
      console.warn("Could not update emergency status on treatment:", e);
    }
  }
}

export function subscribeToHospitalAlerts(
  hospitalId: string,
  hospitalNameOrCallback: string | ((alerts: HospitalAlert[]) => void),
  maybeCallback?: (alerts: HospitalAlert[]) => void,
) {
  const hospitalName = typeof hospitalNameOrCallback === 'string' ? hospitalNameOrCallback : undefined;
  const callback = typeof hospitalNameOrCallback === 'function' ? hospitalNameOrCallback : maybeCallback!;

  // BULLETPROOF: Query all and filter client-side to bypass all Firestore index limits
  const q = query(collection(db, 'hospital_alerts'));
  return onSnapshot(q, (snap) => {
    const list = snap.docs
      .map(d => {
        const data = d.data();
        return {
          id: d.id,
          ...data,
          timestamp: getTimestampMillis(data.timestamp),
        } as HospitalAlert;
      })
      .filter(a => {
        if (a.hospitalId === hospitalId) return true;
        const targetName = hospitalName?.toLowerCase().trim();
        const alertName = a.hospitalName?.toLowerCase().trim();
        if (targetName && alertName) {
          if (alertName.includes(targetName) || targetName.includes(alertName)) return true;
          const firstWord = targetName.split(' ')[0];
          if (firstWord.length > 3 && alertName.includes(firstWord)) return true;
        }
        // Specific alias matching for Saveetha Medical College & Hospital
        const isSaveethaTarget = hospitalId.toLowerCase().includes('saveetha') || targetName?.includes('saveetha');
        const isSaveethaAlert = a.hospitalId.toLowerCase().includes('saveetha') || alertName?.includes('saveetha');
        if (isSaveethaTarget && isSaveethaAlert) return true;

        return false;
      });
      
    // Sort by timestamp descending
    list.sort((a, b) => b.timestamp - a.timestamp);
    callback(list);
  }, (error) => {
    console.error("subscribeToHospitalAlerts query error:", error);
  });
}

export async function createAmbulanceBackupRequest(data: {
  ambulanceId: string;
  vehicleNo: string;
  driverName: string;
  phone: string;
  location: { lat: number; lng: number };
  reason: string;
  emergencyId?: string | null;
}): Promise<string> {
  const ref = await addDoc(collection(db, 'ambulance_backup_requests'), {
    ...data,
    status: 'active',
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export function subscribeToAmbulanceBackupRequests(
  callback: (requests: any[]) => void
) {
  const q = query(collection(db, 'ambulance_backup_requests'));
  return onSnapshot(q, (snap) => {
    const list = snap.docs
      .map(d => ({
        id: d.id,
        ...d.data(),
        timestamp: getTimestampMillis(d.data().timestamp),
      }))
      .filter((r: any) => r.status === 'active');
    list.sort((a: any, b: any) => b.timestamp - a.timestamp);
    callback(list);
  }, (error) => {
    console.error("subscribeToAmbulanceBackupRequests query error:", error);
  });
}
