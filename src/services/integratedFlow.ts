import { fetchApiData } from '@/services/apiClient';

export type IntegratedFlowEdge = {
  from: string;
  to: string;
  artifact: string;
};

export type IntegratedFlowPayload = {
  flow: {
    nodes: string[];
    edges: IntegratedFlowEdge[];
  };
  department: string;
  incoming: IntegratedFlowEdge[];
  outgoing: IntegratedFlowEdge[];
};

export async function fetchIntegratedFlow(department = ''): Promise<IntegratedFlowPayload> {
  const query = department.trim() ? `?department=${encodeURIComponent(department.trim())}` : '';
  return await fetchApiData<IntegratedFlowPayload>(`/api/integrated-flow${query}`, { ttlMs: 30_000 });
}

