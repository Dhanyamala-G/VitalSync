// ─────────────────────────────────────────────
//  Firebase Configuration — VitalSync
// ─────────────────────────────────────────────
//  Replace the values below with your Firebase project config.
//  Steps:
//   1. Go to https://console.firebase.google.com
//   2. Create a new project "vitalsync"
//   3. Add a Web App
//   4. Copy the firebaseConfig object here
//   5. Enable: Authentication (Email/Password) + Firestore Database
// ─────────────────────────────────────────────

import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY            || 'YOUR_API_KEY',
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN        || 'YOUR_PROJECT.firebaseapp.com',
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID         || 'YOUR_PROJECT_ID',
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET     || 'YOUR_PROJECT.appspot.com',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID || 'YOUR_SENDER_ID',
  appId:             import.meta.env.VITE_FIREBASE_APP_ID             || 'YOUR_APP_ID',
};

// Safe diagnostic logging to troubleshoot Vercel deployment variable injection
const apiKeyVal = firebaseConfig.apiKey;
console.log("Firebase Init Diagnostics:");
console.log("  - API Key loaded:", apiKeyVal !== 'YOUR_API_KEY' && !!apiKeyVal);
if (apiKeyVal && apiKeyVal !== 'YOUR_API_KEY') {
  console.log("  - API Key starts with:", apiKeyVal.substring(0, 6));
  console.log("  - API Key ends with:", apiKeyVal.substring(apiKeyVal.length - 4));
  console.log("  - API Key length:", apiKeyVal.length);
} else {
  console.warn("  - API Key is fallback 'YOUR_API_KEY' or empty!");
}

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const db   = getFirestore(app);
export default app;
