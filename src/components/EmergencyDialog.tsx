// ─────────────────────────────────────────────
//  EmergencyDialog — 30-second abort timer
//  Opens camera + audio after countdown
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Timer, Camera, Mic, X, CheckCircle2, Volume2, VolumeX, RotateCcw } from 'lucide-react';
import type { AIAnalysisResult, SensorData } from '../types';
import { analyseEmergency } from '../services/aiService';

interface Props {
  isOpen:          boolean;
  shakeMagnitude:  number;
  onAbort:         () => void;
  onConfirmed:     (result: AIAnalysisResult, sensorData: SensorData) => void;
}

type Phase = 'countdown' | 'capturing' | 'analysing' | 'result';

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
  const [phase,        setPhase]        = useState<Phase>('countdown');
  const [countdown,    setCountdown]    = useState(30);
  const [isMuted,      setIsMuted]      = useState(false);
  const [aiResult,     setAiResult]     = useState<AIAnalysisResult | null>(null);
  const [audioLevel,   setAudioLevel]   = useState(0);
  const [cameraFrame,  setCameraFrame]  = useState<string | null>(null);
  const [stillnessSec, setStillnessSec] = useState(0);

  const videoRef       = useRef<HTMLVideoElement>(null);
  const streamRef      = useRef<MediaStream | null>(null);
  const audioCtxRef    = useRef<AudioContext | null>(null);
  const analyserRef    = useRef<AnalyserNode | null>(null);
  const animFrameRef   = useRef<number>(0);
  const countdownTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMutedRef     = useRef(false);
  isMutedRef.current   = isMuted;

  const replayVoice = useCallback(() => {
    playEmergencyAlarmBeep();
    speakVoicePrompt(
      "Emergency shake detected. Are you in danger? Press I'm Safe if you are okay, or Send Help to alert emergency services.",
      isMutedRef.current
    );
  }, []);

  // Reset & speak on open
  useEffect(() => {
    if (isOpen) {
      setPhase('countdown');
      setCountdown(30);
      setAiResult(null);
      setCameraFrame(null);
      playEmergencyAlarmBeep();
      speakVoicePrompt(
        "Emergency shake detected. Are you in danger? Press I'm Safe if you are okay, or Send Help to alert emergency services.",
        isMutedRef.current
      );
    } else {
      cancelVoicePrompt();
    }
    return () => {
      cancelVoicePrompt();
    };
  }, [isOpen]);

  // Countdown timer with voice warning
  useEffect(() => {
    if (!isOpen || phase !== 'countdown') return;

    countdownTimer.current = setInterval(() => {
      setCountdown(c => {
        if (c === 11) {
          speakVoicePrompt("10 seconds remaining. Are you in danger? Press I'm Safe to cancel.", isMutedRef.current);
        }
        if (c <= 1) {
          clearInterval(countdownTimer.current!);
          cancelVoicePrompt();
          startCapture();
          return 0;
        }
        return c - 1;
      });
    }, 1000);

    return () => { if (countdownTimer.current) clearInterval(countdownTimer.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, phase]);

  const stopMedia = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop());
    streamRef.current = null;
    audioCtxRef.current?.close();
    cancelAnimationFrame(animFrameRef.current);
  }, []);

  const startCapture = useCallback(async () => {
    setPhase('capturing');
    let capturedFrame = '';
    let capturedAudio = 0;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: 320, height: 240 },
        audio: true,
      });
      streamRef.current = stream;

      // Video capture
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        setTimeout(() => {
          const canvas = document.createElement('canvas');
          canvas.width  = 320; canvas.height = 240;
          canvas.getContext('2d')?.drawImage(videoRef.current!, 0, 0, 320, 240);
          capturedFrame = canvas.toDataURL('image/jpeg', 0.7);
          setCameraFrame(capturedFrame);
        }, 1500);
      }

      // Audio level
      const ctx      = new AudioContext();
      audioCtxRef.current = ctx;
      const source   = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);
      analyserRef.current = analyser;

      const measureAudio = () => {
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(data);
        const avg = data.reduce((a, b) => a + b, 0) / data.length;
        capturedAudio = avg / 128;
        setAudioLevel(capturedAudio);
        animFrameRef.current = requestAnimationFrame(measureAudio);
      };
      measureAudio();

      // After 4 seconds of capture → analyse
      setTimeout(() => {
        stopMedia();
        runAnalysis(capturedFrame, capturedAudio);
      }, 4000);

    } catch {
      // Camera/audio permission denied → analyse with sensor data only
      stopMedia();
      runAnalysis('', 0);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const runAnalysis = useCallback(async (frame: string, audio: number) => {
    setPhase('analysing');
    const sensorData: SensorData = {
      maxShakeMagnitude: shakeMagnitude,
      stillnessDuration: stillnessSec,
      audioLevel:        audio,
      cameraCapture:     frame || undefined,
    };
    try {
      const result = await analyseEmergency(sensorData);
      setAiResult(result);
      setPhase('result');
      if (result.classification === 'HIGH') {
        setTimeout(() => onConfirmed(result, sensorData), 1500);
      }
    } catch {
      setPhase('result');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shakeMagnitude, stillnessSec]);

  // Load stillness from sensor (simulate tracking)
  useEffect(() => {
    if (!isOpen) return;
    const id = setInterval(() => setStillnessSec(s => s + 0.1), 100);
    return () => clearInterval(id);
  }, [isOpen]);

  const handleAbort = () => {
    clearInterval(countdownTimer.current!);
    cancelVoicePrompt();
    stopMedia();
    onAbort();
  };

  const handleConfirm = () => {
    clearInterval(countdownTimer.current!);
    cancelVoicePrompt();
    stopMedia();
    startCapture();
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
            {/* ── Countdown phase ── */}
            {phase === 'countdown' && (
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
                    or <strong className="text-brand-700 font-bold">Send Help!</strong> to dispatch an ambulance now.
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
            )}

            {/* ── Capturing phase ── */}
            {phase === 'capturing' && (
              <div className="space-y-4">
                <div className="text-center">
                  <p className="font-semibold text-gray-800">Analysing Scene…</p>
                  <p className="text-sm text-gray-500">Camera & audio capturing for 4 seconds</p>
                </div>
                <video
                  ref={videoRef} muted playsInline autoPlay
                  className="w-full rounded-xl bg-gray-900 aspect-video object-cover"
                />
                <div className="flex items-center gap-3 bg-brand-50 rounded-xl p-3">
                  <Mic className="w-4 h-4 text-brand-600" />
                  <div className="flex-1 h-2 bg-brand-100 rounded-full overflow-hidden">
                    <motion.div
                      className="h-full bg-brand-600 rounded-full"
                      animate={{ width: `${audioLevel * 100}%` }}
                    />
                  </div>
                  <Camera className="w-4 h-4 text-brand-600" />
                  {cameraFrame && (
                    <div className="w-2 h-2 bg-green-500 rounded-full" />
                  )}
                </div>
              </div>
            )}

            {/* ── Analysing phase ── */}
            {phase === 'analysing' && (
              <div className="text-center py-4 space-y-4">
                <div className="flex justify-center gap-2">
                  {[0, 1, 2].map(i => (
                    <motion.div
                      key={i}
                      className="w-3 h-3 bg-brand-600 rounded-full"
                      animate={{ scale: [0, 1, 0] }}
                      transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.2 }}
                    />
                  ))}
                </div>
                <p className="font-semibold text-gray-800">AI Analysing…</p>
                <p className="text-sm text-gray-500">Processing sensor, camera & audio data</p>
              </div>
            )}

            {/* ── Result phase ── */}
            {phase === 'result' && aiResult && (
              <div className="space-y-4">
                <div className={`rounded-2xl p-4 text-center ${
                  aiResult.classification === 'HIGH' ? 'bg-red-50' : 'bg-green-50'
                }`}>
                  {aiResult.classification === 'HIGH' ? (
                    <>
                      <AlertTriangle className="w-10 h-10 text-red-600 mx-auto mb-2" />
                      <p className="font-bold text-red-700 text-lg">Emergency Confirmed</p>
                      <p className="text-red-600 text-sm">Confidence: {aiResult.confidenceScore}%</p>
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-10 h-10 text-green-600 mx-auto mb-2" />
                      <p className="font-bold text-green-700 text-lg">False Alarm</p>
                      <p className="text-green-600 text-sm">Confidence: {aiResult.confidenceScore}%</p>
                    </>
                  )}
                </div>
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-500">{aiResult.reasoning}</p>
                </div>

                {/* Confidence meter */}
                <div>
                  <div className="flex justify-between text-xs text-gray-500 mb-1">
                    <span>Confidence Score</span>
                    <span>{aiResult.confidenceScore}%</span>
                  </div>
                  <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
                    <motion.div
                      className={`h-full rounded-full ${aiResult.classification === 'HIGH' ? 'bg-brand-600' : 'bg-green-500'}`}
                      initial={{ width: 0 }}
                      animate={{ width: `${aiResult.confidenceScore}%` }}
                      transition={{ duration: 0.8, ease: 'easeOut' }}
                    />
                  </div>
                </div>

                {aiResult.classification === 'HIGH' ? (
                  <p className="text-center text-sm text-brand-600 font-medium animate-pulse">
                    🚨 Alerting nearest ambulance…
                  </p>
                ) : (
                  <button onClick={handleAbort} className="btn-secondary w-full">
                    <CheckCircle2 className="w-4 h-4" />
                    Close
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="px-6 pb-6 flex items-center gap-2 text-xs text-gray-400">
            <Timer className="w-3.5 h-3.5" />
            <span>Shake detected at {new Date().toLocaleTimeString()}</span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
