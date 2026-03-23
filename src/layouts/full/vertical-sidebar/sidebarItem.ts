export interface menu {
  header?: string;
  title?: string;
  icon?: object | string;
  to?: string;
  divider?: boolean;
  chip?: string;
  chipColor?: string;
  chipVariant?: string;
  chipIcon?: string;
  children?: menu[];
  disabled?: boolean;
  type?: string;
  subCaption?: string;
}

const sidebarItem: menu[] = [
  { header: 'Cashier System' },
  {
    title: 'Dashboard',
    icon: 'mdi-view-dashboard-outline',
    to: '/dashboard/default'
  },
  { divider: true },
  { header: 'Cashier Flow' },
  {
    title: 'Registrar Enrollment Feed',
    icon: 'mdi-account-search-outline',
    to: '/modules/billing-verification'
  },
  {
    title: 'Pay Bills',
    icon: 'mdi-file-document-edit-outline',
    to: '/modules/manage-billing'
  },
  {
    title: 'Payment Processing & Gateway',
    icon: 'mdi-cash-fast',
    to: '/modules/process-payment'
  },
  {
    title: 'Paid Student List Feed',
    icon: 'mdi-account-cash-outline',
    to: '/modules/billing-verification/crad-student-list-feed'
  },
  {
    title: 'Compliance & Documentation',
    icon: 'mdi-receipt-text-outline',
    to: '/modules/generate-receipt'
  },
  {
    title: 'Report Center',
    icon: 'mdi-file-chart-outline',
    to: '/modules/report-center'
  },
  {
    title: 'Completed Transactions',
    icon: 'mdi-chart-line',
    to: '/modules/reports'
  },
  { divider: true },
  { header: 'System' },
  {
    title: 'My Profile',
    icon: 'mdi-account-outline',
    to: '/profile'
  },
  {
    title: 'Settings',
    icon: 'mdi-cog-outline',
    to: '/modules/settings'
  },
  {
    title: 'Logout',
    icon: 'mdi-logout',
    to: '/logout'
  }
];

export default sidebarItem;
