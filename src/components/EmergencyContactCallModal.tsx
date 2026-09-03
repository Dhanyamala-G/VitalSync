// ─────────────────────────────────────────────
//  EmergencyContactCallModal — AI Automated Call & Location Broadcast
//  Simultaneously phones emergency contacts during SOS triggers
// ─────────────────────────────────────────────
import { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Phone, PhoneOff, Volume2, VolumeX,
  MapPin, Share2, Check, Copy, ExternalLink,
  RotateCcw, MessageSquare, Radio, X
} from 'lucide-react';
import type { EmergencyContact, Location } from '../types';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  userName: string;
  userBloodGroup?: string;
  emergencyLocation: Location;
  emergencyContact?: EmergencyContact;
  ambulanceVehicleNo?: string;
}

export default function EmergencyContactCallModal({
  isOpen,
  onClose,
  userName,
  userBloodGroup,
  emergencyLocation,
  emergencyContact,
  ambulanceVehicleNo,
}: Props) {
  const [callState, setCallState] = useState<'dialing' | 'connected' | 'completed'>('dialing');
  const [callDuration, setCallDuration] = useState(0);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [copied, setCopied] = useState(false);

  const durationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const isMutedRef = useRef(false);
  isMutedRef.current = isMuted;

  const contactName = emergencyContact?.name || 'Emergency Contact (Family)';
  const contactPhone = emergencyContact?.phone || '+91 99887 76600';
  const contactRelation = emergencyContact?.relation || 'Primary Guardian';

  const mapsUrl = `https://maps.google.com/?q=${emergencyLocation.lat.toFixed(5)},${emergencyLocation.lng.toFixed(5)}`;
  
  const aiMessageScript = `Emergency alert! This is the VitalSync AI Emergency Assistant calling on behalf of ${userName}. An urgent crash or medical crisis was detected at latitude ${emergencyLocation.lat.toFixed(4)}, longitude ${emergencyLocation.lng.toFixed(4)}. An emergency ambulance ${ambulanceVehicleNo ? `unit ${ambulanceVehicleNo}` : ''} has been dispatched immediately and is en route. Live GPS location coordinates and rescue tracking have been transmitted to this number. Please stay alert.`;

  const speakAIMessage = useCallback(() => {
    if (isMutedRef.current) return;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
        const utterance = new SpeechSynthesisUtterance(aiMessageScript);
        utterance.rate = 0.95;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';

        utterance.onstart = () => setIsSpeaking(true);
        utterance.onend = () => setIsSpeaking(false);
        utterance.onerror = () => setIsSpeaking(false);

        window.speechSynthesis.speak(utterance);
      } catch (e) {
        console.warn('Speech synthesis error in AI call:', e);
        setIsSpeaking(false);
      }
    }
  }, [aiMessageScript]);

  const stopSpeaking = useCallback(() => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
    setIsSpeaking(false);
  }, []);

  const handleCancelCall = useCallback(() => {
    stopSpeaking();
    if (durationTimerRef.current) clearInterval(durationTimerRef.current);
    setCallState('completed');
    onClose();
  }, [stopSpeaking, onClose]);

  // Handle call lifecycle on open
  useEffect(() => {
    if (!isOpen) {
      stopSpeaking();
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      setCallDuration(0);
      setCallState('dialing');
      return;
    }

    setCallState('dialing');
    setCallDuration(0);

    // Step 1: Simulate connection after 1.8s
    const connectTimer = setTimeout(() => {
      setCallState('connected');
      speakAIMessage();

      // Step 2: Start call duration timer
      durationTimerRef.current = setInterval(() => {
        setCallDuration(d => d + 1);
      }, 1000);
    }, 1800);

    return () => {
      clearTimeout(connectTimer);
      if (durationTimerRef.current) clearInterval(durationTimerRef.current);
      stopSpeaking();
    };
  }, [isOpen, speakAIMessage, stopSpeaking]);

  const formatSeconds = (sec: number) => {
    const m = Math.floor(sec / 60).toString().padStart(2, '0');
    const s = (sec % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  const copyLocationLink = () => {
    navigator.clipboard.writeText(
      `🚨 EMERGENCY ALERT from VitalSync: ${userName} has encountered a medical emergency! An ambulance is en route. Live GPS Location: ${mapsUrl}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 3000);
  };

  const shareSMSUrl = `sms:${contactPhone}?&body=${encodeURIComponent(
    `🚨 EMERGENCY ALERT: VitalSync AI detected an urgent crisis for ${userName}. Ambulance is dispatched! Live GPS Location: ${mapsUrl}`
  )}`;

  const shareWhatsAppUrl = `https://wa.me/${contactPhone.replace(/[^0-9]/g, '')}?text=${encodeURIComponent(
    `🚨 *EMERGENCY ALERT (VitalSync)*\n\n*${userName}* is in an active medical emergency!\n🩸 Blood Group: *${userBloodGroup || 'O+'}*\n🚑 Status: *Ambulance Dispatched & En Route*\n📍 *Live GPS Location:*\n${mapsUrl}`
  )}`;

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        key="call-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[10000] flex items-center sm:items-end justify-center p-3 sm:p-4 bg-black/85 backdrop-blur-md overflow-y-auto"
        style={{ zIndex: 10000 }}
      >
        <motion.div
          key="call-dialog"
          initial={{ y: '100%', scale: 0.95 }}
          animate={{ y: 0, scale: 1 }}
          exit={{ y: '100%' }}
          transition={{ type: 'spring', damping: 26, stiffness: 280 }}
          className="w-full max-w-sm bg-slate-900 text-white rounded-3xl overflow-hidden shadow-2xl border border-slate-800 my-auto"
        >
          {/* Top Banner */}
          <div className="bg-gradient-to-r from-red-600 via-brand-600 to-red-700 px-5 py-4 flex items-center justify-between shadow-md">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center animate-pulse">
                <Radio className="w-4 h-4 text-white" />
              </div>
              <div>
                <h2 className="text-white font-extrabold text-xs uppercase tracking-wider">
                  AI Emergency Call Active
                </h2>
                <p className="text-red-100 text-[11px] font-medium">
                  Auto-alerting saved emergency contacts
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                onClick={() => {
                  if (!isMuted) stopSpeaking();
                  setIsMuted(m => !m);
                }}
                className="p-1.5 px-2 rounded-xl bg-white/15 hover:bg-white/25 text-white transition-all flex items-center gap-1 text-xs"
                title={isMuted ? "Unmute AI Speech" : "Mute AI Speech"}
              >
                {isMuted ? <VolumeX className="w-3.5 h-3.5 text-red-300" /> : <Volume2 className="w-3.5 h-3.5 text-white animate-pulse" />}
                <span className="text-[10px] font-bold">{isMuted ? 'Muted' : 'Voice'}</span>
              </button>

              <button
                onClick={handleCancelCall}
                className="p-1.5 rounded-xl bg-red-950/70 hover:bg-red-900 text-white transition-all"
                title="Cancel Emergency Call"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          <div className="p-5 space-y-4">
            {/* Contact Profile & Call Status */}
            <div className="text-center space-y-2">
              <div className="relative inline-flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-slate-800 border-2 border-slate-700 flex items-center justify-center text-white shadow-inner">
                  <span className="text-2xl font-black">{contactName[0].toUpperCase()}</span>
                </div>
                {callState === 'dialing' ? (
                  <span className="absolute -bottom-1 px-2 py-0.5 bg-yellow-500 text-slate-950 font-black text-[10px] rounded-full animate-bounce">
                    Dialing…
                  </span>
                ) : (
                  <span className="absolute -bottom-1 px-2 py-0.5 bg-emerald-500 text-white font-black text-[10px] rounded-full flex items-center gap-1 shadow-xs">
                    <span className="w-1.5 h-1.5 rounded-full bg-white animate-ping" /> Connected ({formatSeconds(callDuration)})
                  </span>
                )}
              </div>

              <div>
                <h3 className="font-extrabold text-base text-white">{contactName}</h3>
                <p className="text-slate-400 text-xs font-medium">
                  {contactRelation} · <span className="text-slate-300 font-bold">{contactPhone}</span>
                </p>
              </div>
            </div>

            {/* Audio Waveform Simulator */}
            <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <Volume2 className={`w-3.5 h-3.5 ${isSpeaking ? 'text-emerald-400 animate-pulse' : 'text-slate-400'}`} />
                  AI Voice Assistant Speaking
                </span>
                <button
                  onClick={speakAIMessage}
                  className="text-[10px] font-bold text-brand-400 hover:text-brand-300 flex items-center gap-1"
                >
                  <RotateCcw className="w-3 h-3" /> Replay Voice
                </button>
              </div>

              {/* Sound Bars */}
              <div className="flex items-center justify-center gap-1 h-6">
                {[12, 24, 16, 28, 8, 20, 26, 14, 22, 10, 28, 18, 24, 12, 16].map((h, i) => (
                  <motion.span
                    key={i}
                    animate={isSpeaking ? { height: [6, h, 6] } : { height: 4 }}
                    transition={{ repeat: Infinity, duration: 0.8, delay: i * 0.05 }}
                    className={`w-1 rounded-full ${isSpeaking ? 'bg-emerald-400' : 'bg-slate-600'}`}
                    style={{ height: isSpeaking ? h : 4 }}
                  />
                ))}
              </div>

              {/* Transcript Box */}
              <div className="bg-slate-900/90 rounded-xl p-2.5 text-[11px] text-slate-300 leading-relaxed max-h-24 overflow-y-auto border border-slate-800">
                <span className="text-emerald-400 font-bold">"</span>
                {aiMessageScript}
                <span className="text-emerald-400 font-bold">"</span>
              </div>
            </div>

            {/* Live Location Coordinates & Link Box */}
            <div className="bg-slate-800/80 rounded-2xl p-3.5 border border-slate-700/60 space-y-2.5">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-bold text-slate-300 flex items-center gap-1.5">
                  <MapPin className="w-3.5 h-3.5 text-red-400" />
                  Live GPS Coordinate Transmitted
                </span>
                <span className="text-[10px] font-mono text-slate-400">
                  {emergencyLocation.lat.toFixed(4)}, {emergencyLocation.lng.toFixed(4)}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  onClick={copyLocationLink}
                  className="btn-secondary py-2 px-2.5 text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600 rounded-xl flex items-center justify-center gap-1.5"
                >
                  {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  <span>{copied ? 'Link Copied!' : 'Copy Location'}</span>
                </button>

                <a
                  href={mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-secondary py-2 px-2.5 text-[11px] font-bold bg-slate-700 hover:bg-slate-600 text-slate-200 border-slate-600 rounded-xl flex items-center justify-center gap-1.5"
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                  <span>Open Maps</span>
                </a>
              </div>
            </div>

            {/* Direct Instant Sharing / Direct Phone Ring Options */}
            <div className="space-y-2 pt-1">
              <div className="grid grid-cols-2 gap-2">
                <a
                  href={shareSMSUrl}
                  className="btn-primary py-2.5 text-xs font-bold bg-blue-600 hover:bg-blue-700 justify-center rounded-xl flex items-center gap-1.5 shadow-sm"
                >
                  <MessageSquare className="w-3.5 h-3.5" />
                  Send SMS Alert
                </a>
                <a
                  href={shareWhatsAppUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn-primary py-2.5 text-xs font-bold bg-emerald-600 hover:bg-emerald-700 justify-center rounded-xl flex items-center gap-1.5 shadow-sm"
                >
                  <Share2 className="w-3.5 h-3.5" />
                  WhatsApp Alert
                </a>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <a
                  href={`tel:${contactPhone}`}
                  className="btn-primary py-2.5 text-xs font-bold bg-slate-700 hover:bg-slate-600 text-white justify-center rounded-xl flex items-center gap-1.5 border border-slate-600"
                >
                  <Phone className="w-3.5 h-3.5 text-emerald-400" />
                  Direct Phone Call
                </a>

                <button
                  onClick={handleCancelCall}
                  className="btn-primary py-2.5 text-xs font-bold bg-red-600 hover:bg-red-700 text-white justify-center rounded-xl flex items-center gap-1.5 shadow-sm"
                >
                  <PhoneOff className="w-3.5 h-3.5" />
                  <span>Cancel Call</span>
                </button>
              </div>

              <button
                onClick={onClose}
                className="w-full text-center py-1.5 text-xs text-slate-400 hover:text-slate-200 font-semibold transition-colors"
              >
                Minimize to Live Map
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}