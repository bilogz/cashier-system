import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type DispatchResult = {
  ok: boolean;
  event_id?: string;
  correlation_id?: string;
  route_key?: string;
  source_department_key?: string;
  target_department_key?: string;
  event_code?: string;
  status?: string;
  dispatch_endpoint?: string;
  message?: string;
};

export type FlowEventStatus = {
  ok: boolean;
  event_id?: string;
  correlation_id?: string;
  route_key?: string;
  flow_name?: string;
  source_department_key?: string;
  target_department_key?: string;
  event_code?: string;
  status?: string;
  request_payload?: Record<string, unknown>;
  response_payload?: Record<string, unknown>;
  last_error?: string;
  dispatched_at?: string;
  acknowledged_at?: string;
  created_at?: string;
  updated_at?: string;
};

export type IntegrationDepartment = {
  department_key: string;
  department_name: string;
  system_code: string;
  module_directory: string;
  purpose: string;
  default_action_label: string;
  dispatch_rpc_name: string;
  status_rpc_name: string;
  ack_rpc_name: string;
  dispatch_endpoint: string;
  pending_count: number;
  in_progress_count: number;
  failed_count: number;
  completed_count: number;
  route_count: number;
  latest_status: string | null;
  latest_event_code: string | null;
  latest_correlation_id: string | null;
  latest_created_at: string | null;
  routes: Array<{
    route_key: string;
    flow_name: string;
    event_code: string;
    endpoint_path: string;
    priority: number;
    is_required: boolean;
  }>;
};

export type IntegrationRegistry = IntegrationDepartment[];

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveSupabaseUrl(): string {
  const configured = import.meta.env.VITE_SUPABASE_URL?.trim();
  return configured ? trimTrailingSlashes(configured) : '';
}

function resolveSupabaseKey(): string {
  return (
    import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ||
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ''
  );
}

function resolveBackendApiBase(): string {
  const configured =
    import.meta.env.VITE_BACKEND_API_BASE_URL?.trim() ||
    import.meta.env.VITE_API_BASE_URL?.trim() ||
    '';

  return configured ? trimTrailingSlashes(configured) : '';
}

function buildBackendUrl(path: string): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const base = resolveBackendApiBase();

  if (!base) {
    return normalizedPath;
  }

  if (base.endsWith('/api') && normalizedPath.startsWith('/api/')) {
    return `${base}${normalizedPath.slice(4)}`;
  }

  return `${base}${normalizedPath}`;
}

async function parseRpcResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  const text = await response.text();
  const trimmed = text.trim();

  if (!trimmed) {
    if (!response.ok) {
      throw new Error(fallbackMessage);
    }

    return {} as T;
  }

  try {
    const payload = JSON.parse(trimmed) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        String(payload.message || payload.error_description || payload.error || fallbackMessage)
      );
    }

    return payload as T;
  } catch (error) {
    if (!response.ok) {
      throw error instanceof Error ? error : new Error(fallbackMessage);
    }

    return trimmed as T;
  }
}

async function callSupabaseRpc<T>(
  rpcName: string,
  payload: Record<string, unknown> = {},
  params?: URLSearchParams
): Promise<T> {
  const supabaseUrl = resolveSupabaseUrl();
  const supabaseKey = resolveSupabaseKey();

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase department integration is not configured.');
  }

  const query = params && params.toString() ? `?${params.toString()}` : '';
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/${rpcName}${query}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': supabaseKey,
      'Authorization': `Bearer ${supabaseKey}`
    },
    body: JSON.stringify(payload)
  });

  return await parseRpcResponse<T>(response, `Supabase RPC ${rpcName} failed (${response.status}).`);
}

async function callFallbackEndpoint<T>(
  path: string,
  options: {
    method?: string;
    body?: Record<string, unknown>;
  } = {}
): Promise<T> {
  return await fetchApiData<T>(buildBackendUrl(path), {
    method: options.method,
    body: options.body
  });
}

export async function dispatchDepartmentFlow(
  sourceDepartment: string,
  targetDepartment: string,
  eventCode: string,
  payload: Record<string, unknown> = {},
  sourceRecordId?: string
): Promise<DispatchResult> {
  const requestPayload = {
    _source_department_key: sourceDepartment,
    _target_department_key: targetDepartment,
    _event_code: eventCode,
    _source_record_id: sourceRecordId || null,
    _payload: payload,
    _requested_by: null
  };

  try {
    if (resolveSupabaseUrl() && resolveSupabaseKey()) {
      return await callSupabaseRpc<DispatchResult>('dispatch_department_flow', requestPayload);
    }

    return await callFallbackEndpoint<DispatchResult>('/api/integrations/dispatch', {
      method: 'POST',
      body: {
        source_department_key: sourceDepartment,
        target_department_key: targetDepartment,
        event_code: eventCode,
        payload,
        source_record_id: sourceRecordId || null
      }
    });
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? error.message : 'Failed to dispatch department flow.'
    };
  }
}

export async function getFlowEventStatus(eventId?: string, correlationId?: string): Promise<FlowEventStatus> {
  try {
    if (resolveSupabaseUrl() && resolveSupabaseKey()) {
      const params = new URLSearchParams();
      if (eventId) params.append('event_id', eventId);
      if (correlationId) params.append('correlation_id', correlationId);

      return await callSupabaseRpc<FlowEventStatus>('get_department_flow_status', {}, params);
    }

    return await callFallbackEndpoint<FlowEventStatus>('/api/integrations/status', {
      method: 'POST',
      body: {
        event_id: eventId || null,
        correlation_id: correlationId || null
      }
    });
  } catch (error) {
    return {
      ok: false,
      last_error: error instanceof Error ? error.message : 'Failed to fetch department flow status.'
    };
  }
}

export async function acknowledgeFlowEvent(
  eventId: string,
  status: string = 'acknowledged',
  response: Record<string, unknown> = {},
  error?: string
): Promise<{ ok: boolean; message?: string }> {
  const requestPayload = {
    _event_id: eventId,
    _status: status,
    _response: response,
    _error: error || null
  };

  try {
    if (resolveSupabaseUrl() && resolveSupabaseKey()) {
      return await callSupabaseRpc<{ ok: boolean; message?: string }>(
        'acknowledge_department_flow',
        requestPayload
      );
    }

    return await callFallbackEndpoint<{ ok: boolean; message?: string }>('/api/integrations/acknowledge', {
      method: 'POST',
      body: {
        event_id: eventId,
        status,
        response,
        error: error || null
      }
    });
  } catch (caughtError) {
    return {
      ok: false,
      message: caughtError instanceof Error ? caughtError.message : 'Failed to acknowledge department flow.'
    };
  }
}

export async function getIntegrationRegistry(sourceDepartment?: string): Promise<IntegrationRegistry> {
  try {
    if (resolveSupabaseUrl() && resolveSupabaseKey()) {
      const params = new URLSearchParams();
      if (sourceDepartment) {
        params.append('source_department_key', sourceDepartment);
      }

      return await callSupabaseRpc<IntegrationRegistry>(
        'get_department_integration_registry',
        {},
        params
      );
    }

    return await callFallbackEndpoint<IntegrationRegistry>('/api/integrations/registry');
  } catch {
    return [];
  }
}

export function invalidateIntegrationCache(): void {
  invalidateApiCache('/api/integrations');
  invalidateApiCache('/api/integrations/registry');
  invalidateApiCache('/api/integrations/dispatch');
}
