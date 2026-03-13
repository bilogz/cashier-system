import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type PatientAccount = {
  patientCode: string;
  fullName: string;
  email: string;
  phoneNumber: string;
  sex?: string | null;
  dateOfBirth?: string | null;
  guardianName?: string | null;
  emailVerified?: boolean;
};

export type PatientSessionResponse = {
  authenticated: boolean;
  account: PatientAccount | null;
  verificationRequired?: boolean;
  verificationEmail?: string;
  devVerificationCode?: string;
  resetEmail?: string;
  devResetCode?: string;
};

export async function fetchPatientSession(): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', { ttlMs: 5_000 });
  return data || { authenticated: false, account: null };
}

export async function signupPatientAccount(payload: {
  full_name: string;
  email: string;
  phone_number: string;
  password: string;
  sex?: string;
  date_of_birth?: string;
  guardian_name?: string;
}): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'signup', ...payload }
  });
  invalidateApiCache('/api/patient-auth');
  invalidateApiCache('/api/patient-portal');
  return data || { authenticated: false, account: null };
}

export async function loginPatientAccount(payload: { email: string; password: string }): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'login', ...payload }
  });
  invalidateApiCache('/api/patient-auth');
  invalidateApiCache('/api/patient-portal');
  return data || { authenticated: false, account: null };
}

export async function requestEmailVerification(email: string): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'request_email_verification', email }
  });
  invalidateApiCache('/api/patient-auth');
  return data || { authenticated: false, account: null };
}

export async function verifyPatientEmail(payload: { email: string; code: string }): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'verify_email', ...payload }
  });
  invalidateApiCache('/api/patient-auth');
  return data || { authenticated: false, account: null };
}

export async function requestPasswordReset(email: string): Promise<PatientSessionResponse> {
  const data = await fetchApiData<PatientSessionResponse>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'request_password_reset', email }
  });
  invalidateApiCache('/api/patient-auth');
  return data || { authenticated: false, account: null };
}

export async function resetPatientPassword(payload: { email: string; code: string; new_password: string }): Promise<void> {
  await fetchApiData<Record<string, never>>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'reset_password', ...payload }
  });
  invalidateApiCache('/api/patient-auth');
}

export async function logoutPatientAccount(): Promise<void> {
  await fetchApiData<Record<string, never>>('/api/patient-auth', {
    method: 'POST',
    body: { action: 'logout' }
  });
  invalidateApiCache('/api/patient-auth');
  invalidateApiCache('/api/patient-portal');
}
