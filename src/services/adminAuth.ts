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

const OFFLINE_DEMO_ACCOUNTS = [
  {
    username: 'admin@cashier.local',
    password: 'admin123',
    fullName: 'Cashier Super Admin',
    role: 'Super Admin',
    department: 'Administration',
    isSuperAdmin: true
  },
  {
    username: 'staff@cashier.local',
    password: 'staff123',
    fullName: 'Cashier Staff',
    role: 'Staff',
    department: 'Cashier',
    isSuperAdmin: false
  },
  {
    username: 'compliance@cashier.local',
    password: 'compliance123',
    fullName: 'Compliance Staff',
    role: 'Compliance',
    department: 'Compliance',
    isSuperAdmin: false
  }
] as const;

function withClientFields(user: NonNullable<AdminSessionResponse['user']>): AdminUser {
  return {
    ...user,
    token: 'server-session',
    unreadNotifications: Number(user.unreadNotifications || 0)
  };
}

function buildOfflineDemoUser(username: string, password: string): AdminUser | null {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  const normalizedPassword = String(password || '');
  const matched = OFFLINE_DEMO_ACCOUNTS.find(
    (item) => item.username.toLowerCase() === normalizedUsername && item.password === normalizedPassword
  );
  if (!matched) return null;

  return {
    id: normalizedUsername === 'admin@cashier.local' ? 1 : normalizedUsername === 'staff@cashier.local' ? 2 : 3,
    username: matched.username,
    fullName: matched.fullName,
    email: matched.username,
    role: matched.role,
    department: matched.department,
    accessExemptions: [],
    isSuperAdmin: matched.isSuperAdmin,
    unreadNotifications: 0,
    token: 'offline-session'
  };
}

export async function fetchAdminSession(): Promise<AdminUser | null> {
  try {
    const data = await fetchApiData<AdminSessionResponse>('/api/admin-auth', {
      ttlMs: 5_000,
      timeoutMs: 3_500
    });
    if (!data?.authenticated || !data.user) return null;
    return withClientFields(data.user);
  } catch {
    return null;
  }
}

export async function loginAdmin(username: string, password: string): Promise<AdminUser> {
  try {
    const data = await fetchApiData<{ user: NonNullable<AdminSessionResponse['user']> }>('/api/admin-auth', {
      method: 'POST',
      body: { action: 'login', username, password },
      timeoutMs: 10_000
    });
    invalidateApiCache('/api/admin-auth');
    invalidateApiCache('/api/admin-profile');
    return withClientFields(data.user);
  } catch (error) {
    const offlineUser = buildOfflineDemoUser(username, password);
    if (offlineUser) {
      return offlineUser;
    }
    throw error;
  }
}

export async function logoutAdmin(): Promise<void> {
  await fetchApiData<unknown>('/api/admin-auth', {
    method: 'POST',
    body: { action: 'logout' },
    timeoutMs: 6_000
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
    },
    timeoutMs: 8_000
  });
  invalidateApiCache('/api/admin-auth');
}
