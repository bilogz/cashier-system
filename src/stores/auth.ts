import { defineStore } from 'pinia';
import { router } from '@/router';
import { createAdminAccount, fetchAdminSession, loginAdmin, logoutAdmin, type AdminUser } from '@/services/adminAuth';
import { defaultRouteForUser } from '@/config/accessControl';

type AuthUser = AdminUser;

type AuthState = {
  user: AuthUser | null;
  returnUrl: string | null;
  sessionChecked: boolean;
};

const LOCAL_USER_KEY = 'user';
const AUTH_BYPASS_ENABLED = false;
const BYPASS_PASSWORD = 'admin123';
const BYPASS_USER: AuthUser = {
  id: 1,
  username: 'admin@cashier.local',
  fullName: 'Local Admin',
  email: 'admin@cashier.local',
  role: 'Super Admin',
  department: 'Administration',
  accessExemptions: [],
  isSuperAdmin: true,
  token: 'auth-bypass'
};

function buildBypassUser(username?: string): AuthUser {
  const resolvedUsername = String(username || BYPASS_USER.username).trim() || BYPASS_USER.username;
  return {
    ...BYPASS_USER,
    username: resolvedUsername,
    email: resolvedUsername
  };
}

function readLocalUser(): AuthUser | null {
  if (AUTH_BYPASS_ENABLED) return BYPASS_USER;
  try {
    const raw = localStorage.getItem(LOCAL_USER_KEY);
    return raw ? (JSON.parse(raw) as AuthUser) : null;
  } catch {
    return null;
  }
}

export const useAuthStore = defineStore({
  id: 'auth',
  state: (): AuthState => ({
    user: readLocalUser(),
    returnUrl: null,
    sessionChecked: false
  }),
  actions: {
    defaultRouteForUser(user: AuthUser | null): string {
      return defaultRouteForUser(user);
    },

    async hydrateSession(force = false) {
      if (this.sessionChecked && !force) return this.user;
      const previousUser = this.user;
      if (AUTH_BYPASS_ENABLED) {
        try {
          const sessionUser = await fetchAdminSession();
          this.user = sessionUser || buildBypassUser();
          if (!sessionUser) {
            await loginAdmin(this.user.username, BYPASS_PASSWORD);
          }
        } catch {
          this.user = buildBypassUser();
        }
        this.sessionChecked = true;
        localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
        return this.user;
      }
      try {
        const sessionUser = await fetchAdminSession();
        this.user = sessionUser || (previousUser?.token === 'offline-session' ? previousUser : null);
      } catch {
        this.user = previousUser;
      }
      this.sessionChecked = true;
      if (this.user) localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
      else localStorage.removeItem(LOCAL_USER_KEY);
      return this.user;
    },

    async login(username: string, password: string) {
      if (AUTH_BYPASS_ENABLED) {
        const resolvedUsername = username.trim() || BYPASS_USER.username;
        const resolvedPassword = String(password || '').trim() || BYPASS_PASSWORD;
        try {
          this.user = await loginAdmin(resolvedUsername, resolvedPassword);
        } catch {
          this.user = buildBypassUser(resolvedUsername);
        }
        this.sessionChecked = true;
        localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
        const target = this.returnUrl || this.defaultRouteForUser(this.user);
        this.returnUrl = null;
        router.push(target);
        return;
      }
      this.user = await loginAdmin(username.trim(), password);
      this.sessionChecked = true;
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
      const target = this.returnUrl || this.defaultRouteForUser(this.user);
      this.returnUrl = null;
      router.push(target);
    },

    async logout() {
      if (AUTH_BYPASS_ENABLED) {
        this.user = { ...BYPASS_USER };
        this.sessionChecked = true;
        this.returnUrl = null;
        localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
        router.push(this.defaultRouteForUser(this.user));
        return;
      }
      try {
        await logoutAdmin();
      } catch {
        // keep local logout behavior
      }
      this.user = null;
      this.sessionChecked = true;
      this.returnUrl = null;
      localStorage.removeItem(LOCAL_USER_KEY);
      router.push('/admin/login');
    },

    async registerAdminAccount(payload: {
      username: string;
      email: string;
      full_name: string;
      password: string;
      role: string;
      phone?: string;
      status?: string;
      is_super_admin?: boolean;
    }) {
      if (!this.user?.isSuperAdmin) {
        throw new Error('Only super admin can create admin accounts.');
      }
      await createAdminAccount(payload);
    }
  }
});
