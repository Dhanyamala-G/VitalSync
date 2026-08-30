// ─────────────────────────────────────────────
//  useShakeDetector — Accelerometer Hook
//
//  🔧 DEMO MODE — Works on Android + iOS
//
//  FIX: Uses e.acceleration (WITHOUT gravity) not
//       accelerationIncludingGravity — gravity adds
//       9.8 m/s² at rest which always false-triggers.
//
//  Shake threshold : 5 m/s²   (quick flick, not idle noise)
//  Min readings    : 2         (two rapid readings)
//  Cooldown        : 3 seconds (won't re-trigger too fast)
//
//  For production: SHAKE_THRESHOLD = 15
// ─────────────────────────────────────────────
import { useEffect, useRef, useCallback, useState } from 'react';

export interface ShakeState {
  isShaking:         boolean;
  magnitude:         number;
  maxMagnitude:      number;
  isStill:           boolean;
  stillnessDuration: number;
  permissionGranted: boolean;
  requestPermission: () => Promise<boolean>;
}

// ── DEMO values ───────────────────────────────
const SHAKE_THRESHOLD = 40;   // m/s² — ultra hard deliberate shake needed
const SHAKE_MIN_COUNT = 2;    // 2 rapid readings above threshold
const STILL_THRESHOLD = 2.0;  // m/s² — below this = still
const STILL_MIN_SEC   = 0.5;  // seconds of stillness to confirm
const COOLDOWN_MS     = 3000; // ms before shake can re-trigger

export function useShakeDetector(
  onShake: (maxMagnitude: number) => void,
  onStillnessAfterShake: (duration: number) => void,
  enabled = true,
): ShakeState {
  const [state, setState] = useState<ShakeState>({
    isShaking:         false,
    magnitude:         0,
    maxMagnitude:      0,
    isStill:           false,
    stillnessDuration: 0,
    permissionGranted: true,  // Android doesn't need permission — start true
    requestPermission: async () => true,
  });

  const shakeCount    = useRef(0);
  const maxMag        = useRef(0);
  const hadShake      = useRef(false);
  const stillStart    = useRef<number | null>(null);
  const lastTrigger   = useRef<number>(0);   // cooldown tracker
  const onShakeRef    = useRef(onShake);
  const onStillRef    = useRef(onStillnessAfterShake);

  onShakeRef.current = onShake;
  onStillRef.current = onStillnessAfterShake;

  const requestPermission = useCallback(async (): Promise<boolean> => {
    // iOS 13+ only — Android grants automatically
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
    // Android / desktop — no permission needed, always granted
    setState(s => ({ ...s, permissionGranted: true }));
    return true;
  }, []);

  useEffect(() => {
    setState(s => ({ ...s, requestPermission }));
  }, [requestPermission]);

  useEffect(() => {
    if (!enabled) return;

    const handleMotion = (e: DeviceMotionEvent) => {
      // ── KEY FIX: use e.acceleration (no gravity) ──
      // accelerationIncludingGravity adds ~9.8 m/s² at rest
      // which would always exceed any threshold.
      // e.acceleration removes gravity so 0 = truly at rest.
      //
      // Fallback: if acceleration is unavailable (some older Android),
      // subtract gravity from accelerationIncludingGravity manually.
      let x = 0, y = 0, z = 0;

      if (e.acceleration && e.acceleration.x !== null) {
        x = e.acceleration.x ?? 0;
        y = e.acceleration.y ?? 0;
        z = e.acceleration.z ?? 0;
      } else if (e.accelerationIncludingGravity) {
        // Rough gravity removal (device upright): subtract 9.8 from z
        x = e.accelerationIncludingGravity.x ?? 0;
        y = e.accelerationIncludingGravity.y ?? 0;
        z = (e.accelerationIncludingGravity.z ?? 0) - 9.8;
      } else {
        return; // no sensor data at all
      }

      const mag = Math.sqrt(x ** 2 + y ** 2 + z ** 2);

      setState(s => ({ ...s, magnitude: mag }));

      // ── Shake detection ─────────────────────────
      if (mag > SHAKE_THRESHOLD) {
        shakeCount.current += 1;
        if (mag > maxMag.current) maxMag.current = mag;

        const now = Date.now();
        const cooldownPassed = now - lastTrigger.current > COOLDOWN_MS;

        if (
          shakeCount.current >= SHAKE_MIN_COUNT &&
          !hadShake.current &&
          cooldownPassed
        ) {
          hadShake.current  = true;
          lastTrigger.current = now;
          stillStart.current = null;

          setState(s => ({ ...s, isShaking: true, maxMagnitude: maxMag.current }));
          onShakeRef.current(maxMag.current);
        }
      } else {
        // Decay shake count when below threshold
        if (shakeCount.current > 0) shakeCount.current -= 1;
      }

      // ── Stillness detection (after shake) ───────
      if (hadShake.current && mag < STILL_THRESHOLD) {
        if (!stillStart.current) stillStart.current = Date.now();
        const secs = (Date.now() - stillStart.current) / 1000;

        setState(s => ({ ...s, isStill: true, stillnessDuration: secs }));

        if (secs >= STILL_MIN_SEC) {
          onStillRef.current(secs);
          // Reset so shake can trigger again after cooldown
          hadShake.current   = false;
          shakeCount.current = 0;
          maxMag.current     = 0;
          stillStart.current = null;
          setState(s => ({ ...s, isShaking: false, isStill: false, stillnessDuration: 0 }));
        }
      } else if (mag >= STILL_THRESHOLD) {
        stillStart.current = null;
      }
    };

    window.addEventListener('devicemotion', handleMotion, { passive: true });
    return () => window.removeEventListener('devicemotion', handleMotion);
  }, [enabled]);   // ← removed state deps that caused re-subscribe loop

  return state;
}
