// ─────────────────────────────────────────────
//  EmergencyDialog — 30-second abort timer
//  Opens camera + audio after countdown
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { AlertTriangle, Timer, Camera, Mic, X, CheckCircle2 } from 'lucide-react';
import type { AIAnalysisResult, SensorData } from '../types';
import { analyseEmergency } from '../services/aiService';

interface Props {
  isOpen:          boolean;
  shakeMagnitude:  number;
  onAbort:         () => void;
  onConfirmed:     (result: AIAnalysisResult, sensorData: SensorData) => void;
}

type Phase = 'countdown' | 'capturing' | 'analysing' | 'result';

export default function EmergencyDialog({ isOpen, shakeMagnitude, onAbort, onConfirmed }: Props) {
  const [phase,        setPhase]        = useState<Phase>('countdown');
  const [countdown,    setCountdown]    = useState(30);
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

  // Reset on open
  useEffect(() => {
    if (isOpen) {
      setPhase('countdown');
      setCountdown(30);
      setAiResult(null);
      setCameraFrame(null);
    }
  }, [isOpen]);

  // Countdown timer
  useEffect(() => {
    if (!isOpen || phase !== 'countdown') return;

    countdownTimer.current = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) {
          clearInterval(countdownTimer.current!);
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
    stopMedia();
    onAbort();
  };

  const handleConfirm = () => {
    clearInterval(countdownTimer.current!);
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
        className="fixed inset-0 z-50 flex items-end justify-center p-4"
        style={{ background: 'rgba(0,0,0,0.75)' }}
      >
        <motion.div
          key="dialog"
          initial={{ y: '100%', scale: 0.95 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 28, stiffness: 300 }}
          className="w-full max-w-sm bg-white rounded-3xl overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="bg-brand-600 px-6 py-5 flex items-center gap-3">
            <motion.div animate={{ scale: [1, 1.2, 1] }} transition={{ repeat: Infinity, duration: 1 }}>
              <AlertTriangle className="w-7 h-7 text-white" />
            </motion.div>
            <div>
              <h2 className="text-white font-bold text-lg leading-tight">Emergency Detected</h2>
              <p className="text-red-100 text-sm">Shake: {shakeMagnitude.toFixed(1)} m/s²</p>
            </div>
          </div>

          <div className="p-6 space-y-5">
            {/* ── Countdown phase ── */}
            {phase === 'countdown' && (
              <div className="text-center space-y-4">
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
                <p className="text-gray-600 text-sm leading-relaxed">
                  Are you okay? Press <strong>I'm Safe</strong> to cancel,<br/>
                  or <strong>Send Help</strong> to alert emergency services.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <button onClick={handleAbort} className="btn-secondary flex-col py-3.5">
                    <X className="w-5 h-5" />
                    <span className="text-xs">I'm Safe</span>
                  </button>
                  <button onClick={handleConfirm} className="btn-danger flex-col py-3.5">
                    <AlertTriangle className="w-5 h-5" />
                    <span className="text-xs">Send Help!</span>
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
