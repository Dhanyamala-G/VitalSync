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
import {
  encryptEmergencyPayload,
  decryptEmergencyPayload,
  encryptHospitalAlertPayload,
  decryptHospitalAlertPayload,
} from '../utils/crypto';

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
  // Cryptographically seal personal data, contacts, and GPS with 256-bit AES-GCM
  const securedPayload = await encryptEmergencyPayload(data);
  const ref = await addDoc(collection(db, 'emergencies'), {
    ...securedPayload,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateEmergency(id: string, data: Partial<Emergency>): Promise<void> {
  // If sensitive fields are updated, re-encrypt the payload envelope
  if (data.userName || data.userPhone || data.location || data.sensorData || data.emergencyContacts) {
    const secured = await encryptEmergencyPayload(data as Emergency);
    await updateDoc(doc(db, 'emergencies', id), secured);
  } else {
    await updateDoc(doc(db, 'emergencies', id), data);
  }
}

export function subscribeToEmergencies(
  callback: (emergencies: Emergency[]) => void,
) {
  // BULLETPROOF: Query all and filter client-side to bypass all Firestore index limits
  const q = query(collection(db, 'emergencies'));
  return onSnapshot(q, async (snap) => {
    try {
      const decryptedList = await Promise.all(
        snap.docs.map(async (d) => {
          const rawData = d.data();
          const parsedTs = getTimestampMillis(rawData.timestamp);
          const decrypted = await decryptEmergencyPayload({
            id: d.id,
            ...rawData,
            timestamp: parsedTs,
          });
          return decrypted;
        })
      );

      const filtered = decryptedList.filter(e => ['confirmed', 'dispatched', 'en_route'].includes(e.status));
      // Sort by timestamp descending
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      callback(filtered);
    } catch (err) {
      console.error("Error processing decrypted emergencies:", err);
    }
  }, (error) => {
    console.error("subscribeToEmergencies query error:", error);
  });
}

export function subscribeToEmergency(id: string, callback: (e: Emergency | null) => void) {
  return onSnapshot(doc(db, 'emergencies', id), async (snap) => {
    if (!snap.exists()) {
      callback(null);
      return;
    }
    const rawData = snap.data();
    const parsedTs = getTimestampMillis(rawData.timestamp);
    const decrypted = await decryptEmergencyPayload({
      id: snap.id,
      ...rawData,
      timestamp: parsedTs,
    });
    callback(decrypted);
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

    const parsedList = await Promise.all(
      snap.docs.map(async d => {
        const rawData = d.data();
        const ts = getTimestampMillis(rawData.timestamp);
        // Active emergency in progress within last 60 minutes
        if (
          !['triggered', 'confirmed', 'dispatched'].includes(rawData.status) ||
          Math.abs(now - ts) > 60 * 60 * 1000
        ) {
          return null;
        }

        const decrypted = await decryptEmergencyPayload({
          id: d.id,
          ...rawData,
          timestamp: ts,
        });

        if (
          decrypted.location &&
          typeof decrypted.location.lat === 'number' &&
          typeof decrypted.location.lng === 'number'
        ) {
          const distKm = haversineKm(lat, lng, decrypted.location.lat, decrypted.location.lng);
          if (distKm <= radiusKm) {
            return {
              emergency: decrypted,
              distanceMeters: Math.round(distKm * 1000),
            };
          }
        }
        return null;
      })
    );

    const validList = parsedList.filter((item): item is { emergency: Emergency; distanceMeters: number } => item !== null);
    return validList.sort((a, b) => a.distanceMeters - b.distanceMeters);
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
  // Cryptographically seal patient identity and triage audio note with 256-bit AES-GCM
  const securedPayload = await encryptHospitalAlertPayload(data);
  const ref = await addDoc(collection(db, 'hospital_alerts'), {
    ...securedPayload,
    timestamp: serverTimestamp(),
  });
  return ref.id;
}

export async function updateHospitalAlert(id: string, data: Partial<HospitalAlert>): Promise<void> {
  if (data.condition || data.patientName || data.patientBloodGroup || data.treatmentReport) {
    const secured = await encryptHospitalAlertPayload(data as HospitalAlert);
    await updateDoc(doc(db, 'hospital_alerts', id), secured);
  } else {
    await updateDoc(doc(db, 'hospital_alerts', id), data);
  }
}

export async function markHospitalAlertArrived(emergencyId: string): Promise<void> {
  try {
    const q = query(collection(db, 'hospital_alerts'), where('emergencyId', '==', emergencyId));
    const snap = await getDocs(q);
    for (const d of snap.docs) {
      if (d.data().status === 'en_route') {
        await updateDoc(doc(db, 'hospital_alerts', d.id), { status: 'arrived' });
      }
    }
  } catch (err) {
    console.warn('Could not update hospital alert to arrived:', err);
  }
}

export async function markPatientTreatedAndDismissAlert(
  alertId: string,
  emergencyId: string,
  report: import('../types').PatientTreatmentReport
): Promise<void> {
  // Update hospital alert to 'treated' with encrypted patient treatment report attached
  const securedAlertUpdate = await encryptHospitalAlertPayload({
    treatmentReport: report,
    status: 'treated',
  } as HospitalAlert);

  await updateDoc(doc(db, 'hospital_alerts', alertId), {
    ...securedAlertUpdate,
    status: 'treated',
    treatedAt: Date.now(),
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
  return onSnapshot(q, async (snap) => {
    try {
      const decryptedList = await Promise.all(
        snap.docs.map(async (d) => {
          const rawData = d.data();
          const parsedTs = getTimestampMillis(rawData.timestamp);
          const decrypted = await decryptHospitalAlertPayload({
            id: d.id,
            ...rawData,
            timestamp: parsedTs,
          });
          return decrypted;
        })
      );

      const filtered = decryptedList.filter(a => {
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
      filtered.sort((a, b) => b.timestamp - a.timestamp);
      callback(filtered);
    } catch (err) {
      console.error("Error processing decrypted hospital alerts:", err);
    }
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
    const now = Date.now();
    const twentyMinsAgo = now - 20 * 60 * 1000;
    const list = snap.docs
      .map(d => ({
        id: d.id,
        ...d.data(),
        timestamp: getTimestampMillis(d.data().timestamp),
      }))
      .filter((r: any) => r.status === 'active' && r.timestamp >= twentyMinsAgo);
    list.sort((a: any, b: any) => b.timestamp - a.timestamp);
    callback(list);
  }, (error) => {
    console.error("subscribeToAmbulanceBackupRequests query error:", error);
  });
}
