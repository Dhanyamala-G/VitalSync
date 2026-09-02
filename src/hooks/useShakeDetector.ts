// ─────────────────────────────────────────────
//  useShakeDetector — Accelerometer Hook
//
//  Delta-based High-Pass Filter:
//  Computes change between consecutive frames (curr - prev)
//  which eliminates static 9.8 m/s² gravity regardless of
//  device tilt, resting position, or refresh state.
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

// ── Sensor threshold constants ────────────────
const SHAKE_THRESHOLD = 18;   // m/s² — sensitive & responsive physical shaking
const SHAKE_MIN_COUNT = 2;    // 2 motion spikes across frames
const STILL_THRESHOLD = 1.5;  // m/s² — below this = truly still
const STILL_MIN_SEC   = 0.5;  // seconds of stillness to confirm
const COOLDOWN_MS     = 3000; // ms before shake can re-trigger
const WARMUP_MS       = 1500; // ms startup warmup: ignore initial browser sensor artifacts on refresh

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
    permissionGranted: true,
    requestPermission: async () => true,
  });

  const shakeCount    = useRef(0);
  const maxMag        = useRef(0);
  const hadShake      = useRef(false);
  const stillStart    = useRef<number | null>(null);
  const lastTrigger   = useRef<number>(0);
  const mountTime     = useRef<number>(Date.now());
  const prevAccel     = useRef<{ x: number; y: number; z: number }>({ x: 0, y: 0, z: 0 });
  const hasPrev       = useRef(false);

  const onShakeRef    = useRef(onShake);
  const onStillRef    = useRef(onStillnessAfterShake);

  onShakeRef.current = onShake;
  onStillRef.current = onStillnessAfterShake;

  const requestPermission = useCallback(async (): Promise<boolean> => {
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
    setState(s => ({ ...s, permissionGranted: true }));
    return true;
  }, []);

  useEffect(() => {
    setState(s => ({ ...s, requestPermission }));
  }, [requestPermission]);

  useEffect(() => {
    if (!enabled) return;

    mountTime.current = Date.now();
    hasPrev.current = false;
    shakeCount.current = 0;
    maxMag.current = 0;
    hadShake.current = false;

    const handleMotion = (e: DeviceMotionEvent) => {
      // 1. Warmup period: ignore initial events right after mount/refresh to prevent false triggers
      if (Date.now() - mountTime.current < WARMUP_MS) {
        return;
      }

      let mag = 0;

      // Primary: hardware-filtered linear acceleration (no gravity)
      if (e.acceleration && e.acceleration.x !== null && typeof e.acceleration.x === 'number') {
        const x = e.acceleration.x ?? 0;
        const y = e.acceleration.y ?? 0;
        const z = e.acceleration.z ?? 0;
        mag = Math.sqrt(x ** 2 + y ** 2 + z ** 2);
      } 
      // Secondary: delta-based high-pass filter over accelerationIncludingGravity
      else if (e.accelerationIncludingGravity && e.accelerationIncludingGravity.x !== null) {
        const currX = e.accelerationIncludingGravity.x ?? 0;
        const currY = e.accelerationIncludingGravity.y ?? 0;
        const currZ = e.accelerationIncludingGravity.z ?? 0;

        if (!hasPrev.current) {
          prevAccel.current = { x: currX, y: currY, z: currZ };
          hasPrev.current = true;
          return;
        }

        const deltaX = currX - prevAccel.current.x;
        const deltaY = currY - prevAccel.current.y;
        const deltaZ = currZ - prevAccel.current.z;
        prevAccel.current = { x: currX, y: currY, z: currZ };

        mag = Math.sqrt(deltaX ** 2 + deltaY ** 2 + deltaZ ** 2);
      } else {
        return;
      }

      // Filter out micro sensor noise
      if (mag < 1.0) mag = 0;

      setState(s => ({ ...s, magnitude: Math.round(mag * 10) / 10 }));

      // ── Shake Detection ───────────────────────────
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
          hadShake.current = true;
          lastTrigger.current = now;
          stillStart.current = null;

          setState(s => ({ ...s, isShaking: true, maxMagnitude: maxMag.current }));
          onShakeRef.current(maxMag.current);
        }
      } else {
        if (shakeCount.current > 0) shakeCount.current -= 1;
      }

      // ── Stillness Detection (after shake) ─────────
      if (hadShake.current && mag < STILL_THRESHOLD) {
        if (!stillStart.current) stillStart.current = Date.now();
        const secs = (Date.now() - stillStart.current) / 1000;

        setState(s => ({ ...s, isStill: true, stillnessDuration: secs }));

        if (secs >= STILL_MIN_SEC) {
          onStillRef.current(secs);
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
  }, [enabled]);

  return state;
}
