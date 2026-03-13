import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type PatientRecord = {
  id: number;
  patient_code: string;
  patient_name: string;
  email: string | null;
  contact: string | null;
  sex: string | null;
  date_of_birth: string | null;
  age: number | null;
  emergency_contact: string | null;
  guardian_contact: string | null;
  latest_status: string;
  risk_level: string;
  appointment_count: number;
  walkin_count: number;
  checkup_count: number;
  mental_count: number;
  pharmacy_count: number;
  source_tags: string[];
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
};

export type PatientsSnapshot = {
  analytics: {
    total_patients: number;
    high_risk: number;
    active_profiles: number;
    active_30_days: number;
  };
  items: PatientRecord[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_PATIENTS_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/patients`;
  return '/api/patients';
}

export async function fetchPatientsSnapshot(filters: { search?: string; module?: string; page?: number; perPage?: number; sync?: boolean } = {}): Promise<PatientsSnapshot> {
  const params = new URLSearchParams();
  if (filters.search) params.set('search', filters.search);
  if (filters.module) params.set('module', filters.module);
  if (filters.page) params.set('page', String(filters.page));
  if (filters.perPage) params.set('per_page', String(filters.perPage));
  if (filters.sync) params.set('sync', '1');

  const url = `${resolveApiUrl()}${params.toString() ? `?${params.toString()}` : ''}`;
  return await fetchApiData<PatientsSnapshot>(url, {
    ttlMs: filters.sync ? 0 : 10_000,
    forceRefresh: Boolean(filters.sync)
  });
}

export async function syncPatientsProfiles(): Promise<void> {
  const params = new URLSearchParams({ sync: '1', page: '1', per_page: '1' });
  await fetchApiData<unknown>(`${resolveApiUrl()}?${params.toString()}`, { forceRefresh: true });
  invalidateApiCache('/api/patients');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
}
