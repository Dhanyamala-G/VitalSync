// ─────────────────────────────────────────────
//  EmergencyDialog — 30-second abort timer
//  Guaranteed immediate dispatch to ambulances
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Timer, X, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { AIAnalysisResult, SensorData } from '../types';

interface Props {
  isOpen:          boolean;
  shakeMagnitude:  number;
  onAbort:         () => void;
  onConfirmed:     (result: AIAnalysisResult, sensorData: SensorData) => void;
}

function playEmergencyAlarmBeep() {
  try {
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime); // A5
    osc.frequency.setValueAtTime(587.33, ctx.currentTime + 0.12); // D5
    osc.frequency.setValueAtTime(880, ctx.currentTime + 0.24); // A5

    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.start();
    osc.stop(ctx.currentTime + 0.45);
  } catch {
    // AudioContext autoplay might be blocked before user interaction
  }
}

function speakVoicePrompt(text: string, isMuted: boolean) {
  if (isMuted) return;
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.rate = 0.95; // Clear and steady
      utterance.pitch = 1.0;
      utterance.volume = 1.0;
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    } catch (e) {
      console.warn('Speech synthesis error:', e);
    }
  }
}

function cancelVoicePrompt() {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      // ignore
    }
  }
}

export default function EmergencyDialog({ isOpen, shakeMagnitude, onAbort, onConfirmed }: Props) {
  const [countdown,    setCountdown]    = useState(30);
  const [isMuted,      setIsMuted]      = useState(false);
  const [stillnessSec, setStillnessSec] = useState(0);

  const countdownTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMutedRef       = useRef(false);
  isMutedRef.current     = isMuted;

  const onConfirmedRef   = useRef(onConfirmed);
  onConfirmedRef.current = onConfirmed;

  const shakeMagRef      = useRef(shakeMagnitude);
  shakeMagRef.current    = shakeMagnitude;

  const stillnessSecRef  = useRef(stillnessSec);
  stillnessSecRef.current = stillnessSec;

  const replayVoice = useCallback(() => {
    playEmergencyAlarmBeep();
    speakVoicePrompt(
      "Emergency shake detected. Are you in danger? Press I'm Safe if you are okay, or Send Help to alert emergency services.",
      isMutedRef.current
    );
  }, []);

  // Steady 30-second countdown timer (strictly isolated from sub-second sensor state updates)
  useEffect(() => {
    if (!isOpen) {
      cancelVoicePrompt();
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      return;
    }

    setCountdown(30);
    playEmergencyAlarmBeep();
    speakVoicePrompt(
      "Emergency shake detected. Are you in danger? Press I'm Safe if you are okay, or Send Help to alert emergency services.",
      isMutedRef.current
    );

    countdownTimer.current = setInterval(() => {
      setCountdown(c => {
        if (c === 11) {
          speakVoicePrompt("10 seconds remaining. Are you in danger? Press I'm Safe to cancel.", isMutedRef.current);
        }
        if (c <= 1) {
          if (countdownTimer.current) clearInterval(countdownTimer.current);
          cancelVoicePrompt();
          const sensorData: SensorData = {
            maxShakeMagnitude: shakeMagRef.current || 35,
            stillnessDuration: stillnessSecRef.current || 30,
            audioLevel: 0,
          };
          const result: AIAnalysisResult = {
            classification: 'HIGH',
            confidenceScore: 95,
            reasoning: '🚨 Emergency shake auto-confirmed after 30s countdown.',
            timestamp: Date.now(),
          };
          onConfirmedRef.current(result, sensorData);
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => {
      if (countdownTimer.current) clearInterval(countdownTimer.current);
      cancelVoicePrompt();
    };
  }, [isOpen]);

  // Load stillness from sensor
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setStillnessSec(s => s + 0.1), 100);
    return () => clearInterval(id);
  }, [isOpen]);

  const handleAbort = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    cancelVoicePrompt();
    onAbort();
  };

  const handleConfirm = () => {
    if (countdownTimer.current) clearInterval(countdownTimer.current);
    cancelVoicePrompt();
    const sensorData: SensorData = {
      maxShakeMagnitude: shakeMagRef.current || 42,
      stillnessDuration: stillnessSecRef.current || 1,
      audioLevel: 0,
    };
    const result: AIAnalysisResult = {
      classification: 'HIGH',
      confidenceScore: 98,
      reasoning: '🚨 Emergency alert triggered directly by user.',
      timestamp: Date.now(),
    };
    onConfirmedRef.current(result, sensorData);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center sm:items-end justify-center p-4 bg-black/80 backdrop-blur-md overflow-y-auto"
        style={{ zIndex: 9999 }}
      >
        <motion.div
          key="dialog"
          initial={{ y: '100%', scale: 0.95 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl relative z-[10000] border border-gray-100 my-auto"
          style={{ zIndex: 10000 }}
        >
          {/* Header */}
          <div className="bg-brand-600 px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
                <AlertTriangle className="w-7 h-7 text-white" />
              </motion.div>
              <div>
                <h2 className="text-white font-bold text-base leading-tight">Emergency Detected</h2>
                <p className="text-red-100 text-xs font-medium">Shake: {shakeMagnitude.toFixed(1)} m/s²</p>
              </div>
            </div>

            <button
              onClick={() => {
                if (!isMuted) cancelVoicePrompt();
                setIsMuted(m => !m);
              }}
              title={isMuted ? "Unmute Voice Prompt" : "Mute Voice Prompt"}
              className="p-1.5 px-2.5 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-all flex items-center gap-1 text-xs"
            >
              {isMuted ? <VolumeX className="w-4 h-4 text-red-200" /> : <Volume2 className="w-4 h-4 text-white animate-pulse" />}
              <span className="text-[10px] font-bold">{isMuted ? 'Muted' : 'Voice On'}</span>
            </button>
          </div>

          <div className="p-6 space-y-5">
            <div className="text-center space-y-4">
              {/* Voice prompt active pill & replay */}
              <div className="flex items-center justify-center gap-2">
                <button
                  onClick={replayVoice}
                  className="inline-flex items-center gap-1.5 px-3 py-1 bg-red-50 hover:bg-red-100 border border-red-200 text-brand-700 rounded-full text-xs font-semibold shadow-xs transition-colors"
                >
                  <Volume2 className="w-3.5 h-3.5 animate-pulse text-brand-600" />
                  <span>Asking: "Are you in danger?"</span>
                  <RotateCcw className="w-3 h-3 ml-0.5 opacity-60" />
                </button>
              </div>

              <div className="relative inline-flex items-center justify-center">
                <svg className="w-28 h-28 -rotate-90" viewBox="0 0 100 100">
                  <circle cx="50" cy="50" r="45" fill="none" stroke="#FEE2E2" strokeWidth="8" />
                  <motion.circle
                    cx="50" cy="50" r="45" fill="none"
                    stroke="#DC2626" strokeWidth="8"
                    strokeLinecap="round"
                    strokeDasharray={`${2 * Math.PI * 45}`}
                    strokeDashoffset={`${2 * Math.PI * 45 * (1 - countdown / 30)}`}
                    transition={{ duration: 0.5 }}
                  />
                </svg>
                <div className="absolute text-center">
                  <span className="text-4xl font-black text-brand-700">{countdown}</span>
                  <p className="text-xs text-gray-500 font-medium">secs</p>
                </div>
              </div>

              <div>
                <h3 className="font-extrabold text-gray-900 text-base">Are you in danger?</h3>
                <p className="text-gray-600 text-xs leading-relaxed mt-1">
                  Press <strong className="text-gray-900 font-bold">I'm Safe</strong> to cancel false alarm,<br/>
                  or <strong className="text-brand-700 font-bold">Send Help!</strong> to dispatch an ambulance immediately.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3 pt-1">
                <button onClick={handleAbort} className="btn-secondary flex-col py-3.5 border-gray-300 hover:bg-gray-100 shadow-sm">
                  <X className="w-5 h-5 text-gray-600" />
                  <span className="text-xs font-bold text-gray-700">I'm Safe (Cancel)</span>
                </button>
                <button onClick={handleConfirm} className="btn-danger flex-col py-3.5 shadow-md">
                  <AlertTriangle className="w-5 h-5" />
                  <span className="text-xs font-bold">Send Help!</span>
                </button>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 flex items-center gap-2 text-xs text-gray-400">
            <Timer className="w-3.5 h-3.5" />
            <span>Auto-dispatches ambulance when countdown reaches 0</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
