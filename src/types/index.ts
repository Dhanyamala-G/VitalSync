// ─────────────────────────────────────────────
//  VitalSync — Core Type Definitions
// ─────────────────────────────────────────────

export type UserRole = 'user' | 'ambulance' | 'hospital';

export type EmergencyStatus =
  | 'triggered'
  | 'analysing'
  | 'confirmed'
  | 'dispatched'
  | 'en_route'
  | 'arrived'
  | 'resolved'
  | 'aborted';

export type EmergencyClassification = 'HIGH' | 'LOW';

export type AmbulanceStatus = 'available' | 'on_mission' | 'offline';

export interface Location {
  lat: number;
  lng: number;
  address?: string;
  timestamp?: number;
}

// ─── User ─────────────────────────────────────
export interface UserProfile {
  uid: string;
  name: string;
  age: number;
  bloodGroup: string;
  phone: string;
  email: string;
  conditions: string[];       // medical conditions
  allergies: string[];
  medications: string[];
  emergencyContacts: EmergencyContact[];
  insuranceId?: string;
  role: 'user';
  createdAt: number;
}

export interface EmergencyContact {
  name: string;
  relation: string;
  phone: string;
}

// ─── Emergency ────────────────────────────────
export interface Emergency {
  id: string;
  userId: string;
  userName: string;
  userPhone: string;
  userBloodGroup: string;
  location: Location;
  status: EmergencyStatus;
  classification: EmergencyClassification;
  confidenceScore: number;     // 0–100
  ambulanceId?: string;
  hospitalId?: string;
  hospitalName?: string;
  patientCount?: number;
  sensorData: SensorData;
  timestamp: number;
  resolvedAt?: number;
}

export interface SensorData {
  maxShakeMagnitude: number;   // m/s²
  stillnessDuration: number;   // seconds
  audioLevel: number;          // 0–1
  cameraCapture?: string;      // base64 image
}

// ─── Ambulance ────────────────────────────────
export interface AmbulanceProfile {
  uid: string;
  driverName: string;
  vehicleNo: string;
  vehicleType: 'BLS' | 'ALS' | 'Mobile ICU';
  phone: string;
  email: string;
  status: AmbulanceStatus;
  location?: Location;
  currentEmergencyId?: string;
  role: 'ambulance';
  createdAt: number;
}

// ─── Hospital ─────────────────────────────────
export interface HospitalProfile {
  uid: string;
  name: string;
  address: string;
  phone: string;
  email: string;
  location: Location;
  specialties: string[];
  beds: BedInfo;
  blood: BloodBank;
  oxygen: OxygenInfo;
  ventilators: number;
  doctorsOnDuty: Doctor[];
  role: 'hospital';
  createdAt: number;
}

export interface BedInfo {
  general: { total: number; available: number };
  icu: { total: number; available: number };
  emergency: { total: number; available: number };
}

export interface BloodBank {
  Apos: number;
  Aneg: number;
  Bpos: number;
  Bneg: number;
  Opos: number;
  Oneg: number;
  ABpos: number;
  ABneg: number;
}

export interface OxygenInfo {
  cylinders: number;
  piped: boolean;
}

export interface Doctor {
  name: string;
  specialty: string;
}

// ─── Treatment Report ─────────────────────────
export interface PatientTreatmentReport {
  reportId: string;
  emergencyId: string;
  patientName: string;
  patientAge?: number;
  patientBloodGroup: string;
  patientPhone: string;
  admittedHospital: string;
  attendingDoctor: string;
  triageLevel: string;
  vitals: {
    bloodPressure: string;
    heartRate: string;
    spO2: string;
    temperature: string;
  };
  interventions: string[];
  medicationsAdministered: string[];
  clinicalSummary: string;
  patientDisposition: string;
  treatedAt: number;
  dischargeNotes: string;
  respondingAmbulance?: {
    vehicleNo: string;
    driverName?: string;
  };
}

// ─── Hospital Alert ───────────────────────────
export interface HospitalAlert {
  id: string;
  hospitalId: string;
  hospitalName?: string;
  ambulanceId: string;
  ambulanceVehicleNo: string;
  emergencyId: string;
  patientCount: number;
  condition: string;          // voice transcription text
  etaMinutes: number;
  status: 'en_route' | 'arrived' | 'treated';
  timestamp: number;
  treatedAt?: number;
  treatmentReport?: PatientTreatmentReport;
}

// ─── AI Result ────────────────────────────────
export interface AIAnalysisResult {
  classification: EmergencyClassification;
  confidenceScore: number;
  reasoning: string;
  timestamp: number;
}

// ─── Hospital Recommendation ──────────────────
export interface HospitalRecommendation {
  hospital: HospitalProfile;
  score: number;
  distanceKm: number;
  etaMinutes: number;
  reasons: string[];
}
