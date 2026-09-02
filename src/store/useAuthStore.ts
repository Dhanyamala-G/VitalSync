// ─────────────────────────────────────────────
//  Auth Store — Zustand
// ─────────────────────────────────────────────
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as firebaseSignOut,
  onAuthStateChanged,
  type User,
} from 'firebase/auth';
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { auth, db } from '../firebase/config';
import type { UserRole, UserProfile, AmbulanceProfile, HospitalProfile } from '../types';

type Profile = UserProfile | AmbulanceProfile | HospitalProfile;

interface AuthState {
  firebaseUser:  User | null;
  profile:       Profile | null;
  role:          UserRole | null;
  loading:       boolean;
  error:         string | null;
  initialized:   boolean;

  signIn:        (email: string, password: string) => Promise<void>;
  signUp:        (email: string, password: string, role: UserRole, data: Partial<Profile>) => Promise<void>;
  signOut:       () => Promise<void>;
  setProfile:    (profile: Profile) => void;
  clearError:    () => void;
  initialize:    () => void;
}

function getDemoProfileByEmail(email: string): Partial<Profile> | null {
  const norm = email.toLowerCase().trim();
  if (norm.includes('saveetha')) {
    return {
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
    };
  }
  if (norm.includes('apollo')) {
    return {
      name: 'Apollo Hospitals Greams Road',
      address: '21 Greams Lane, Thousand Lights, Chennai - 600006',
      phone: '+91 044-28290200',
      location: { lat: 13.0604, lng: 80.2505 },
      specialties: ['Cardiology', 'Neurology', 'Orthopaedics', 'Emergency Medicine'],
      beds: {
        general:   { total: 200, available: 42 },
        icu:       { total: 30,  available: 8  },
        emergency: { total: 20,  available: 11 },
      },
      blood: { Apos: 15, Aneg: 5, Bpos: 12, Bneg: 4, Opos: 20, Oneg: 8, ABpos: 6, ABneg: 2 },
      oxygen: { cylinders: 45, piped: true },
      ventilators: 12,
      doctorsOnDuty: [
        { name: 'Dr. Ramesh Kumar',  specialty: 'Emergency Medicine' },
        { name: 'Dr. Priya Sundaram', specialty: 'Cardiology'         },
      ],
      role: 'hospital',
    };
  }
  if (norm.includes('tn01ab1234') || norm.includes('amb')) {
    return {
      driverName: 'Rajesh Singh',
      vehicleNo:  'TN01AB1234',
      vehicleType: 'ALS',
      phone: '+91 98765 43210',
      status: 'available',
      location: { lat: 13.0650, lng: 80.2560 },
      role: 'ambulance',
    };
  }
  if (norm.includes('priya') || norm.includes('user')) {
    return {
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
    };
  }
  return null;
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      firebaseUser:  null,
      profile:       null,
      role:          null,
      loading:       false,
      error:         null,
      initialized:   false,

      initialize: () => {
        onAuthStateChanged(auth, async (user) => {
          if (user) {
            try {
              const snap = await getDoc(doc(db, 'users', user.uid));
              if (snap.exists()) {
                const profile = snap.data() as Profile;
                set({ firebaseUser: user, profile, role: profile.role, initialized: true });
              } else {
                set({ firebaseUser: user, initialized: true });
              }
            } catch {
              set({ firebaseUser: user, initialized: true });
            }
          } else {
            set({ firebaseUser: null, profile: null, role: null, initialized: true });
          }
        });
      },

      signIn: async (email, password) => {
        set({ loading: true, error: null });
        try {
          let cred;
          try {
            cred = await signInWithEmailAndPassword(auth, email, password);
          } catch (signInErr: any) {
            // Auto-provision demo account if it does not yet exist in Firebase Auth
            const isDemo = email.toLowerCase().includes('.demo') || email.toLowerCase().includes('demo') || !!getDemoProfileByEmail(email);
            if (isDemo && (
              signInErr.code === 'auth/invalid-credential' ||
              signInErr.code === 'auth/user-not-found' ||
              signInErr.code === 'auth/wrong-password' ||
              signInErr.code === 'auth/invalid-login-credentials'
            )) {
              try {
                cred = await createUserWithEmailAndPassword(auth, email, password);
              } catch (createErr) {
                console.error("Auto-provision createUser failed:", createErr);
                throw signInErr;
              }
            } else {
              throw signInErr;
            }
          }

          const user = cred.user;
          let snap = await getDoc(doc(db, 'users', user.uid));
          
          // If Firestore profile document doesn't exist yet, auto-populate it
          if (!snap.exists()) {
            const demoData = getDemoProfileByEmail(email);
            const defaultRole: UserRole = email.includes('hosp') ? 'hospital' : email.includes('tn') ? 'ambulance' : 'user';
            const initialProfile: Profile = {
              uid: user.uid,
              email: user.email || email,
              role: (demoData?.role as UserRole) || defaultRole,
              createdAt: Date.now(),
              ...(demoData || {}),
            } as Profile;
            
            await setDoc(doc(db, 'users', user.uid), {
              ...initialProfile,
              createdAt: serverTimestamp(),
            });
            snap = await getDoc(doc(db, 'users', user.uid));
          }

          const profile = snap.data() as Profile;
          set({ firebaseUser: user, profile, role: profile.role, loading: false });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Sign in failed';
          set({ error: msg, loading: false });
          throw e;
        }
      },

      signUp: async (email, password, role, data) => {
        set({ loading: true, error: null });
        try {
          const cred = await createUserWithEmailAndPassword(auth, email, password);
          const profile: Profile = {
            uid: cred.user.uid,
            email,
            role,
            createdAt: Date.now(),
            ...data,
          } as Profile;
          await setDoc(doc(db, 'users', cred.user.uid), {
            ...profile,
            createdAt: serverTimestamp(),
          });
          set({ firebaseUser: cred.user, profile, role, loading: false });
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : 'Sign up failed';
          set({ error: msg, loading: false });
          throw e;
        }
      },

      signOut: async () => {
        await firebaseSignOut(auth);
        set({ firebaseUser: null, profile: null, role: null });
      },

      setProfile: (profile) => set({ profile }),
      clearError: ()          => set({ error: null }),
    }),
    {
      name: 'vitalsync-auth',
      partialize: (s) => ({ role: s.role }),
    }
  )
);
