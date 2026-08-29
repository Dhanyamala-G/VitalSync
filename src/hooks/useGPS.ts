// ─────────────────────────────────────────────
//  useGPS — Real-time GPS Location Hook
// ─────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import type { Location } from '../types';

interface GPSState {
  location:     Location | null;
  error:        string   | null;
  loading:      boolean;
  accuracy:     number   | null;
}

export function useGPS(enabled = true): GPSState {
  const [state, setState] = useState<GPSState>({
    location: null, error: null, loading: false, accuracy: null,
  });
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    if (!navigator.geolocation) {
      setState(s => ({ ...s, error: 'Geolocation not supported' }));
      return;
    }

    setState(s => ({ ...s, loading: true }));

    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        setState({
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
            timestamp: Date.now(),
          },
          error:    null,
          loading:  false,
          accuracy: pos.coords.accuracy,
        });
      },
      (err) => {
        setState(s => ({ ...s, error: err.message, loading: false }));
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );

    return () => {
      if (watchId.current !== null)
        navigator.geolocation.clearWatch(watchId.current);
    };
  }, [enabled]);

  return state;
}
