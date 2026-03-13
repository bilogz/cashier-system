import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type AdminUser = {
  id: number;
  username: string;
  fullName: string;
  email?: string;
  role: string;
  department?: string;
  accessExemptions?: string[];
  isSuperAdmin: boolean;
  avatar?: string;
  unreadNotifications?: number;
  token: string;
};

type SessionUser = Omit<AdminUser, 'token' | 'avatar'>;

type AdminSessionResponse = {
  authenticated: boolean;
  user: SessionUser | null;
};

type CreateAdminAccountPayload = {
  username: string;
  email: string;
  full_name: string;
  password: string;
  role: string;
  department?: string;
  access_exemptions?: string[];
  phone?: string;
  status?: string;
  is_super_admin?: boolean;
};

function withClientFields(user: NonNullable<AdminSessionResponse['user']>): AdminUser {
  return {
    ...user,
    token: 'server-session',
    unreadNotifications: Number(user.unreadNotifications || 0)
  };
}

export async function fetchAdminSession(): Promise<AdminUser | null> {
  const data = await fetchApiData<AdminSessionResponse>('/api/admin-auth', { ttlMs: 5_000 });
  if (!data?.authenticated || !data.user) return null;
  return withClientFields(data.user);
}

export async function loginAdmin(username: string, password: string): Promise<AdminUser> {
  const data = await fetchApiData<{ user: NonNullable<AdminSessionResponse['user']> }>('/api/admin-auth', {
    method: 'POST',
    body: { action: 'login', username, password }
  });
  invalidateApiCache('/api/admin-auth');
  invalidateApiCache('/api/admin-profile');
  return withClientFields(data.user);
}

export async function logoutAdmin(): Promise<void> {
  await fetchApiData<unknown>('/api/admin-auth', {
    method: 'POST',
    body: { action: 'logout' }
  });
  invalidateApiCache('/api/admin-auth');
  invalidateApiCache('/api/admin-profile');
}

export async function createAdminAccount(payload: CreateAdminAccountPayload): Promise<void> {
  await fetchApiData<unknown>('/api/admin-auth', {
    method: 'POST',
    body: {
      action: 'create_account',
      ...payload
    }
  });
  invalidateApiCache('/api/admin-auth');
}
