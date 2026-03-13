import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type PatientPortalAnalytics = {
  total: number;
  upcoming: number;
  pending: number;
  confirmed: number;
};

export type PatientPortalAppointment = {
  bookingId: string;
  doctorName: string;
  teacherName?: string;
  department: string;
  appointmentDate: string;
  preferredTime: string;
  status: string;
  reason: string;
};

export type PatientPortalData = {
  profile: {
    patientCode: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    sex?: string | null;
    dateOfBirth?: string | null;
    guardianName?: string | null;
    emailVerified?: boolean;
  };
  analytics: PatientPortalAnalytics;
  appointments: PatientPortalAppointment[];
};

export async function fetchPatientPortal(): Promise<PatientPortalData> {
  const data = await fetchApiData<{
    profile: PatientPortalData['profile'];
    analytics: PatientPortalAnalytics;
    appointments?: Array<Record<string, unknown>>;
  }>('/api/patient-portal', { ttlMs: 10_000 });
  const normalizedAppointments = Array.isArray(data.appointments)
    ? data.appointments.map((item) => ({
        bookingId: String(item.bookingId || item.booking_id || ''),
        doctorName: String(item.doctorName || item.teacher_name || item.doctor_name || ''),
        teacherName: String(item.teacherName || item.teacher_name || item.doctor_name || ''),
        department: String(item.department || item.department_name || ''),
        appointmentDate: String(item.appointmentDate || item.appointment_date || ''),
        preferredTime: String(item.preferredTime || item.preferred_time || ''),
        status: String(item.status || ''),
        reason: String(item.reason || item.visit_reason || '')
      }))
    : [];
  return {
    ...data,
    appointments: normalizedAppointments
  };
}

export async function updatePatientProfile(payload: {
  full_name: string;
  phone_number: string;
  sex?: string;
  date_of_birth?: string;
  guardian_name?: string;
}): Promise<{
  authenticated: boolean;
  account: {
    patientCode: string;
    fullName: string;
    email: string;
    phoneNumber: string;
    sex?: string | null;
    dateOfBirth?: string | null;
    guardianName?: string | null;
    emailVerified?: boolean;
  };
}> {
  const data = await fetchApiData<{
    authenticated: boolean;
    account: {
      patientCode: string;
      fullName: string;
      email: string;
      phoneNumber: string;
      sex?: string | null;
      dateOfBirth?: string | null;
      guardianName?: string | null;
      emailVerified?: boolean;
    };
  }>('/api/patient-portal', {
    method: 'POST',
    body: {
      action: 'update_profile',
      ...payload
    }
  });
  invalidateApiCache('/api/patient-portal');
  invalidateApiCache('/api/patient-auth');
  return data;
}
