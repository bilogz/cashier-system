const PublicRoutes = {
  path: '/',
  component: () => import('@/layouts/blank/BlankLayout.vue'),
  meta: {
    requiresAuth: false
  },
  children: [
    {
      name: 'Student Home',
      path: '/student/',
      component: () => import('@/views/student/pages/StudentPortalPage.vue')
    },
    {
      name: 'Student Booking',
      path: '/student/booking',
      component: () => import('@/views/student/pages/StudentPortalPage.vue')
    },
    {
      path: '/',
      redirect: '/student/'
    },
    {
      path: '/student',
      redirect: '/student/'
    },
    {
      path: '/admin',
      redirect: '/student/'
    },
    {
      path: '/patient',
      redirect: '/student/'
    },
    {
      path: '/patient/',
      redirect: '/student/'
    },
    {
      path: '/patient/booking',
      redirect: '/student/'
    },
    {
      path: '/admin/:pathMatch(.*)*',
      redirect: (to: any) => {
        const raw = Array.isArray(to.params.pathMatch) ? to.params.pathMatch.join('/') : String(to.params.pathMatch || '');
        const normalized = raw.replace(/^\/+|\/+$/g, '');
        if (!normalized) return '/admin/login';
        if (normalized === 'login' || normalized === 'login1' || normalized === 'register') return `/admin/${normalized}`;
        return `/${normalized}`;
      }
    },
    {
      name: 'Admin Login',
      path: '/admin/login',
      component: () => import('@/views/cashier/auth/LoginPage.vue')
    },
    {
      name: 'Admin Login Alt',
      path: '/admin/login1',
      component: () => import('@/views/cashier/auth/LoginAltPage.vue')
    },
    {
      name: 'Admin Register',
      path: '/admin/register',
      component: () => import('@/views/cashier/auth/RegisterPage.vue')
    },
    {
      path: '/login',
      redirect: '/admin/login'
    },
    {
      path: '/login1',
      redirect: '/admin/login1'
    },
    {
      path: '/register',
      redirect: '/admin/register'
    },
    {
      name: 'Error 404',
      path: '/error',
      component: () => import('@/views/pages/maintenance/error/Error404Page.vue')
    },
    {
      name: 'Access Denied',
      path: '/access-denied',
      component: () => import('@/views/pages/maintenance/error/AccessDeniedPage.vue')
    }
  ]
};

export default PublicRoutes;
