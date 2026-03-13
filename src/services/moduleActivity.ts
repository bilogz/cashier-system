import { fetchApiData } from '@/services/apiClient';

export type ModuleActivityItem = {
  id: number;
  module: string;
  action: string;
  detail: string;
  actor: string;
  entity_type: string | null;
  entity_key: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type ModuleActivityPayload = {
  items: ModuleActivityItem[];
  meta: {
    page: number;
    perPage: number;
    total: number;
    totalPages: number;
  };
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/module-activity`;
  return '/api/module-activity';
}

export async function fetchModuleActivity(query: {
  module?: string;
  actor?: string;
  search?: string;
  page?: number;
  perPage?: number;
}): Promise<ModuleActivityPayload> {
  const params = new URLSearchParams();
  if (query.module?.trim()) params.set('module', query.module.trim());
  if (query.actor?.trim()) params.set('actor', query.actor.trim());
  if (query.search?.trim()) params.set('search', query.search.trim());
  if (query.page && query.page > 0) params.set('page', String(query.page));
  if (query.perPage && query.perPage > 0) params.set('per_page', String(query.perPage));

  const url = `${resolveApiUrl()}${params.toString() ? `?${params.toString()}` : ''}`;
  return await fetchApiData<ModuleActivityPayload>(url, { ttlMs: 8_000 });
}
