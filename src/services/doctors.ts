import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type DoctorRow = {
  id: number;
  doctorName: string;
  departmentName: string;
  specialization: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/doctors`;
  return '/api/doctors';
}

function getCacheKey(filters: { departmentName?: string; includeInactive?: boolean }): string {
  return JSON.stringify({
    departmentName: String(filters.departmentName || '').trim().toLowerCase(),
    includeInactive: Boolean(filters.includeInactive)
  });
}

function normalizeDoctorRow(raw: Record<string, unknown>): DoctorRow {
  return {
    id: Number(raw.id || 0),
    doctorName: String(raw.doctor_name || ''),
    departmentName: String(raw.department_name || ''),
    specialization: String(raw.specialization || ''),
    isActive: Boolean(raw.is_active),
    createdAt: String(raw.created_at || ''),
    updatedAt: String(raw.updated_at || '')
  };
}

export async function listDoctors(filters: { departmentName?: string; includeInactive?: boolean } = {}): Promise<DoctorRow[]> {
  const cacheKey = getCacheKey(filters);

  const query = new URLSearchParams();
  if (filters.departmentName?.trim()) query.set('department', filters.departmentName.trim());
  if (filters.includeInactive) query.set('include_inactive', 'true');
  const suffix = query.toString();
  const rows = await fetchApiData<Array<Record<string, unknown>>>(`${resolveApiUrl()}${suffix ? `?${suffix}` : ''}`, {
    ttlMs: 30_000,
    cacheKey: `doctors:${cacheKey}`
  });
  return (Array.isArray(rows) ? rows : []).map(normalizeDoctorRow);
}

export async function upsertDoctor(payload: {
  doctorName: string;
  departmentName: string;
  specialization?: string;
  isActive?: boolean;
  actor?: string;
}): Promise<DoctorRow> {
  const data = await fetchApiData<Record<string, unknown>>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'upsert',
      actor: payload.actor || 'Admin',
      doctor_name: payload.doctorName,
      department_name: payload.departmentName,
      specialization: payload.specialization || '',
      is_active: payload.isActive == null ? true : payload.isActive
    }
  });
  invalidateApiCache('doctors:');
  invalidateApiCache('/api/doctor-availability');
  const saved = normalizeDoctorRow(data);
  emitRealtimeRefresh('doctor_upserted');
  return saved;
}
