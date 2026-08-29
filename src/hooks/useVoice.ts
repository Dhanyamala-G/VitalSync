// ─────────────────────────────────────────────
//  useVoice — Web Speech API Hook
//  Supports both recognition (STT) and synthesis (TTS)
// ─────────────────────────────────────────────
import { useState, useRef, useCallback } from 'react';

interface VoiceState {
  isListening:    boolean;
  transcript:     string;
  error:          string | null;
  supported:      boolean;
  startListening: () => void;
  stopListening:  () => void;
  speak:          (text: string) => void;
}

export function useVoice(onTranscript?: (text: string) => void): VoiceState {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript]   = useState('');
  const [error, setError]             = useState<string | null>(null);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
  const supported = !!SpeechRecognition;

  const recognitionRef = useRef<unknown>(null);

  const startListening = useCallback(() => {
    if (!supported) {
      setError('Speech recognition not supported in this browser');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous    = false;
    recognition.interimResults = true;
    recognition.lang           = 'en-IN';

    recognition.onstart = () => setIsListening(true);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    recognition.onresult = (event: any) => {
      let final = '';
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) final += event.results[i][0].transcript;
      }
      if (final) {
        setTranscript(final);
        onTranscript?.(final);
      }
    };

    recognition.onerror = (e: { error: string }) => {
      setError(`Voice error: ${e.error}`);
      setIsListening(false);
    };

    recognition.onend = () => setIsListening(false);

    recognitionRef.current = recognition;
    recognition.start();
  }, [supported, SpeechRecognition, onTranscript]);

  const stopListening = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (recognitionRef.current as any)?.stop();
    setIsListening(false);
  }, []);

  const speak = useCallback((text: string) => {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.lang   = 'en-IN';
    utt.rate   = 0.95;
    utt.volume = 1;
    window.speechSynthesis.speak(utt);
  }, []);

  return { isListening, transcript, error, supported, startListening, stopListening, speak };
}
