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
          const cred = await signInWithEmailAndPassword(auth, email, password);
          const snap = await getDoc(doc(db, 'users', cred.user.uid));
          if (snap.exists()) {
            const profile = snap.data() as Profile;
            set({ firebaseUser: cred.user, profile, role: profile.role, loading: false });
          }
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
