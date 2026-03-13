import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type RegistrationStatus = 'Pending' | 'Review' | 'Active' | 'Archived';

export type RegistrationRow = {
  id: number;
  case_id: string;
  patient_name: string;
  patient_email: string;
  age: number;
  concern: string;
  intake_time: string;
  booked_time: string;
  status: RegistrationStatus;
  assigned_to: string;
};

export type RegistrationAnalytics = {
  pending: number;
  active: number;
  concerns: number;
  approvalRate: number;
};

export type RegistrationListPayload = {
  analytics: RegistrationAnalytics;
  items: RegistrationRow[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

type RegistrationQuery = {
  search?: string;
  status?: string;
  sort?: string;
  page?: number;
  perPage?: number;
};

export type RegistrationUpsertPayload = {
  id?: number;
  patient_name?: string;
  patient_email?: string;
  age?: number;
  concern?: string;
  intake_time?: string;
  booked_time?: string;
  status?: RegistrationStatus;
  assigned_to?: string;
};

export type RegistrationAction =
  | 'create'
  | 'update'
  | 'approve'
  | 'reject'
  | 'archive'
  | 'assign'
  | 'set_status';

type RegistrationActionPayload = {
  id?: number;
  reason?: string;
  status?: RegistrationStatus;
  assigned_to?: string;
} & RegistrationUpsertPayload;

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_REGISTRATIONS_API_URL?.trim();
  if (directApi) {
    return trimTrailingSlashes(directApi);
  }

  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) {
    return `${trimTrailingSlashes(configured)}/registrations`;
  }

  return '/api/registrations';
}

function buildUrl(query: RegistrationQuery = {}): string {
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

async function executeRegistrationAction(action: RegistrationAction, payload: RegistrationActionPayload): Promise<RegistrationRow> {
  const data = await fetchApiData<RegistrationRow>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action,
      ...payload
    }
  });
  invalidateApiCache('/api/registrations');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  invalidateApiCache('/api/patients');
  emitRealtimeRefresh(`registration_${action}`);
  return data;
}

export async function fetchRegistrations(query: RegistrationQuery = {}): Promise<RegistrationListPayload> {
  return await fetchApiData<RegistrationListPayload>(buildUrl(query), { ttlMs: 8_000 });
}

export async function createRegistration(payload: RegistrationUpsertPayload): Promise<RegistrationRow> {
  if (!payload.patient_name?.trim()) throw 'patient_name is required.';
  return await executeRegistrationAction('create', payload);
}

export async function updateRegistration(payload: RegistrationUpsertPayload): Promise<RegistrationRow> {
  return await executeRegistrationAction('update', payload);
}

export async function approveRegistration(id: number): Promise<RegistrationRow> {
  return await executeRegistrationAction('approve', { id });
}

export async function rejectRegistration(id: number, reason: string): Promise<RegistrationRow> {
  return await executeRegistrationAction('reject', { id, reason });
}

export async function archiveRegistration(id: number, reason: string): Promise<RegistrationRow> {
  return await executeRegistrationAction('archive', { id, reason });
}

export async function assignRegistration(id: number, assigned_to: string): Promise<RegistrationRow> {
  return await executeRegistrationAction('assign', { id, assigned_to });
}

export async function setRegistrationStatus(id: number, status: RegistrationStatus): Promise<RegistrationRow> {
  return await executeRegistrationAction('set_status', { id, status });
}
