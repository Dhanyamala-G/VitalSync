// ─────────────────────────────────────────────
//  Mock Data Seeder
//  Seeds Firestore with sample hospitals, ambulances, users
//  Run once from the app or Firebase console
// ─────────────────────────────────────────────
import { collection, addDoc, setDoc, doc, serverTimestamp } from 'firebase/firestore';
import { createUserWithEmailAndPassword } from 'firebase/auth';
import { auth, db } from '../firebase/config';

export const MOCK_HOSPITALS = [
  {
    name: 'Apollo Hospitals',
    address: '21 Greams Lane, Chennai - 600006',
    phone: '+91 044-28290200',
    location: { lat: 13.0627, lng: 80.2545 },
    specialties: ['Cardiology', 'Neurology', 'Trauma', 'Oncology'],
    beds: {
      general:   { total: 150, available: 42 },
      icu:       { total: 30,  available: 8  },
      emergency: { total: 20,  available: 12 },
    },
    blood: { Apos: 12, Aneg: 6, Bpos: 15, Bneg: 4, Opos: 20, Oneg: 8, ABpos: 6, ABneg: 3 },
    oxygen: { cylinders: 45, piped: true },
    ventilators: 12,
    doctorsOnDuty: [
      { name: 'Rajesh Sharma',  specialty: 'Cardiology' },
      { name: 'Priya Menon',    specialty: 'Neurology'  },
      { name: 'Arun Kumar',     specialty: 'Trauma'     },
    ],
    role: 'hospital',
  },
  {
    name: 'MIOT International',
    address: '4/112 Mount Poonamalle Road, Chennai - 600089',
    phone: '+91 044-22490900',
    location: { lat: 13.0462, lng: 80.1726 },
    specialties: ['Orthopaedics', 'Trauma', 'General Surgery', 'Cardiology'],
    beds: {
      general:   { total: 200, available: 78 },
      icu:       { total: 25,  available: 5  },
      emergency: { total: 15,  available: 9  },
    },
    blood: { Apos: 8, Aneg: 3, Bpos: 10, Bneg: 2, Opos: 18, Oneg: 5, ABpos: 4, ABneg: 2 },
    oxygen: { cylinders: 35, piped: true },
    ventilators: 8,
    doctorsOnDuty: [
      { name: 'Suresh Balaji',  specialty: 'Orthopaedics'   },
      { name: 'Kavitha Nair',   specialty: 'General Surgery' },
    ],
    role: 'hospital',
  },
  {
    name: 'Fortis Malar Hospital',
    address: '52 First Main Road, Adyar, Chennai - 600020',
    phone: '+91 044-42892222',
    location: { lat: 13.0050, lng: 80.2500 },
    specialties: ['Neurology', 'Cardiology', 'Paediatrics', 'Emergency Medicine'],
    beds: {
      general:   { total: 120, available: 31 },
      icu:       { total: 20,  available: 7  },
      emergency: { total: 12,  available: 6  },
    },
    blood: { Apos: 10, Aneg: 4, Bpos: 8, Bneg: 3, Opos: 14, Oneg: 6, ABpos: 5, ABneg: 2 },
    oxygen: { cylinders: 28, piped: true },
    ventilators: 6,
    doctorsOnDuty: [
      { name: 'Deepa Krishnan', specialty: 'Neurology'        },
      { name: 'Vikram Rajan',   specialty: 'Emergency Medicine'},
    ],
    role: 'hospital',
  },
  {
    name: 'Government General Hospital',
    address: 'Park Town, Chennai - 600003',
    phone: '+91 044-25305000',
    location: { lat: 13.0827, lng: 80.2707 },
    specialties: ['General Medicine', 'Trauma', 'Burns', 'Emergency Medicine', 'Psychiatry'],
    beds: {
      general:   { total: 500, available: 220 },
      icu:       { total: 60,  available: 18  },
      emergency: { total: 40,  available: 22  },
    },
    blood: { Apos: 30, Aneg: 10, Bpos: 25, Bneg: 8, Opos: 40, Oneg: 15, ABpos: 12, ABneg: 6 },
    oxygen: { cylinders: 120, piped: true },
    ventilators: 25,
    doctorsOnDuty: [
      { name: 'Muthu Kumar',    specialty: 'Emergency Medicine' },
      { name: 'Lakshmi Devi',   specialty: 'General Medicine'   },
      { name: 'Senthil Nathan', specialty: 'Burns'              },
    ],
    role: 'hospital',
  },
  {
    name: 'Saveetha Medical College and Hospital',
    address: 'Saveetha Nagar, Chennai-Bengaluru National Highway (NH 48), Thandalam, Kanchipuram / Chennai - 602105',
    phone: '+91 044-66726672',
    location: { lat: 13.0280, lng: 80.0165 },
    specialties: ['Medical College Hospital (Thandalam)', 'Advanced Level-1 Trauma', 'Cardio-Thoracic Surgery', 'Neurology', '24/7 Emergency ICU', 'Blood Bank'],
    beds: {
      general:   { total: 600, available: 145 },
      icu:       { total: 50,  available: 16  },
      emergency: { total: 35,  available: 18  },
    },
    blood: { Apos: 24, Aneg: 8, Bpos: 28, Bneg: 6, Opos: 36, Oneg: 12, ABpos: 10, ABneg: 4 },
    oxygen: { cylinders: 140, piped: true },
    ventilators: 30,
    doctorsOnDuty: [
      { name: 'Dr. S. K. Venkatesh', specialty: 'Medical College Professor & Trauma Lead (Thandalam)' },
      { name: 'Dr. Ananya Raman',   specialty: 'Critical Care & Emergency Medicine' },
    ],
    role: 'hospital',
  },
];

export const MOCK_AMBULANCES = [
  {
    driverName: 'Rajesh Singh',
    vehicleNo:  'TN01AB1234',
    vehicleType: 'ALS',
    phone: '+91 98765 43210',
    status: 'available',
    location: { lat: 13.0550, lng: 80.2450 },
    role: 'ambulance',
  },
  {
    driverName: 'Suresh Kumar',
    vehicleNo:  'TN09CD5678',
    vehicleType: 'BLS',
    phone: '+91 98765 43211',
    status: 'available',
    location: { lat: 13.0700, lng: 80.2600 },
    role: 'ambulance',
  },
];

export const MOCK_USERS = [
  {
    name: 'Priya Ramesh',
    age: 28,
    bloodGroup: 'O+',
    phone: '+91 99887 76655',
    conditions: ['Diabetes'],
    allergies: ['Penicillin'],
    medications: ['Metformin 500mg'],
    emergencyContacts: [
      { name: 'Ramesh Kumar', relation: 'Father', phone: '+91 99887 76600' },
    ],
    insuranceId: 'PNB-2024-XYZ',
    role: 'user',
  },
];

// ── Seed function ─────────────────────────────
export async function seedMockData(
  onProgress?: (msg: string) => void,
): Promise<void> {
  const log = (m: string) => { console.log(m); onProgress?.(m); };

  log('Seeding hospitals…');
  for (const h of MOCK_HOSPITALS) {
    try {
      // Create a Firebase Auth account for each hospital
      const email = h.name.toLowerCase().includes('saveetha')
        ? 'saveetha_hosp@vitalsync.demo'
        : `${h.name.toLowerCase().replace(/\s+/g, '')}_hosp@vitalsync.demo`;
      const password = 'Demo@1234';
      const cred     = await createUserWithEmailAndPassword(auth, email, password)
        .catch(() => null);
      const uid = cred?.user.uid || `hosp_${Date.now()}_${Math.random()}`;
      await setDoc(doc(db, 'users', uid), {
        ...h, uid, email,
        createdAt: serverTimestamp(),
      });
      log(`  ✓ ${h.name} (${email})`);
    } catch (e) {
      log(`  ⚠ ${h.name}: ${(e as Error).message}`);
    }
  }

  log('Seeding ambulances…');
  for (const a of MOCK_AMBULANCES) {
    try {
      const email    = `${a.vehicleNo.toLowerCase()}@vitalsync.demo`;
      const password = 'Demo@1234';
      const cred     = await createUserWithEmailAndPassword(auth, email, password)
        .catch(() => null);
      const uid = cred?.user.uid || `amb_${Date.now()}_${Math.random()}`;
      await setDoc(doc(db, 'users', uid), {
        ...a, uid, email,
        createdAt: serverTimestamp(),
      });
      log(`  ✓ ${a.vehicleNo}`);
    } catch (e) {
      log(`  ⚠ ${a.vehicleNo}: ${(e as Error).message}`);
    }
  }

  log('Seeding demo user…');
  for (const u of MOCK_USERS) {
    try {
      const email    = `${u.name.toLowerCase().replace(/\s+/g, '')}@vitalsync.demo`;
      const password = 'Demo@1234';
      const cred     = await createUserWithEmailAndPassword(auth, email, password)
        .catch(() => null);
      const uid = cred?.user.uid || `user_${Date.now()}`;
      await setDoc(doc(db, 'users', uid), {
        ...u, uid, email,
        createdAt: serverTimestamp(),
      });
      log(`  ✓ ${u.name}`);
    } catch (e) {
      log(`  ⚠ ${u.name}: ${(e as Error).message}`);
    }
  }

  // Seed a demo emergency for ambulance testing
  await addDoc(collection(db, 'emergencies'), {
    userId:          'demo_user',
    userName:        'Priya Ramesh',
    userPhone:       '+91 99887 76655',
    userBloodGroup:  'O+',
    location:        { lat: 13.0627, lng: 80.2545 },
    status:          'confirmed',
    classification:  'HIGH',
    confidenceScore: 82,
    sensorData:      { maxShakeMagnitude: 22.4, stillnessDuration: 5.2, audioLevel: 0.6 },
    timestamp:       serverTimestamp(),
  });

  log('✅ Mock data seeded successfully!');
  log('Demo credentials:');
  log('  User:      priyaramesh@vitalsync.demo / Demo@1234');
  log('  Ambulance: tn01ab1234@vitalsync.demo  / Demo@1234');
  log('  Saveetha:  saveetha_hosp@vitalsync.demo / Demo@1234');
  log('  Apollo:    apollohospitals_hosp@vitalsync.demo / Demo@1234');
}
