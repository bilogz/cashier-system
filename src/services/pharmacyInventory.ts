import { fetchApiData, invalidateApiCache } from '@/services/apiClient';

export type PharmacyMedicine = {
  id: number;
  sku: string;
  name: string;
  brandName: string;
  genericName: string;
  dosageStrength: string;
  category: string;
  type: string;
  supplier: string;
  purchaseCost: number;
  sellingPrice: number;
  batchNo: string;
  mfgDate: string;
  stock: number;
  capacity: number;
  lowThreshold: number;
  reorderLevel: number;
  expiryDate: string;
  unit: string;
  stockLocation: string;
  storageRequirements: string;
  barcode: string;
};

export type PharmacyDispenseRequest = {
  id: number;
  patientName: string;
  medicineName: string;
  quantity: number;
  notes: string;
  prescriptionRef: string;
  dispenseReason: string;
  requestedAt: string;
  status: 'Pending' | 'Fulfilled';
};

export type PharmacyInventoryLog = {
  id: number;
  detail: string;
  actor: string;
  at: string;
  tone: 'success' | 'warning' | 'info' | 'error';
};

export type PharmacyStockHistoryEntry = {
  id: number;
  event: string;
  by: string;
  at: string;
  detail: string;
};

export type PharmacySnapshot = {
  medicines: PharmacyMedicine[];
  requests: PharmacyDispenseRequest[];
  logs: PharmacyInventoryLog[];
  history: Record<number, PharmacyStockHistoryEntry[]>;
};

function trimTrailingSlashes(value: string): string {
  return value.replace(/\/+$/, '');
}

function resolveApiUrl(): string {
  const directApi = import.meta.env.VITE_PHARMACY_API_URL?.trim();
  if (directApi) return trimTrailingSlashes(directApi);
  const configured = import.meta.env.VITE_BACKEND_API_BASE_URL?.trim();
  if (configured) return `${trimTrailingSlashes(configured)}/pharmacy`;
  return '/api/pharmacy';
}

function toTimeText(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || '--';
  return new Intl.DateTimeFormat('en-US', { hour: '2-digit', minute: '2-digit' }).format(parsed);
}

export async function fetchPharmacySnapshot(): Promise<PharmacySnapshot> {
  const data = await fetchApiData<{
    medicines: any[];
    requests: any[];
    logs: any[];
    movements: any[];
  }>(resolveApiUrl(), { ttlMs: 8_000 });

  const medicines: PharmacyMedicine[] = (data.medicines || []).map((item) => ({
    id: Number(item.id || 0),
    sku: String(item.sku || ''),
    name: String(item.medicine_name || ''),
    brandName: String(item.brand_name || ''),
    genericName: String(item.generic_name || ''),
    dosageStrength: String(item.dosage_strength || ''),
    category: String(item.category || ''),
    type: String(item.medicine_type || ''),
    supplier: String(item.supplier_name || ''),
    purchaseCost: Number(item.purchase_cost || 0),
    sellingPrice: Number(item.selling_price || 0),
    batchNo: String(item.batch_lot_no || ''),
    mfgDate: String(item.manufacturing_date || ''),
    stock: Number(item.stock_on_hand || 0),
    capacity: Number(item.stock_capacity || 0),
    lowThreshold: Number(item.low_stock_threshold || 0),
    reorderLevel: Number(item.reorder_level || 0),
    expiryDate: String(item.expiry_date || ''),
    unit: String(item.unit_of_measure || ''),
    stockLocation: String(item.stock_location || ''),
    storageRequirements: String(item.storage_requirements || ''),
    barcode: String(item.barcode || '')
  }));

  const requests: PharmacyDispenseRequest[] = (data.requests || []).map((item) => ({
    id: Number(item.id || 0),
    patientName: String(item.patient_name || ''),
    medicineName: String(item.medicine_name || ''),
    quantity: Number(item.quantity || 0),
    notes: String(item.notes || ''),
    prescriptionRef: String(item.prescription_reference || ''),
    dispenseReason: String(item.dispense_reason || ''),
    requestedAt: String(item.requested_at || ''),
    status: String(item.status || 'Pending') as 'Pending' | 'Fulfilled'
  }));

  const logs: PharmacyInventoryLog[] = (data.logs || []).map((item) => ({
    id: Number(item.id || 0),
    detail: String(item.detail || ''),
    actor: String(item.actor || ''),
    at: toTimeText(String(item.created_at || '')),
    tone: String(item.tone || 'info') as 'success' | 'warning' | 'info' | 'error'
  }));

  const history: Record<number, PharmacyStockHistoryEntry[]> = {};
  (data.movements || []).forEach((row) => {
    const medicineId = Number(row.medicine_id || 0);
    if (!medicineId) return;
    if (!history[medicineId]) history[medicineId] = [];
    history[medicineId].push({
      id: Number(row.id || 0),
      event: String(row.movement_type || ''),
      by: String(row.actor || ''),
      at: toTimeText(String(row.created_at || '')),
      detail: String(row.reason || '')
    });
  });

  return { medicines, requests, logs, history };
}

export async function dispatchPharmacyAction(payload: Record<string, unknown>): Promise<void> {
  await fetchApiData<unknown>(resolveApiUrl(), {
    method: 'POST',
    body: payload
  });
  invalidateApiCache('/api/pharmacy');
  invalidateApiCache('/api/dashboard');
  invalidateApiCache('/api/reports');
  invalidateApiCache('/api/patients');
}
