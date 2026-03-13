import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type Severity = 'Low' | 'Moderate' | 'Emergency';
export type WalkInStatus = 'waiting' | 'identified' | 'triage_pending' | 'in_triage' | 'waiting_for_doctor' | 'completed' | 'emergency';

export type WalkInCase = {
  id: number;
  case_id: string;
  patient_name: string;
  age: number;
  sex?: 'Male' | 'Female' | 'Other' | '';
  date_of_birth?: string;
  contact: string;
  address?: string;
  emergency_contact?: string;
  patient_ref?: string;
  visit_department?: string;
  checkin_time?: string;
  pain_scale?: number | null;
  temperature_c?: number | null;
  blood_pressure?: string;
  pulse_bpm?: number | null;
  weight_kg?: number | null;
  chief_complaint: string;
  severity: Severity;
  intake_time: string;
  assigned_doctor: string;
  status: WalkInStatus;
};

export type WalkInAnalytics = {
  all: number;
  triage: number;
  doctor: number;
  emergency: number;
  completed: number;
};

export type WalkInListPayload = {
  analytics: WalkInAnalytics;
  items: WalkInCase[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

type WalkInQuery = {
  search?: string;
  status?: string;
  severity?: string;
  page?: number;
  perPage?: number;
};

export type CreateWalkInPayload = {
  patient_name: string;
  age?: number;
  sex?: 'Male' | 'Female' | 'Other' | '';
  date_of_birth?: string;
  contact?: string;
  address?: string;
  emergency_contact?: string;
  patient_ref?: string;
  visit_department?: string;
  checkin_time?: string;
  pain_scale?: number;
  temperature_c?: number;
  blood_pressure?: string;
  pulse_bpm?: number;
  weight_kg?: number;
  chief_complaint?: string;
  severity?: Severity;
  assigned_doctor?: string;
};

export type WalkInActionPayload = {
  action: 'identify' | 'queue_triage' | 'start_triage' | 'triage' | 'assign' | 'complete' | 'emergency';
  id: number;
  chief_complaint?: string;
  severity?: Severity;
  assigned_doctor?: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_WALKINS_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/walk-ins`;
  return '/api/walk-ins';
}

function buildUrl(query: WalkInQuery = {}): string {
  const params = new URLSearchParams();
  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    const mapped = key === 'perPage' ? 'per_page' : key;
    params.set(mapped, String(value));
  });
  const suffix = params.toString();
  const base = resolveApiUrl();
  return suffix ? `${base}?${suffix}` : base;
}

export async function fetchWalkIns(query: WalkInQuery = {}): Promise<WalkInListPayload> {
  return await fetchApiData<WalkInListPayload>(buildUrl(query), { ttlMs: 8_000 });
}

export async function createWalkIn(payload: CreateWalkInPayload): Promise<WalkInCase> {
  const data = await fetchApiData<WalkInCase>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'create',
      ...payload
    }
  });
  invalidateApiCache('/api/walk-ins');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  emitRealtimeRefresh('walkin_create');
  return data;
}

export async function runWalkInAction(payload: WalkInActionPayload): Promise<WalkInCase> {
  const data = await fetchApiData<WalkInCase>(resolveApiUrl(), {
    method: 'POST',
    body: payload
  });
  invalidateApiCache('/api/walk-ins');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  emitRealtimeRefresh(`walkin_${payload.action}`);
  return data;
}
