// ─────────────────────────────────────────────
//  AI Analysis Service
//  Uses threshold-based scoring (works without API key)
//  + Optional Gemini API integration
// ─────────────────────────────────────────────
import type { AIAnalysisResult, SensorData, HospitalProfile, HospitalRecommendation } from '../types';

const GEMINI_API_KEY = import.meta.env.VITE_GEMINI_API_KEY || '';
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${GEMINI_API_KEY}`;

// ──────────────────────────────────────────────
//  Emergency Confidence Scoring
//
//  🔧 DEMO MODE — SHAKE = AUTOMATIC HIGH
//
//  Rule:
//    If shake threshold was crossed → always HIGH
//    Audio + video are captured for ambulance info
//    but they NEVER cause a LOW classification
//
//  Score shown to UI:
//    Shake base:  70 pts guaranteed (shake triggered)
//    Stillness:   +15 pts bonus
//    Audio:       +10 pts bonus
//    Camera:      +5  pts bonus
//    Max: 100
//
//  For production: remove the shake-auto-HIGH rule
// ──────────────────────────────────────────────

const SHAKE_BASE = 5;  // must match SHAKE_THRESHOLD in useShakeDetector.ts

function computeLocalScore(sensor: SensorData): number {
  // If shake was detected → guaranteed 70 pts base score
  // This alone exceeds HIGH_THRESHOLD — shake = always HIGH
  if (sensor.maxShakeMagnitude > SHAKE_BASE) {
    let score = 70; // shake base — always HIGH on its own

    // Stillness bonus (max +15 pts)
    if (sensor.stillnessDuration > 0) {
      score += Math.min(15, (sensor.stillnessDuration / 2) * 15);
    }

    // Audio bonus (max +10 pts) — high audio = more distress
    if (sensor.audioLevel > 0) {
      score += Math.round(sensor.audioLevel * 10);
    }

    // Camera captured (bonus +5 pts)
    if (sensor.cameraCapture) score += 5;

    return Math.min(100, Math.round(score));
  }

  // No shake detected → low score
  return 5;
}

export async function analyseEmergency(sensor: SensorData): Promise<AIAnalysisResult> {
  // ── SHAKE DETECTED → ALWAYS HIGH ────────────
  // Audio/video are captured for ambulance context
  // but shake alone is definitive evidence
  if (sensor.maxShakeMagnitude > SHAKE_BASE) {
    const score = computeLocalScore(sensor);

    // If Gemini API key is available, send data for richer reasoning text
    // but we KEEP classification as HIGH regardless of what Gemini says
    let reasoning = `🚨 Emergency shake detected (${sensor.maxShakeMagnitude.toFixed(1)} m/s²).`;

    if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_KEY') {
      try {
        const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
          {
            text: `Emergency alert triggered by device shake (${sensor.maxShakeMagnitude.toFixed(1)} m/s²).
Stillness after shake: ${sensor.stillnessDuration.toFixed(1)}s.
Audio level: ${(sensor.audioLevel * 100).toFixed(0)}%.

The emergency IS confirmed (shake detected). Do NOT change the classification to LOW.
Briefly describe what the camera image shows (if provided) in one sentence to help paramedics.
Respond ONLY in this JSON format:
{ "reasoning": "<one sentence describing scene for paramedics>" }`,
          },
        ];

        if (sensor.cameraCapture) {
          parts.push({
            inlineData: {
              mimeType: 'image/jpeg',
              data: sensor.cameraCapture.replace(/^data:image\/\w+;base64,/, ''),
            },
          });
        }

        const response = await fetch(GEMINI_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ contents: [{ parts }] }),
        });

        const data = await response.json();
        const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (parsed.reasoning) reasoning = parsed.reasoning;
        }
      } catch {
        // Keep default reasoning
      }
    } else {
      // Build descriptive reasoning from sensor data
      const parts: string[] = [`Shake detected (${sensor.maxShakeMagnitude.toFixed(1)} m/s²)`];
      if (sensor.stillnessDuration > 0.5) parts.push(`device went still for ${sensor.stillnessDuration.toFixed(1)}s`);
      if (sensor.audioLevel > 0.3) parts.push(`elevated audio detected`);
      if (sensor.cameraCapture) parts.push(`scene captured`);
      reasoning = `🚨 ${parts.join(', ')}.`;
    }

    return {
      classification:  'HIGH',   // always HIGH if shake triggered
      confidenceScore: score,
      reasoning,
      timestamp: Date.now(),
    };
  }

  // ── No shake — LOW ───────────────────────────
  return {
    classification:  'LOW',
    confidenceScore: 5,
    reasoning:       'No significant shake detected — likely a false trigger.',
    timestamp:       Date.now(),
  };
}

// ──────────────────────────────────────────────
//  Hospital Recommendation
// ──────────────────────────────────────────────
export function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R  = 6371;
  const dL = ((lat2 - lat1) * Math.PI) / 180;
  const dN = ((lng2 - lng1) * Math.PI) / 180;
  const a  =
    Math.sin(dL / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dN / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export function recommendHospitals(
  fromLat: number,
  fromLng: number,
  hospitals: HospitalProfile[],
  patientCondition = '',
): HospitalRecommendation[] {
  return hospitals
    .map((h) => {
      const distKm     = haversineKm(fromLat, fromLng, h.location.lat, h.location.lng);
      const etaMinutes = Math.round((distKm / 40) * 60); // avg 40 km/h city speed
      const reasons: string[] = [];
      let score = 0;

      // Distance score (max 30)
      const distScore = Math.max(0, 30 - distKm * 3);
      score += distScore;

      // Bed availability (max 25)
      const bedAvail = h.beds.emergency.available + h.beds.icu.available;
      if (bedAvail > 5) { score += 25; reasons.push(`${bedAvail} beds available`); }
      else if (bedAvail > 0) { score += 10; reasons.push(`${bedAvail} beds available`); }
      else reasons.push('⚠️ Beds limited');

      // Specialty match (max 20)
      const condLower = patientCondition.toLowerCase();
      const matched = h.specialties.filter(
        s => condLower.includes(s.toLowerCase()) || condLower === ''
      );
      if (matched.length > 0) { score += 20; reasons.push(`Specialty: ${matched.join(', ')}`); }

      // Oxygen availability (max 15)
      if (h.oxygen.cylinders > 10) { score += 15; reasons.push('Oxygen available'); }
      else if (h.oxygen.cylinders > 0) { score += 8; }

      // Distance label
      reasons.unshift(`${distKm.toFixed(1)} km away (~${etaMinutes} min)`);

      return { hospital: h, score: Math.round(score), distanceKm: distKm, etaMinutes, reasons };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
}
