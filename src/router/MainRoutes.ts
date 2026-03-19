const MainRoutes = {
  path: '/main',
  meta: {
    requiresAuth: true
  },
  redirect: '/dashboard/default',
  component: () => import('@/layouts/full/FullLayout.vue'),
  children: [
    {
      name: 'Default',
      path: '/dashboard/default',
      component: () => import('@/views/dashboards/default/DefaultDashboard.vue')
    },
    {
      name: 'Student Portal & Billing',
      path: '/modules/billing-verification',
      component: () => import('@/views/cashier/modules/StudentBillingPage.vue'),
      meta: {
        pageTitle: 'Student Portal & Billing',
        pageDescription: 'View student billing details, account statements, payment eligibility, and forward valid billings to Pay Bills.'
      }
    },
    {
      name: 'Pay Bills',
      path: '/modules/manage-billing',
      component: () => import('@/views/cashier/modules/ManageStudentBillingPage.vue'),
      meta: {
        pageTitle: 'Pay Bills',
        pageDescription: 'Accept bill settlements, support installment or full payment, and forward requests to the gateway flow.'
      }
    },
    {
      name: 'Payment Processing & Gateway',
      path: '/modules/process-payment',
      component: () => import('@/views/cashier/modules/ProcessPaymentPage.vue'),
      meta: {
        pageTitle: 'Payment Processing & Gateway',
        pageDescription: 'Validate payment requests, monitor transaction status, and post successful or failed gateway results.'
      }
    },
    {
      name: 'Compliance & Documentation',
      path: '/modules/generate-receipt',
      component: () => import('@/views/cashier/modules/GenerateReceiptPage.vue'),
      meta: {
        pageTitle: 'Compliance & Documentation',
        pageDescription: 'Generate proof of payment, verify payment documents, and complete the compliance package.'
      }
    },
    {
      name: 'Financial Transactions',
      path: '/modules/financial-transactions',
      component: () => import('@/views/cashier/modules/FinancialTransactionsPage.vue'),
      meta: {
        pageTitle: 'Financial Transactions',
        pageDescription: 'Static transaction management view for cashier logs, audit trail, and payment history.'
      }
    },
    {
      name: 'Report Center',
      path: '/modules/report-center',
      component: () => import('@/views/cashier/modules/ReportCenterPage.vue'),
      meta: {
        pageTitle: 'Report Center',
        pageDescription: 'Receive PMED report requests, prepare reconciled cashier report packages, and send financial reports back to PMED.'
      }
    },
    {
      name: 'Completed Transactions',
      path: '/modules/reports',
      component: () => import('@/views/cashier/modules/ReportsDashboardPage.vue'),
      meta: {
        pageTitle: 'Completed Transactions',
        pageDescription: 'Review finalized cashier records, archive completed transactions, and handle remaining discrepancies if records are sent back.'
      }
    },
    {
      name: 'Settings',
      path: '/modules/settings',
      component: () => import('@/views/cashier/modules/SettingsPage.vue'),
      meta: {
        pageTitle: 'Settings',
        pageDescription: 'Static configuration page for cashier preferences, permissions, and dashboard options.'
      }
    },
    {
      name: 'My Profile',
      path: '/profile',
      component: () => import('@/views/profile/MyProfilePage.vue')
    },
    {
      name: 'Logout',
      path: '/logout',
      component: () => import('@/views/cashier/modules/LogoutPage.vue')
    }
  ]
};

export default MainRoutes;
