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

function readLocalUser(): AuthUser | null {
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
      try {
        const sessionUser = await fetchAdminSession();
        this.user = sessionUser;
      } catch {
        this.user = null;
      }
      this.sessionChecked = true;
      if (this.user) localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
      else localStorage.removeItem(LOCAL_USER_KEY);
      return this.user;
    },

    async login(username: string, password: string) {
      this.user = await loginAdmin(username.trim(), password);
      this.sessionChecked = true;
      localStorage.setItem(LOCAL_USER_KEY, JSON.stringify(this.user));
      const target = this.returnUrl || this.defaultRouteForUser(this.user);
      this.returnUrl = null;
      router.push(target);
    },

    async logout() {
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
