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
//  🔧 DEMO MODE — Low thresholds, scores HIGH easily
//
//  Scoring breakdown:
//    Shake magnitude  → max 45 pts  (starts at 3 m/s²)
//    Stillness        → max 35 pts  (even 0.5s counts)
//    Audio level      → max 15 pts
//    Camera capture   → bonus 10 pts
//
//  Classification:
//    HIGH if score ≥ 20  (was 65 — triggers from light shake)
//    LOW  if score < 20
//
//  For production: raise HIGH_THRESHOLD to 65 and
//  change SHAKE_BASE to 15
// ──────────────────────────────────────────────

const SHAKE_BASE      = 3;   // m/s² — where scoring starts (matches hook)
const HIGH_THRESHOLD  = 20;  // score needed to classify HIGH (was 65)

function computeLocalScore(sensor: SensorData): number {
  let score = 0;

  // Shake magnitude contribution (max 45 pts)
  // Any shake above SHAKE_BASE starts scoring immediately
  if (sensor.maxShakeMagnitude > SHAKE_BASE) {
    const shakePts = Math.min(45, ((sensor.maxShakeMagnitude - SHAKE_BASE) / 10) * 45);
    score += Math.max(12, shakePts); // guaranteed 12 pts if threshold crossed
  }

  // Stillness after shake (max 35 pts)
  // Even a brief 0.5s stillness contributes
  if (sensor.stillnessDuration > 0) {
    const stillPts = Math.min(35, (sensor.stillnessDuration / 3) * 35);
    score += Math.max(stillPts, sensor.stillnessDuration > 0 ? 10 : 0);
  }

  // Audio level (max 15 pts)
  if (sensor.audioLevel > 0) {
    score += sensor.audioLevel * 15;
  }

  // Camera detected (bonus 10 pts)
  if (sensor.cameraCapture) score += 10;

  return Math.min(100, Math.round(score));
}

export async function analyseEmergency(sensor: SensorData): Promise<AIAnalysisResult> {
  // Try Gemini first if API key available
  if (GEMINI_API_KEY && GEMINI_API_KEY !== 'YOUR_GEMINI_KEY') {
    try {
      const parts: { text?: string; inlineData?: { mimeType: string; data: string } }[] = [
        {
          text: `You are an emergency detection AI. Analyse the following sensor data and classify the emergency.

Sensor Data:
- Max shake magnitude: ${sensor.maxShakeMagnitude.toFixed(2)} m/s² (demo threshold: ${SHAKE_BASE} m/s²)
- Stillness duration after shake: ${sensor.stillnessDuration.toFixed(1)} seconds
- Audio level: ${(sensor.audioLevel * 100).toFixed(0)}%
- Camera capture: ${sensor.cameraCapture ? 'Available' : 'Not available'}

Analyse the video frame (if provided), audio level, and movement pattern.
Look for: signs of distress in the image, unusual body position, high audio indicating distress.

Respond ONLY with valid JSON in this exact format:
{
  "classification": "HIGH" or "LOW",
  "confidenceScore": <0-100>,
  "reasoning": "<one sentence explanation>"
}

HIGH = likely real emergency (accident/medical crisis). LOW = likely false alarm.`,
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
        return {
          classification:  parsed.classification  || 'LOW',
          confidenceScore: parsed.confidenceScore || 0,
          reasoning:       parsed.reasoning       || '',
          timestamp:       Date.now(),
        };
      }
    } catch {
      // Fallback to local scoring
    }
  }

  // ── Local threshold-based fallback ──────────
  const score = computeLocalScore(sensor);
  return {
    classification:  score >= HIGH_THRESHOLD ? 'HIGH' : 'LOW',
    confidenceScore: score,
    reasoning:
      score >= HIGH_THRESHOLD
        ? `Emergency detected: shake ${sensor.maxShakeMagnitude.toFixed(1)} m/s², ${sensor.stillnessDuration.toFixed(1)}s stillness, audio ${(sensor.audioLevel * 100).toFixed(0)}%.`
        : `Low confidence: readings below emergency threshold (score: ${score}/100).`,
    timestamp: Date.now(),
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
