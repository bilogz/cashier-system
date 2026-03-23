import type { AdminUser } from '@/services/adminAuth';
import type { menu } from '@/layouts/full/vertical-sidebar/sidebarItem';

type ModuleKey =
  | 'billing_verification'
  | 'manage_billing'
  | 'process_payment'
  | 'generate_receipt'
  | 'financial_transactions'
  | 'reports';

const MODULE_ROUTE_MAP: Record<ModuleKey, string> = {
  billing_verification: '/modules/billing-verification',
  manage_billing: '/modules/manage-billing',
  process_payment: '/modules/process-payment',
  generate_receipt: '/modules/generate-receipt',
  financial_transactions: '/modules/financial-transactions',
  reports: '/modules/reports'
};

const DEPARTMENT_MODULE_MAP: Array<{ matcher: RegExp; module: ModuleKey }> = [
  { matcher: /billing|assessment|verification/i, module: 'billing_verification' },
  { matcher: /accounting|records|ledger/i, module: 'manage_billing' },
  { matcher: /cashier|payment|collections/i, module: 'process_payment' },
  { matcher: /receipt|releasing|compliance|documentation/i, module: 'generate_receipt' },
  { matcher: /finance|transaction|treasury|report|analytics|reconciliation/i, module: 'reports' }
];

const ROLE_MODULE_MAP: Array<{ matcher: RegExp; module: ModuleKey }> = [
  { matcher: /billing|verification/i, module: 'billing_verification' },
  { matcher: /records|assessment|account/i, module: 'manage_billing' },
  { matcher: /cashier|payment|collector/i, module: 'process_payment' },
  { matcher: /receipt|compliance|documentation/i, module: 'generate_receipt' },
  { matcher: /report|analyst|audit|faculty|staff|finance|transaction|treasury/i, module: 'reports' }
];

function normalize(value: unknown): string {
  return String(value || '').trim().toLowerCase();
}

function normalizeModuleName(value: string): ModuleKey | null {
  const raw = normalize(value);
  if (!raw) return null;
  if (raw === 'billing_verification' || raw === 'billing-verification' || raw === 'billing verification')
    return 'billing_verification';
  if (raw === 'student_portal_billing' || raw === 'student-portal-billing' || raw === 'student portal & billing')
    return 'billing_verification';
  if (raw === 'manage_billing' || raw === 'manage-billing' || raw === 'manage billing') return 'manage_billing';
  if (raw === 'pay_bills' || raw === 'pay-bills' || raw === 'pay bills') return 'manage_billing';
  if (raw === 'process_payment' || raw === 'process-payment' || raw === 'process payment') return 'process_payment';
  if (
    raw === 'payment_processing_gateway' ||
    raw === 'payment-processing-gateway' ||
    raw === 'payment processing & gateway'
  )
    return 'process_payment';
  if (raw === 'generate_receipt' || raw === 'generate-receipt' || raw === 'generate receipt') return 'generate_receipt';
  if (
    raw === 'compliance_documentation' ||
    raw === 'compliance-documentation' ||
    raw === 'compliance & documentation'
  )
    return 'generate_receipt';
  if (raw === 'financial_transactions' || raw === 'financial-transactions' || raw === 'financial transactions')
    return 'financial_transactions';
  if (
    raw === 'reports' ||
    raw === 'report' ||
    raw === 'reporting_reconciliation' ||
    raw === 'reporting-reconciliation' ||
    raw === 'reporting & reconciliation'
  )
    return 'reports';
  return null;
}

function isSuperAdmin(user: AdminUser | null): boolean {
  if (!user) return false;
  return Boolean(user.isSuperAdmin) || normalize(user.role) === 'admin';
}

export function resolveModuleForUser(user: AdminUser | null): ModuleKey | null {
  if (!user) return null;
  if (isSuperAdmin(user)) return null;

  const department = String(user.department || '');
  for (const entry of DEPARTMENT_MODULE_MAP) {
    if (entry.matcher.test(department)) return entry.module;
  }

  const role = String(user.role || '');
  for (const entry of ROLE_MODULE_MAP) {
    if (entry.matcher.test(role)) return entry.module;
  }
  return null;
}

export function resolveAllowedModulesForUser(user: AdminUser | null): ModuleKey[] {
  if (!user) return [];
  if (isSuperAdmin(user)) return Object.keys(MODULE_ROUTE_MAP) as ModuleKey[];

  const allowed = new Set<ModuleKey>();
  const base = resolveModuleForUser(user);
  if (base) allowed.add(base);

  const exemptions = Array.isArray(user.accessExemptions) ? user.accessExemptions : [];
  exemptions.forEach((entry) => {
    const normalized = normalizeModuleName(entry);
    if (normalized) allowed.add(normalized);
  });

  if (!allowed.size) return ['billing_verification'];
  return Array.from(allowed);
}

export function defaultRouteForUser(user: AdminUser | null): string {
  if (!user) return '/admin/login';
  if (isSuperAdmin(user)) return '/dashboard/default';
  const modules = resolveAllowedModulesForUser(user);
  if (!modules.length) return '/modules/billing-verification';
  return MODULE_ROUTE_MAP[modules[0]];
}

export function allowedModuleRoutesForUser(user: AdminUser | null): string[] {
  if (!user) return [];
  if (isSuperAdmin(user)) return Object.values(MODULE_ROUTE_MAP);
  const modules = resolveAllowedModulesForUser(user);
  return modules.map((module) => MODULE_ROUTE_MAP[module]);
}

function isRouteAlwaysAllowed(path: string): boolean {
  return (
    path === '/dashboard/default' ||
    path === '/modules/hr-staff-request' ||
    path === '/modules/settings' ||
    path === '/profile' ||
    path === '/logout' ||
    path.startsWith('/admin/') ||
    path === '/login' ||
    path === '/register' ||
    path === '/access-denied'
  );
}

export function canAccessPath(user: AdminUser | null, path: string): boolean {
  if (!user) return false;
  if (isSuperAdmin(user)) return true;
  if (isRouteAlwaysAllowed(path)) return true;

  const allowedRoutes = allowedModuleRoutesForUser(user);
  return allowedRoutes.some((route) => path === route || path.startsWith(`${route}/`));
}

function filterMenu(items: menu[], user: AdminUser | null): menu[] {
  return items
    .map((item) => {
      if (item.header || item.divider) return item;
      if (item.children?.length) {
        const children = filterMenu(item.children, user);
        if (!children.length) return null;
        return { ...item, children };
      }
      if (item.to && !canAccessPath(user, item.to)) return null;
      return item;
    })
    .filter(Boolean) as menu[];
}

export function filterSidebarItemsByAccess(items: menu[], user: AdminUser | null): menu[] {
  return filterMenu(items, user);
}
