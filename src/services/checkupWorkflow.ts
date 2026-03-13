import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type CheckupState =
  | 'intake'
  | 'queue'
  | 'doctor_assigned'
  | 'in_consultation'
  | 'lab_requested'
  | 'pharmacy'
  | 'completed'
  | 'archived';

export type CheckupSource = 'appointment_confirmed' | 'walkin_triage_completed' | 'waiting_for_doctor';

export type CheckupVisit = {
  id: number;
  visit_id: string;
  patient_name: string;
  assigned_doctor: string;
  source: CheckupSource;
  status: CheckupState;
  chief_complaint: string;
  diagnosis: string;
  clinical_notes: string;
  consultation_started_at: string;
  lab_requested: boolean;
  lab_result_ready: boolean;
  prescription_created: boolean;
  prescription_dispensed: boolean;
  follow_up_date: string;
  is_emergency: boolean;
  version: number;
  updated_at: string;
};

export type CheckupAnalytics = {
  intake: number;
  queue: number;
  doctorAssigned: number;
  inConsultation: number;
  labRequested: number;
  pharmacy: number;
  completed: number;
  emergency: number;
};

export type CheckupListPayload = {
  items: CheckupVisit[];
  analytics: CheckupAnalytics;
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

type CheckupQuery = {
  search?: string;
  status?: string;
  page?: number;
  perPage?: number;
};

export type CheckupAction =
  | 'queue'
  | 'assign_doctor'
  | 'start_consultation'
  | 'save_consultation'
  | 'request_lab'
  | 'mark_lab_ready'
  | 'send_pharmacy'
  | 'mark_dispensed'
  | 'complete'
  | 'archive'
  | 'reopen'
  | 'escalate_emergency';

export type CheckupActionRequest = {
  id: number;
  action: CheckupAction;
  expectedVersion?: number;
  assigned_doctor?: string;
  diagnosis?: string;
  clinical_notes?: string;
  follow_up_date?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_CHECKUPS_API_URL?.trim();
  if (directApi) {
    const normalized = trimTrailingSlashes(directApi);
    const looksLikePhpBackend = /\.php($|\?)/i.test(normalized) || /\/backend\//i.test(normalized) || /clinic%20system/i.test(normalized);
    if (!looksLikePhpBackend) return normalized;
  }

  // Force local Vite middleware endpoint so check-up module stays Neon-only.
  return '/api/checkups';
}

function buildUrl(query: CheckupQuery = {}): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const mapped = key === 'perPage' ? 'per_page' : key;
    params.set(mapped, String(value));
  });
  const suffix = params.toString();
  return suffix ? `${resolveApiUrl()}?${suffix}` : resolveApiUrl();
}

export async function fetchCheckupQueue(query: CheckupQuery = {}): Promise<CheckupListPayload> {
  return await fetchApiData<CheckupListPayload>(buildUrl(query), { ttlMs: 8_000 });
}

export async function dispatchCheckupAction(request: CheckupActionRequest): Promise<CheckupVisit> {
  const data = await fetchApiData<CheckupVisit>(resolveApiUrl(), {
    method: 'POST',
    body: request
  });
  invalidateApiCache('/api/checkups');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  emitRealtimeRefresh(`checkup_${request.action}`);
  return data;
}
