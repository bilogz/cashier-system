import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type MentalHealthStatus = 'create' | 'active' | 'follow_up' | 'at_risk' | 'completed' | 'escalated' | 'archived';

export type MentalHealthRisk = 'low' | 'medium' | 'high';

export type MentalHealthPatient = {
  patient_id: string;
  patient_name: string;
  previous_sessions: number;
  latest_case_reference: string | null;
};

export type MentalHealthSession = {
  id: number;
  case_reference: string;
  patient_id: string;
  patient_name: string;
  counselor: string;
  session_type: string;
  status: MentalHealthStatus;
  risk_level: MentalHealthRisk;
  diagnosis_condition: string;
  treatment_plan: string;
  session_goals: string;
  session_duration_minutes: number;
  session_mode: 'in_person' | 'online';
  location_room: string;
  guardian_contact: string;
  emergency_contact: string;
  medication_reference: string;
  follow_up_frequency: string;
  escalation_reason: string;
  outcome_result: string;
  assessment_score: number | null;
  assessment_tool: string;
  appointment_at: string;
  next_follow_up_at: string | null;
  created_by_role: string;
  is_draft: boolean;
  created_at: string;
  updated_at: string;
};

export type MentalHealthNote = {
  id: number;
  session_id: number;
  note_type: string;
  note_content: string;
  clinical_score: number | null;
  attachment_name: string;
  attachment_url: string;
  created_by_role: string;
  created_at: string;
};

export type MentalHealthActivity = {
  id: number;
  session_id: number;
  action: string;
  detail: string;
  actor_role: string;
  created_at: string;
};

export type MentalHealthSnapshot = {
  sessions: MentalHealthSession[];
  patients: MentalHealthPatient[];
  notes: MentalHealthNote[];
  activities: MentalHealthActivity[];
  analytics: {
    active: number;
    follow_up: number;
    at_risk: number;
    completed: number;
    escalated: number;
    archived: number;
  };
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_MENTAL_HEALTH_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/mental-health`;
  return '/api/mental-health';
}

export async function fetchMentalHealthSnapshot(): Promise<MentalHealthSnapshot> {
  return await fetchApiData<MentalHealthSnapshot>(resolveApiUrl(), { ttlMs: 10_000 });
}

export async function dispatchMentalHealthAction(payload: Record<string, unknown>): Promise<void> {
  await fetchApiData<unknown>(resolveApiUrl(), {
    method: 'POST',
    body: payload
  });
  invalidateApiCache('/api/mental-health');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  invalidateApiCache('/api/patients');
}
