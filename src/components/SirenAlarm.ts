// ─────────────────────────────────────────────
//  SirenAlarm — Ambulance notification alarm
//  Plays a loud, looping ambulance siren using Web Audio API + Speech Alert
// ─────────────────────────────────────────────
import { useCallback, useRef, useState } from 'react';

export function useSirenAlarm() {
  const ctx = useRef<AudioContext | null>(null);
  const isPlayingRef = useRef(false);
  const loopTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);

  const stop = useCallback(() => {
    isPlayingRef.current = false;
    setIsPlaying(false);
    if (loopTimerRef.current) {
      clearInterval(loopTimerRef.current);
      loopTimerRef.current = null;
    }
    if (ctx.current) {
      try {
        ctx.current.close();
      } catch {
        // ignore
      }
      ctx.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }, []);

  const playSirenCycle = useCallback((audioCtx: AudioContext) => {
    if (!isPlayingRef.current) return;
    try {
      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      const now = audioCtx.currentTime;
      
      // Tone 1: High tone (960Hz) - loud sawtooth ambulance tone
      const osc1 = audioCtx.createOscillator();
      const gain1 = audioCtx.createGain();
      osc1.type = 'sawtooth';
      osc1.frequency.setValueAtTime(960, now);
      gain1.gain.setValueAtTime(0.4, now);
      gain1.gain.setValueAtTime(0.4, now + 0.45);
      gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.48);
      osc1.connect(gain1);
      gain1.connect(audioCtx.destination);
      osc1.start(now);
      osc1.stop(now + 0.5);

      // Tone 2: Low tone (770Hz)
      const osc2 = audioCtx.createOscillator();
      const gain2 = audioCtx.createGain();
      osc2.type = 'sawtooth';
      osc2.frequency.setValueAtTime(770, now + 0.5);
      gain2.gain.setValueAtTime(0.4, now + 0.5);
      gain2.gain.setValueAtTime(0.4, now + 0.95);
      gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.98);
      osc2.connect(gain2);
      gain2.connect(audioCtx.destination);
      osc2.start(now + 0.5);
      osc2.stop(now + 1.0);
    } catch (e) {
      console.warn('Siren audio error:', e);
    }
  }, []);

  const play = useCallback((withVoice = true) => {
    if (isPlayingRef.current) return;
    isPlayingRef.current = true;
    setIsPlaying(true);

    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const audioCtx = new AudioCtx();
      ctx.current = audioCtx;

      if (audioCtx.state === 'suspended') {
        audioCtx.resume();
      }

      // Play immediate first cycle
      playSirenCycle(audioCtx);

      // Loop every 1 second continuously until stopped
      loopTimerRef.current = setInterval(() => {
        if (isPlayingRef.current && ctx.current) {
          playSirenCycle(ctx.current);
        }
      }, 1000);

      // Voice announcement
      if (withVoice && typeof window !== 'undefined' && 'speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
          const utterance = new SpeechSynthesisUtterance("Emergency alert received. Immediate dispatch requested.");
          utterance.rate = 1.0;
          utterance.pitch = 1.1;
          utterance.volume = 1.0;
          utterance.lang = 'en-US';
          window.speechSynthesis.speak(utterance);
        } catch {
          // ignore
        }
      }
    } catch (e) {
      console.warn('Failed to start siren alarm:', e);
    }
  }, [playSirenCycle]);

  return { play, stop, isPlaying };
}
