import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type StudentPortalUser = {
  id: number;
  studentId: number;
  username: string;
  studentNumber: string;
  fullName: string;
  program?: string;
  yearLevel?: string;
  email?: string;
  phone?: string;
};

type StudentSessionResponse = {
  authenticated: boolean;
  account: StudentPortalUser | null;
};

export async function fetchStudentPortalSession(): Promise<StudentPortalUser | null> {
  const data = await fetchApiData<StudentSessionResponse>('/api/student-auth', { ttlMs: 5_000 });
  return data?.authenticated ? data.account : null;
}

export async function loginStudentPortal(login: string, password: string): Promise<StudentPortalUser> {
  const data = await fetchApiData<{ account: StudentPortalUser }>('/api/student-auth', {
    method: 'POST',
    body: {
      action: 'login',
      login,
      password
    }
  });
  invalidateApiCache('/api/student-auth');
  invalidateApiCache('/api/student/account-statement');
  invalidateApiCache('/api/student/billings');
  invalidateApiCache('/api/student/invoices');
  invalidateApiCache('/api/student/receipts');
  invalidateApiCache('/api/billings/payable');
  return data.account;
}

export async function logoutStudentPortal(): Promise<void> {
  await fetchApiData<Record<string, never>>('/api/student-auth', {
    method: 'POST',
    body: { action: 'logout' }
  });
  invalidateApiCache('/api/student-auth');
  invalidateApiCache('/api/student/account-statement');
  invalidateApiCache('/api/student/billings');
  invalidateApiCache('/api/student/invoices');
  invalidateApiCache('/api/student/receipts');
  invalidateApiCache('/api/billings/payable');
}
