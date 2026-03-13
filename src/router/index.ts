import { createRouter, createWebHistory } from 'vue-router';
import MainRoutes from './MainRoutes';
import PublicRoutes from './PublicRoutes';
import { useAuthStore } from '@/stores/auth';
import { canAccessPath } from '@/config/accessControl';

export const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL || '/'),
  routes: [
    {
      path: '/:pathMatch(.*)*',
      component: () => import('@/views/pages/maintenance/error/Error404Page.vue')
    },
    MainRoutes,
    PublicRoutes
  ]
});

router.beforeEach(async (to, from, next) => {
  const auth = useAuthStore();
  await auth.hydrateSession();
  const authRequired = to.matched.some((record) => record.meta.requiresAuth);
  const isAdminAuthPage = ['/admin/login', '/admin/login1', '/login', '/login1'].includes(to.path);
  const isRegisterPage = ['/admin/register', '/register'].includes(to.path);

  if (authRequired && !auth.user) {
    auth.returnUrl = to.fullPath;
    next('/admin/login');
    return;
  }

  if (authRequired && auth.user && !canAccessPath(auth.user, to.path)) {
    next('/access-denied');
    return;
  }

  if (auth.user && isAdminAuthPage) {
    next(auth.returnUrl || auth.defaultRouteForUser(auth.user));
    return;
  }

  if (isRegisterPage && !auth.user) {
    auth.returnUrl = to.fullPath;
    next('/admin/login');
    return;
  }

  if (isRegisterPage && auth.user && !auth.user.isSuperAdmin) {
    next(auth.defaultRouteForUser(auth.user));
    return;
  }

  next();
});
