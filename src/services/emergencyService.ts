// ─────────────────────────────────────────────
//  Emergency Service — Firestore CRUD
// ─────────────────────────────────────────────
import {
  collection, doc, addDoc, updateDoc, onSnapshot,
  query, where, orderBy, serverTimestamp, getDocs,
} from 'firebase/firestore';
import { db } from '../firebase/config';
import type { Emergency, HospitalAlert, AmbulanceProfile } from '../types';

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
  const q = query(
    collection(db, 'emergencies'),
    where('status', 'in', ['triggered', 'confirmed', 'dispatched']),
    orderBy('timestamp', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as Emergency)));
  });
}

export function subscribeToEmergency(id: string, callback: (e: Emergency | null) => void) {
  return onSnapshot(doc(db, 'emergencies', id), (snap) => {
    callback(snap.exists() ? ({ id: snap.id, ...snap.data() } as Emergency) : null);
  });
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

export function subscribeToHospitalAlerts(
  hospitalId: string,
  callback: (alerts: HospitalAlert[]) => void,
) {
  const q = query(
    collection(db, 'hospital_alerts'),
    where('hospitalId', '==', hospitalId),
    orderBy('timestamp', 'desc'),
  );
  return onSnapshot(q, (snap) => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() } as HospitalAlert)));
  });
}
