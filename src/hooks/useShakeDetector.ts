// ─────────────────────────────────────────────
//  useShakeDetector — Accelerometer Hook
//
//  🔧 DEMO MODE — Ultra-sensitive
//  Shake threshold : 1.5 m/s²  (barely any movement)
//  Min readings    : 1          (single reading triggers)
//  Stillness       : < 3 m/s² for 0.5s
//
//  For production: SHAKE_THRESHOLD=15, SHAKE_MIN_COUNT=3
// ─────────────────────────────────────────────
import { useEffect, useRef, useCallback, useState } from 'react';

export interface ShakeState {
  isShaking:        boolean;
  magnitude:        number;
  maxMagnitude:     number;
  isStill:          boolean;
  stillnessDuration: number; // seconds
  permissionGranted: boolean;
  requestPermission: () => Promise<boolean>;
}

// ── DEMO values — ultra-sensitive ─────────────
const SHAKE_THRESHOLD  = 1.5;  // m/s²  (single light flick triggers)
const SHAKE_MIN_COUNT  = 1;    // 1 reading is enough
const STILL_THRESHOLD  = 3.0;  // m/s²  (generous — easy to go still)
const STILL_MIN_SEC    = 0.5;  // seconds (half second of stillness)

export function useShakeDetector(
  onShake: (maxMagnitude: number) => void,
  onStillnessAfterShake: (duration: number) => void,
  enabled = true,
): ShakeState {
  const [state, setState] = useState<ShakeState>({
    isShaking: false,
    magnitude: 0,
    maxMagnitude: 0,
    isStill: false,
    stillnessDuration: 0,
    permissionGranted: false,
    requestPermission: async () => false,
  });

  const shakeCount        = useRef(0);
  const maxMag            = useRef(0);
  const hadShake          = useRef(false);
  const stillStart        = useRef<number | null>(null);
  const onShakeRef        = useRef(onShake);
  const onStillRef        = useRef(onStillnessAfterShake);

  onShakeRef.current = onShake;
  onStillRef.current = onStillnessAfterShake;

  const requestPermission = useCallback(async (): Promise<boolean> => {
    // iOS 13+ requires explicit permission
    if (
      typeof DeviceMotionEvent !== 'undefined' &&
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      typeof (DeviceMotionEvent as any).requestPermission === 'function'
    ) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const result = await (DeviceMotionEvent as any).requestPermission();
        const granted = result === 'granted';
        setState(s => ({ ...s, permissionGranted: granted }));
        return granted;
      } catch {
        return false;
      }
    }
    // Android / desktop — no permission needed
    setState(s => ({ ...s, permissionGranted: true }));
    return true;
  }, []);

  useEffect(() => {
    setState(s => ({ ...s, requestPermission }));
  }, [requestPermission]);

  useEffect(() => {
    if (!enabled) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      const acc = e.accelerationIncludingGravity;
      if (!acc) return;

      const { x = 0, y = 0, z = 0 } = acc;
      const mag = Math.sqrt((x ?? 0) ** 2 + (y ?? 0) ** 2 + (z ?? 0) ** 2);

      // ── Shake detection ────────────────────
      if (mag > SHAKE_THRESHOLD) {
        shakeCount.current += 1;
        if (mag > maxMag.current) maxMag.current = mag;

        if (shakeCount.current >= SHAKE_MIN_COUNT && !hadShake.current) {
          hadShake.current = true;
          stillStart.current = null;
          setState(s => ({
            ...s, isShaking: true, maxMagnitude: maxMag.current,
          }));
          onShakeRef.current(maxMag.current);
        }
      } else {
        shakeCount.current = Math.max(0, shakeCount.current - 1);
        if (shakeCount.current === 0 && state.isShaking) {
          setState(s => ({ ...s, isShaking: false }));
        }
      }

      // ── Stillness detection (after shake) ──
      if (hadShake.current && mag < STILL_THRESHOLD) {
        if (!stillStart.current) stillStart.current = Date.now();
        const secs = (Date.now() - stillStart.current) / 1000;
        setState(s => ({ ...s, isStill: true, stillnessDuration: secs, magnitude: mag }));
        if (secs >= STILL_MIN_SEC) {
          onStillRef.current(secs);
        }
      } else {
        if (state.isStill) setState(s => ({ ...s, isStill: false, stillnessDuration: 0 }));
        stillStart.current = null;
      }

      setState(s => ({ ...s, magnitude: mag }));
    };

    window.addEventListener('devicemotion', handleMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [enabled, state.isShaking, state.isStill]);

  return state;
}
