import { invalidateApiCache } from '@/services/apiClient';
import {
  HR_STAFF_INTEGRATION_ROLE_CODES,
  type HrStaffIntegrationRoleCode,
} from '../../../shared/hrStaffIntegrationRoles';

// ── Department constants ───────────────────────────────────────────────────────
const DEPT_NAME = 'Cashier';
export type CashierRoleType = HrStaffIntegrationRoleCode;

// ── Types ──────────────────────────────────────────────────────────────────────

export type HrStaffRequestRow = {
  id: number;
  request_reference: string;
  staff_id: number;
  employee_no: string;
  staff_name: string;
  role_type: string;
  department_name: string;
  request_status: 'pending' | 'approved' | 'rejected' | 'queue' | 'waiting_applicant' | 'hiring' | 'hired';
  request_notes: string | null;
  requested_by: string | null;
  decided_by: string | null;
  decided_at: string | null;
  created_at: string;
  updated_at: string;
};

export type HrStaffRequestStatus = {
  totals: { activeRoster: number; workingRoster: number; pendingRequests: number; approvedRequests: number };
  recentRequests: HrStaffRequestRow[];
};

type Meta = { page: number; perPage: number; total: number; totalPages: number };
type PagedResult<T> = { items: T[]; meta: Meta };

// ── Supabase REST helpers ──────────────────────────────────────────────────────

function trimSlash(v: string): string { return v.replace(/\/+$/, ''); }
function resolveSupabaseUrl(): string { return trimSlash((import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? ''); }
function resolveSupabaseKey(): string {
  return (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ||
    (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined)?.trim() || '';
}
function authHeaders(): Record<string, string> {
  const k = resolveSupabaseKey();
  return { 'apikey': k, 'Authorization': `Bearer ${k}`, 'Content-Type': 'application/json' };
}
function assertConfig(): void {
  if (!resolveSupabaseUrl() || !resolveSupabaseKey())
    throw new Error('HR integration not configured. Add VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY to .env');
}

async function sbCount(table: string, filter: string): Promise<number> {
  assertConfig();
  const res = await fetch(`${resolveSupabaseUrl()}/rest/v1/${table}?select=id${filter ? '&' + filter : ''}`, {
    method: 'HEAD', headers: { ...authHeaders(), 'Prefer': 'count=exact' }
  });
  const m = (res.headers.get('Content-Range') ?? '').match(/\/(\d+)$/);
  return m ? parseInt(m[1], 10) : 0;
}

async function sbGet<T>(path: string): Promise<T[]> {
  assertConfig();
  const res = await fetch(`${resolveSupabaseUrl()}/rest/v1/${path}`, { headers: authHeaders() });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  return res.json() as Promise<T[]>;
}

async function sbGetPaged<T>(path: string): Promise<{ data: T[]; count: number }> {
  assertConfig();
  const res = await fetch(`${resolveSupabaseUrl()}/rest/v1/${path}`, { headers: { ...authHeaders(), 'Prefer': 'count=exact' } });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
  const m = (res.headers.get('Content-Range') ?? '').match(/\/(\d+)$/);
  return { data: await res.json() as T[], count: m ? parseInt(m[1], 10) : 0 };
}

async function sbPost(table: string, body: Record<string, unknown>, prefer: string): Promise<void> {
  assertConfig();
  const res = await fetch(`${resolveSupabaseUrl()}/rest/v1/${table}`, {
    method: 'POST', headers: { ...authHeaders(), 'Prefer': prefer }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
}

async function sbPatch(table: string, filter: string, body: Record<string, unknown>): Promise<void> {
  assertConfig();
  const res = await fetch(`${resolveSupabaseUrl()}/rest/v1/${table}?${filter}`, {
    method: 'PATCH', headers: { ...authHeaders(), 'Prefer': 'return=representation' }, body: JSON.stringify(body)
  });
  if (!res.ok) throw new Error((await res.text()) || `Request failed (${res.status})`);
}

type RawRow = {
  id: number; request_reference: string; staff_id: number; request_status: string;
  request_notes: string | null; requested_by: string | null; decided_by: string | null;
  decided_at: string | null; created_at: string; updated_at: string;
  hr_staff_directory: { employee_no: string; full_name: string; role_type: string; department_name: string } | null;
};

function mapRow(r: RawRow): HrStaffRequestRow {
  const d = r.hr_staff_directory;
  return {
    id: r.id, request_reference: r.request_reference, staff_id: r.staff_id,
    employee_no: d?.employee_no ?? '', staff_name: d?.full_name ?? 'Unknown',
    role_type: d?.role_type ?? '', department_name: d?.department_name ?? '',
    request_status: r.request_status as HrStaffRequestRow['request_status'],
    request_notes: r.request_notes, requested_by: r.requested_by,
    decided_by: r.decided_by, decided_at: r.decided_at,
    created_at: r.created_at, updated_at: r.updated_at
  };
}

const EMBED = 'select=*,hr_staff_directory(employee_no,full_name,role_type,department_name)';

// ── Public API ─────────────────────────────────────────────────────────────────

export async function fetchHrStaffRequestStatus(): Promise<HrStaffRequestStatus> {
  const roleFilter = `role_type=in.(${HR_STAFF_INTEGRATION_ROLE_CODES.join(',')})`;
  const [active, working, pending, approved, recent] = await Promise.all([
    sbCount('hr_staff_directory', `${roleFilter}&employment_status=eq.active`),
    sbCount('hr_staff_directory', `${roleFilter}&employment_status=eq.working`),
    sbCount('hr_staff_requests', 'request_status=eq.pending'),
    sbCount('hr_staff_requests', 'request_status=eq.approved'),
    sbGet<RawRow>(`hr_staff_requests?${EMBED}&order=created_at.desc&limit=5`)
  ]);
  return {
    totals: { activeRoster: active, workingRoster: working, pendingRequests: pending, approvedRequests: approved },
    recentRequests: recent.map(mapRow)
  };
}

export async function fetchHrStaffRequests(params: {
  search?: string; status?: string; page?: number; perPage?: number;
} = {}): Promise<PagedResult<HrStaffRequestRow>> {
  const page = Math.max(1, params.page ?? 1);
  const perPage = Math.min(50, Math.max(1, params.perPage ?? 10));
  const offset = (page - 1) * perPage;
  const parts = [EMBED, `order=created_at.desc`, `limit=${perPage}`, `offset=${offset}`];
  if (params.status && params.status !== 'all') parts.push(`request_status=eq.${params.status}`);
  const { data, count } = await sbGetPaged<RawRow>(`hr_staff_requests?${parts.join('&')}`);
  let items = data.map(mapRow);
  if (params.search) {
    const q = params.search.toLowerCase();
    items = items.filter(r =>
      r.request_reference.toLowerCase().includes(q) ||
      r.employee_no.toLowerCase().includes(q) ||
      r.staff_name.toLowerCase().includes(q)
    );
  }
  return { items, meta: { page, perPage, total: count, totalPages: Math.max(1, Math.ceil(count / perPage)) } };
}

export async function createHrStaffRequest(payload: {
  roleType: HrStaffIntegrationRoleCode;
  requestedCount?: number;
  requestedBy?: string;
  requestNotes?: string;
}): Promise<void> {
  const { roleType, requestedCount = 1, requestedBy = `${DEPT_NAME} Admin`, requestNotes } = payload;
  const poolKey = `HR-REQ-POOL-${roleType.toUpperCase()}`;
  const poolName = roleType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

  await sbPost('hr_staff_directory', {
    employee_no: poolKey, full_name: `Open ${poolName} Hiring Request`,
    role_type: roleType, department_name: DEPT_NAME,
    employment_status: 'inactive', contact_email: null, contact_phone: null, hired_at: null
  }, 'resolution=ignore-duplicates,return=representation');

  const staffRows = await sbGet<{ id: number }>(`hr_staff_directory?employee_no=eq.${encodeURIComponent(poolKey)}&select=id&limit=1`);
  if (!staffRows.length) throw new Error('Failed to resolve placeholder staff entry.');

  const ref = `HR-REQ-${new Date().getFullYear()}-${Math.floor(10000 + Math.random() * 89999)}`;
  const notes = [requestNotes, `Requested count: ${Math.max(1, requestedCount)}`].filter(Boolean).join(' | ');
  await sbPost('hr_staff_requests', {
    request_reference: ref, staff_id: staffRows[0].id,
    request_status: 'pending', request_notes: notes || null, requested_by: requestedBy
  }, 'return=representation');

  invalidateApiCache('/api/integrations/hr-staff');
}

export async function updateHrStaffRequestStatus(payload: {
  id: number; requestStatus: HrStaffRequestRow['request_status']; decidedBy?: string;
}): Promise<void> {
  await sbPatch('hr_staff_requests', `id=eq.${payload.id}`, {
    request_status: payload.requestStatus,
    decided_by: payload.decidedBy || 'HR Admin',
    decided_at: new Date().toISOString()
  });
  invalidateApiCache('/api/integrations/hr-staff');
}
