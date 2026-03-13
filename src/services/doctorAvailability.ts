import { emitRealtimeRefresh } from '@/composables/useRealtimeListSync';
import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type DoctorAvailabilitySlot = {
  id: number;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  bookedAppointments: number;
  remainingAppointments: number;
  isOpen: boolean;
};

export type DoctorAvailabilitySnapshot = {
  doctorName: string;
  departmentName: string;
  appointmentDate: string;
  isDoctorAvailable: boolean;
  reason: string;
  slots: DoctorAvailabilitySlot[];
  recommendedTimes: string[];
};

export type DoctorTimeCatalog = {
  appointmentDate: string;
  departmentName: string;
  allowedTimes: string[];
  doctors: Array<{
    doctorName: string;
    departmentName: string;
    isDoctorAvailable: boolean;
    reason: string;
    slots: DoctorAvailabilitySlot[];
    recommendedTimes: string[];
  }>;
};

export type DoctorAvailabilityScheduleRow = {
  id: number;
  doctorName: string;
  departmentName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/doctor-availability`;
  return '/api/doctor-availability';
}

function getCacheKey(path: string, params: Record<string, unknown>): string {
  const sortedEntries = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  return `${path}?${JSON.stringify(sortedEntries)}`;
}

export async function fetchDoctorAvailability(params: {
  doctorName: string;
  departmentName: string;
  appointmentDate: string;
  preferredTime?: string;
}): Promise<DoctorAvailabilitySnapshot> {
  const query = new URLSearchParams();
  query.set('doctor', params.doctorName);
  query.set('department', params.departmentName);
  query.set('date', params.appointmentDate);
  if (params.preferredTime?.trim()) query.set('preferred_time', params.preferredTime.trim());
  return await fetchApiData<DoctorAvailabilitySnapshot>(`${resolveApiUrl()}?${query.toString()}`, {
    ttlMs: 10_000,
    cacheKey: getCacheKey('doctor-availability:snapshot', params)
  });
}

export async function fetchDoctorTimeCatalog(params: {
  departmentName: string;
  appointmentDate: string;
  doctorName?: string;
}): Promise<DoctorTimeCatalog> {
  const query = new URLSearchParams();
  query.set('mode', 'times');
  query.set('department', params.departmentName);
  query.set('date', params.appointmentDate);
  if (params.doctorName?.trim()) query.set('doctor', params.doctorName.trim());

  const cacheKey = getCacheKey('doctor-availability:times', {
    departmentName: params.departmentName,
    appointmentDate: params.appointmentDate,
    doctorName: params.doctorName || ''
  });
  const data = await fetchApiData<DoctorTimeCatalog>(`${resolveApiUrl()}?${query.toString()}`, {
    ttlMs: 20_000,
    cacheKey
  });
  return {
    appointmentDate: String(data.appointmentDate || ''),
    departmentName: String(data.departmentName || ''),
    allowedTimes: Array.isArray(data.allowedTimes)
      ? data.allowedTimes.map((item) => String(item || '').slice(0, 5)).filter((item) => /^\d{2}:\d{2}$/.test(item))
      : [],
    doctors: Array.isArray(data.doctors)
      ? data.doctors.map((item) => ({
          doctorName: String(item.doctorName || ''),
          departmentName: String(item.departmentName || ''),
          isDoctorAvailable: Boolean(item.isDoctorAvailable),
          reason: String(item.reason || ''),
          slots: Array.isArray(item.slots) ? item.slots : [],
          recommendedTimes: Array.isArray(item.recommendedTimes)
            ? item.recommendedTimes.map((value) => String(value || '').slice(0, 5)).filter((value) => /^\d{2}:\d{2}$/.test(value))
            : []
        }))
      : []
  };
}

function normalizeScheduleRow(raw: Record<string, unknown>): DoctorAvailabilityScheduleRow {
  return {
    id: Number(raw.id || 0),
    doctorName: String(raw.doctor_name || ''),
    departmentName: String(raw.department_name || ''),
    dayOfWeek: Number(raw.day_of_week || 0),
    startTime: String(raw.start_time || '').slice(0, 5),
    endTime: String(raw.end_time || '').slice(0, 5),
    maxAppointments: Number(raw.max_appointments || 0),
    isActive: Boolean(raw.is_active),
    createdAt: String(raw.created_at || ''),
    updatedAt: String(raw.updated_at || '')
  };
}

export async function listDoctorAvailability(filters: { doctorName?: string; departmentName?: string } = {}): Promise<DoctorAvailabilityScheduleRow[]> {
  const query = new URLSearchParams();
  query.set('mode', 'raw');
  if (filters.doctorName?.trim()) query.set('doctor', filters.doctorName.trim());
  if (filters.departmentName?.trim()) query.set('department', filters.departmentName.trim());

  const cacheKey = getCacheKey('doctor-availability:raw', {
    doctorName: filters.doctorName || '',
    departmentName: filters.departmentName || ''
  });
  const rows = await fetchApiData<Array<Record<string, unknown>>>(`${resolveApiUrl()}?${query.toString()}`, {
    ttlMs: 25_000,
    cacheKey
  });
  return (Array.isArray(rows) ? rows : []).map(normalizeScheduleRow);
}

export async function upsertDoctorAvailability(payload: {
  doctorName: string;
  departmentName: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  maxAppointments: number;
  isActive: boolean;
  actor?: string;
}): Promise<DoctorAvailabilityScheduleRow> {
  const data = await fetchApiData<Record<string, unknown>>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'upsert',
      actor: payload.actor || 'Admin',
      doctor_name: payload.doctorName,
      department_name: payload.departmentName,
      day_of_week: payload.dayOfWeek,
      start_time: payload.startTime,
      end_time: payload.endTime,
      max_appointments: payload.maxAppointments,
      is_active: payload.isActive
    }
  });
  invalidateApiCache('/api/doctor-availability');
  const saved = normalizeScheduleRow(data);
  emitRealtimeRefresh('doctor_availability_upserted');
  return saved;
}

export async function deleteDoctorAvailability(id: number, actor = 'Admin'): Promise<void> {
  await fetchApiData<Record<string, unknown>>(resolveApiUrl(), {
    method: 'POST',
    body: {
      action: 'delete',
      actor,
      id
    }
  });
  invalidateApiCache('/api/doctor-availability');
  emitRealtimeRefresh('doctor_availability_deleted');
}
