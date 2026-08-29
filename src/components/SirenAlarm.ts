// ─────────────────────────────────────────────
//  SirenAlarm — Ambulance notification alarm
//  Plays a loud siren using Web Audio API
//  (No external files needed)
// ─────────────────────────────────────────────
import { useCallback, useRef } from 'react';

export function useSirenAlarm() {
  const ctx    = useRef<AudioContext | null>(null);
  const nodes  = useRef<(OscillatorNode | GainNode)[]>([]);

  const play = useCallback(() => {
    if (ctx.current) { stop(); }
    const audioCtx = new AudioContext();
    ctx.current = audioCtx;

    const playTone = (freq1: number, freq2: number, start: number, duration: number) => {
      const osc  = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq1, audioCtx.currentTime + start);
      osc.frequency.linearRampToValueAtTime(freq2, audioCtx.currentTime + start + duration / 2);
      osc.frequency.linearRampToValueAtTime(freq1, audioCtx.currentTime + start + duration);

      gain.gain.setValueAtTime(0, audioCtx.currentTime + start);
      gain.gain.linearRampToValueAtTime(0.6, audioCtx.currentTime + start + 0.05);
      gain.gain.setValueAtTime(0.6, audioCtx.currentTime + start + duration - 0.05);
      gain.gain.linearRampToValueAtTime(0, audioCtx.currentTime + start + duration);

      osc.start(audioCtx.currentTime + start);
      osc.stop(audioCtx.currentTime + start + duration);
      nodes.current.push(osc, gain);
    };

    // Two-tone siren pattern, repeat 4 times
    for (let i = 0; i < 4; i++) {
      playTone(800, 1200, i * 1.0, 0.5);
      playTone(1200, 800, i * 1.0 + 0.5, 0.5);
    }
  }, []);

  const stop = useCallback(() => {
    nodes.current.forEach(n => {
      try { n.disconnect(); } catch { /* */ }
    });
    nodes.current = [];
    ctx.current?.close();
    ctx.current = null;
  }, []);

  return { play, stop };
}
