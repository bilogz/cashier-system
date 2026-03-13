<script setup lang="ts">
import { computed, onMounted, onUnmounted, reactive, ref, watch } from 'vue';
import SaasDateTimePickerField from '@/components/shared/SaasDateTimePickerField.vue';
import ModuleActivityLogs from '@/components/shared/ModuleActivityLogs.vue';
import { dispatchPharmacyAction, fetchPharmacySnapshot } from '@/services/pharmacyInventory';
import { useRealtimeListSync } from '@/composables/useRealtimeListSync';
import { REALTIME_POLICY } from '@/config/realtimePolicy';
import { emitSuccessModal } from '@/composables/useSuccessModal';

type StockState = 'Healthy' | 'Low' | 'Out of Stock';
type QuickFilter = 'all' | 'out' | 'low' | 'healthy' | 'expiring';
type SortKey = 'name' | 'stock' | 'type' | 'expiry';
type SortDirection = 'asc' | 'desc';
type ActionType = 'add' | 'edit' | 'archive' | 'restock' | 'dispense' | 'adjust' | 'fulfill';
type DispenseStatus = 'Pending' | 'Fulfilled';
type InventoryRole = 'Admin' | 'Pharmacist' | 'Pharmacy Staff' | 'Nurse' | 'Doctor';

type Medicine = {
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
  lastAdjustmentReason?: string;
};

type DispenseRequest = {
  id: number;
  patientName: string;
  medicineName: string;
  quantity: number;
  notes: string;
  prescriptionRef: string;
  dispenseReason: string;
  requestedAt: string;
  status: DispenseStatus;
};

type InventoryLog = {
  id: number;
  detail: string;
  actor: string;
  at: string;
  tone: 'success' | 'warning' | 'info';
};

type StockHistoryEntry = {
  id: number;
  event: string;
  by: string;
  at: string;
  detail: string;
};

const pageLoading = ref(true);
const pageReady = ref(false);

const searchQuery = ref('');
const categoryFilter = ref('All Categories');
const stockFilter = ref<'All' | StockState>('All');
const quickFilter = ref<QuickFilter>('all');
const sortBy = ref<SortKey>('stock');
const sortDirection = ref<SortDirection>('asc');
const listPage = ref(1);
const pageSize = ref(6);
const pageSizeOptions = [6, 10, 20];
const selectedMedicineId = ref<number | null>(null);
const historyDrawer = ref(false);
const historyMedicineId = ref<number | null>(null);

const alertsDialog = ref(false);
const selectedMedicineDialog = ref(false);
const actionDialog = ref(false);
const actionType = ref<ActionType>('restock');
const actionLoading = ref(false);
const actionDraftLoading = ref(false);
const actionMedicineId = ref<number | null>(null);
const actionRequest = ref<DispenseRequest | null>(null);
const sessionRole = ref<InventoryRole>('Pharmacist');
const formErrors = reactive<Record<string, string>>({});

const snackbar = ref(false);
const snackbarText = ref('');
const snackbarColor = ref<'success' | 'info' | 'warning' | 'error'>('success');

const medicines = ref<Medicine[]>([
  {
    id: 43,
    sku: 'MED-OMP-043',
    name: 'Omeprazole',
    brandName: 'Losec',
    genericName: 'Omeprazole',
    dosageStrength: '20mg',
    category: 'Capsule',
    type: 'Antacid',
    supplier: 'MediCore Supply',
    purchaseCost: 4.8,
    sellingPrice: 8.5,
    batchNo: 'OMP-52',
    mfgDate: '2025-01-05',
    stock: 23,
    capacity: 200,
    lowThreshold: 30,
    reorderLevel: 35,
    expiryDate: 'May 1, 2026',
    unit: 'caps',
    stockLocation: 'Warehouse A / Shelf C2',
    storageRequirements: 'Store below 25C, dry area',
    barcode: '4800010000432'
  },
  {
    id: 36,
    sku: 'MED-MTF-036',
    name: 'Metformin',
    brandName: 'Glucophage',
    genericName: 'Metformin',
    dosageStrength: '500mg',
    category: 'Tablet',
    type: 'Diabetes',
    supplier: 'Healix Pharma',
    purchaseCost: 2.2,
    sellingPrice: 4.7,
    batchNo: 'MTF-11',
    mfgDate: '2025-02-18',
    stock: 0,
    capacity: 150,
    lowThreshold: 35,
    reorderLevel: 40,
    expiryDate: 'Nov 22, 2026',
    unit: 'tabs',
    stockLocation: 'Warehouse A / Shelf A1',
    storageRequirements: 'Room temperature',
    barcode: '4800010000364'
  },
  {
    id: 31,
    sku: 'MED-CLP-031',
    name: 'Clopidogrel',
    brandName: 'Plavix',
    genericName: 'Clopidogrel',
    dosageStrength: '75mg',
    category: 'Tablet',
    type: 'Cardio',
    supplier: 'MediCore Supply',
    purchaseCost: 6.1,
    sellingPrice: 11.2,
    batchNo: 'CLP-22',
    mfgDate: '2025-03-01',
    stock: 20,
    capacity: 100,
    lowThreshold: 25,
    reorderLevel: 30,
    expiryDate: 'Mar 5, 2026',
    unit: 'tabs',
    stockLocation: 'Warehouse B / Shelf D3',
    storageRequirements: 'Keep dry, away from heat',
    barcode: '4800010000319'
  },
  {
    id: 28,
    sku: 'MED-APX-028',
    name: 'Apixaban',
    brandName: 'Eliquis',
    genericName: 'Apixaban',
    dosageStrength: '5mg',
    category: 'Tablet',
    type: 'Cardio',
    supplier: 'AxisMed Trading',
    purchaseCost: 12.5,
    sellingPrice: 18.9,
    batchNo: 'APX-09',
    mfgDate: '2024-12-11',
    stock: 0,
    capacity: 75,
    lowThreshold: 20,
    reorderLevel: 24,
    expiryDate: 'Jun 18, 2026',
    unit: 'tabs',
    stockLocation: 'Warehouse B / Shelf D1',
    storageRequirements: 'Room temperature',
    barcode: '4800010000281'
  },
  {
    id: 24,
    sku: 'MED-ALV-024',
    name: 'Aleve',
    brandName: 'Aleve',
    genericName: 'Naproxen',
    dosageStrength: '220mg',
    category: 'Tablet',
    type: 'Painkiller',
    supplier: 'Healix Pharma',
    purchaseCost: 1.3,
    sellingPrice: 3.9,
    batchNo: 'ALV-27',
    mfgDate: '2025-04-04',
    stock: 180,
    capacity: 300,
    lowThreshold: 50,
    reorderLevel: 65,
    expiryDate: 'May 20, 2026',
    unit: 'tabs',
    stockLocation: 'Warehouse C / Shelf B4',
    storageRequirements: 'Room temperature',
    barcode: '4800010000243'
  },
  {
    id: 17,
    sku: 'MED-AML-017',
    name: 'Amlodipine',
    brandName: 'Norvasc',
    genericName: 'Amlodipine',
    dosageStrength: '5mg',
    category: 'Tablet',
    type: 'Antihypertensive',
    supplier: 'AxisMed Trading',
    purchaseCost: 1.8,
    sellingPrice: 4.1,
    batchNo: 'AML-44',
    mfgDate: '2025-01-22',
    stock: 150,
    capacity: 300,
    lowThreshold: 60,
    reorderLevel: 70,
    expiryDate: 'Feb 7, 2027',
    unit: 'tabs',
    stockLocation: 'Warehouse B / Shelf A3',
    storageRequirements: 'Store below 30C',
    barcode: '4800010000175'
  }
]);

const dispenseRequests = ref<DispenseRequest[]>([
  {
    id: 901,
    patientName: 'John Doe',
    medicineName: 'Omeprazole',
    quantity: 5,
    notes: 'Before breakfast',
    prescriptionRef: 'RX-2026-12311',
    dispenseReason: 'Acid reflux management',
    requestedAt: '10:43 AM',
    status: 'Pending'
  },
  {
    id: 902,
    patientName: 'Emma Tan',
    medicineName: 'Metformin',
    quantity: 10,
    notes: 'After meals',
    prescriptionRef: 'RX-2026-12349',
    dispenseReason: 'Type 2 diabetes maintenance',
    requestedAt: '9:18 AM',
    status: 'Pending'
  },
  {
    id: 903,
    patientName: 'Rico Dela Cruz',
    medicineName: 'Aleve',
    quantity: 3,
    notes: 'Pain management',
    prescriptionRef: 'RX-2026-12002',
    dispenseReason: 'Post-procedure pain',
    requestedAt: '8:51 AM',
    status: 'Fulfilled'
  }
]);

const inventoryLogs = ref<InventoryLog[]>([
  { id: 1, detail: 'Aleve restocked +150', actor: 'Gina Marquez', at: '10:43 AM', tone: 'success' },
  { id: 2, detail: 'Omeprazole dispensed -5', actor: 'Nurse Carla', at: '9:01 AM', tone: 'info' },
  { id: 3, detail: 'Apixaban out-of-stock alert triggered', actor: 'System', at: '8:15 AM', tone: 'warning' }
]);

const stockHistory = ref<Record<number, StockHistoryEntry[]>>({
  43: [
    { id: 1, event: 'Restock', by: 'Gina Marquez', at: '10:43 AM', detail: '+80 caps (Batch OMP-52)' },
    { id: 2, event: 'Dispense', by: 'Nurse Carla', at: '9:01 AM', detail: '-5 caps for John Doe' }
  ],
  36: [
    { id: 1, event: 'Dispense', by: 'Nurse Carla', at: '9:18 AM', detail: '-10 tabs for Emma Tan' },
    { id: 2, event: 'Alert', by: 'System', at: '8:36 AM', detail: 'Out of stock threshold reached' }
  ],
  31: [{ id: 1, event: 'Alert', by: 'System', at: '8:40 AM', detail: 'Expiring soon in 30 days' }],
  28: [{ id: 1, event: 'Alert', by: 'System', at: '8:15 AM', detail: 'Out of stock threshold reached' }],
  24: [{ id: 1, event: 'Restock', by: 'Gina Marquez', at: '10:43 AM', detail: '+150 tabs (Batch ALV-27)' }],
  17: [{ id: 1, event: 'Dispense', by: 'Nurse Carla', at: '7:52 AM', detail: '-4 tabs for OPD queue' }]
});

const addForm = reactive({
  sku: '',
  name: '',
  brandName: '',
  genericName: '',
  dosageStrength: '',
  category: 'Tablet',
  type: '',
  supplier: '',
  purchaseCost: 0,
  sellingPrice: 0,
  batchNo: '',
  mfgDate: '',
  capacity: 100,
  stock: 100,
  lowThreshold: 25,
  reorderLevel: 30,
  expiryDate: '',
  unit: 'tabs',
  stockLocation: '',
  storageRequirements: '',
  barcode: ''
});

const restockForm = reactive({
  quantity: 20,
  supplier: '',
  batchNo: '',
  batchExpiry: '',
  purchaseCost: 0,
  stockLocation: '',
  reason: ''
});

const dispenseForm = reactive({
  patientName: '',
  quantity: 1,
  notes: '',
  prescriptionRef: '',
  dispenseReason: ''
});

const adjustForm = reactive({
  mode: 'increase' as 'increase' | 'decrease' | 'set',
  quantity: 1,
  reason: ''
});

const editForm = reactive({
  supplier: '',
  dosageStrength: '',
  unit: 'tabs',
  type: '',
  category: 'Tablet',
  lowThreshold: 20,
  reorderLevel: 25,
  capacity: 100,
  expiryDate: '',
  stockLocation: '',
  storageRequirements: ''
});

const supplierItems = ['MediCore Supply', 'Healix Pharma', 'AxisMed Trading', 'PrimeRx Dist'];
const categoryTypeMap: Record<string, string[]> = {
  Tablet: ['Cardio', 'Diabetes', 'Painkiller', 'Antihypertensive'],
  Capsule: ['Antacid', 'Antibiotic'],
  Syrup: ['Pediatric', 'Cough Suppressant'],
  Inhaler: ['Pulmonary'],
  Injection: ['Emergency', 'Antibiotic'],
  Ointment: ['Dermatology']
};
const supplierBatchHints: Record<string, { prefix: string; location: string }> = {
  'MediCore Supply': { prefix: 'MDC', location: 'Warehouse A / Shelf C2' },
  'Healix Pharma': { prefix: 'HLX', location: 'Warehouse C / Shelf B4' },
  'AxisMed Trading': { prefix: 'AXM', location: 'Warehouse B / Shelf A1' },
  'PrimeRx Dist': { prefix: 'PRX', location: 'Warehouse D / Shelf A2' }
};
const rolePermissions: Record<InventoryRole, ActionType[]> = {
  Admin: ['add', 'edit', 'archive', 'restock', 'dispense', 'adjust', 'fulfill'],
  Pharmacist: ['add', 'edit', 'restock', 'dispense', 'adjust', 'fulfill'],
  'Pharmacy Staff': ['restock', 'dispense', 'fulfill'],
  Nurse: ['dispense', 'fulfill'],
  Doctor: []
};
const categoryItems = computed(() => {
  const dynamic = Array.from(new Set(medicines.value.map((item) => item.category)));
  const all = Array.from(new Set([...Object.keys(categoryTypeMap), ...dynamic]));
  return ['All Categories', ...all];
});
const typeItemsForAdd = computed(() => categoryTypeMap[addForm.category] || ['General']);
const actionAllowed = (type: ActionType): boolean => rolePermissions[sessionRole.value]?.includes(type) || false;
const realtime = useRealtimeListSync();

async function loadPharmacyData(options: { silent?: boolean } = {}): Promise<void> {
  const snapshot = await realtime.runLatest(
    async () => fetchPharmacySnapshot(),
    {
      silent: options.silent,
      onError: (error) => {
        showToast(error instanceof Error ? error.message : String(error), 'error');
      }
    }
  );
  if (!snapshot) return;
  medicines.value = snapshot.medicines as Medicine[];
  dispenseRequests.value = snapshot.requests as DispenseRequest[];
  inventoryLogs.value = snapshot.logs as InventoryLog[];
  stockHistory.value = snapshot.history as Record<number, StockHistoryEntry[]>;
  const stillExists = medicines.value.some((item) => item.id === selectedMedicineId.value);
  if (!stillExists) {
    selectedMedicineId.value = medicines.value[0]?.id ?? null;
  }
}

onMounted(async () => {
  await loadPharmacyData();
  realtime.startPolling(() => {
    void loadPharmacyData({ silent: true });
  }, REALTIME_POLICY.polling.pharmacyMs);
  pageLoading.value = false;
  requestAnimationFrame(() => {
    pageReady.value = true;
  });
});

onUnmounted(() => {
  realtime.stopPolling();
  realtime.invalidatePending();
});

function stockState(item: Medicine): StockState {
  if (item.stock <= 0) return 'Out of Stock';
  if (item.stock <= item.lowThreshold) return 'Low';
  return 'Healthy';
}

function stockPercent(item: Medicine): number {
  if (item.capacity <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((item.stock / item.capacity) * 100)));
}

function expiryDateValue(item: Medicine): number {
  const value = new Date(item.expiryDate).getTime();
  return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
}

function daysUntilExpiry(item: Medicine): number {
  const today = new Date();
  const expiry = new Date(expiryDateValue(item));
  const diffMs = expiry.setHours(23, 59, 59, 999) - today.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function expiryState(item: Medicine): 'Expired' | 'Expiring Soon' | 'Safe' {
  const days = daysUntilExpiry(item);
  if (days < 0) return 'Expired';
  if (days <= 30) return 'Expiring Soon';
  return 'Safe';
}

function expiryStateColor(state: 'Expired' | 'Expiring Soon' | 'Safe'): string {
  if (state === 'Expired') return 'error';
  if (state === 'Expiring Soon') return 'warning';
  return 'success';
}

function stockToneByPercent(percent: number): string {
  if (percent <= 0) return '#ef4444';
  if (percent < 20) return '#f97316';
  if (percent < 40) return '#eab308';
  return '#22c55e';
}

const totals = computed(() => {
  const total = medicines.value.length;
  const low = medicines.value.filter((item) => stockState(item) === 'Low').length;
  const out = medicines.value.filter((item) => stockState(item) === 'Out of Stock').length;
  const pending = dispenseRequests.value.filter((req) => req.status === 'Pending').length;
  return { total, low, out, pending };
});

const lowStockList = computed(() => medicines.value.filter((item) => stockState(item) !== 'Healthy'));

const summaryAlerts = computed(() => {
  const out = medicines.value.filter((item) => stockState(item) === 'Out of Stock').length;
  const low = medicines.value.filter((item) => stockState(item) === 'Low').length;
  const healthy = medicines.value.filter((item) => stockState(item) === 'Healthy').length;
  const expiring = medicines.value.filter((item) => expiryState(item) === 'Expiring Soon').length;

  return {
    out,
    low,
    healthy,
    expiring
  };
});

const filteredMedicines = computed(() => {
  let rows = [...medicines.value];
  const query = searchQuery.value.trim().toLowerCase();

  if (categoryFilter.value !== 'All Categories') {
    rows = rows.filter((item) => item.category === categoryFilter.value);
  }

  if (stockFilter.value !== 'All') {
    rows = rows.filter((item) => stockState(item) === stockFilter.value);
  }

  if (quickFilter.value === 'out') {
    rows = rows.filter((item) => stockState(item) === 'Out of Stock');
  } else if (quickFilter.value === 'low') {
    rows = rows.filter((item) => stockState(item) === 'Low');
  } else if (quickFilter.value === 'healthy') {
    rows = rows.filter((item) => stockState(item) === 'Healthy');
  } else if (quickFilter.value === 'expiring') {
    rows = rows.filter((item) => expiryState(item) === 'Expiring Soon');
  }

  if (query) {
    rows = rows.filter((item) => {
      const target = `${item.id} ${item.name} ${item.category} ${item.type} ${item.expiryDate}`.toLowerCase();
      return target.includes(query);
    });
  }

  return rows.sort((a, b) => {
    if (sortBy.value === 'name') {
      return sortDirection.value === 'asc' ? a.name.localeCompare(b.name) : b.name.localeCompare(a.name);
    }

    if (sortBy.value === 'stock') {
      return sortDirection.value === 'asc' ? stockPercent(a) - stockPercent(b) : stockPercent(b) - stockPercent(a);
    }

    if (sortBy.value === 'type') {
      return sortDirection.value === 'asc' ? a.type.localeCompare(b.type) : b.type.localeCompare(a.type);
    }

    return sortDirection.value === 'asc' ? expiryDateValue(a) - expiryDateValue(b) : expiryDateValue(b) - expiryDateValue(a);
  });
});

const pageCount = computed(() => Math.max(1, Math.ceil(filteredMedicines.value.length / pageSize.value)));
const pagedMedicines = computed(() => {
  const start = (listPage.value - 1) * pageSize.value;
  return filteredMedicines.value.slice(start, start + pageSize.value);
});

const selectedMedicine = computed(() => medicines.value.find((item) => item.id === selectedMedicineId.value) || null);
const actionMedicine = computed(() => medicines.value.find((item) => item.id === actionMedicineId.value) || null);
const actionMedicineOptions = computed(() =>
  medicines.value
    .map((item) => ({ title: `${item.name} (#${item.id})`, value: item.id }))
    .sort((a, b) => a.title.localeCompare(b.title))
);
const pendingRequests = computed(() => dispenseRequests.value.filter((item) => item.status === 'Pending'));
const historyMedicine = computed(() => medicines.value.find((item) => item.id === historyMedicineId.value) || null);
const historyItems = computed(() => {
  if (!historyMedicineId.value) return [];
  return stockHistory.value[historyMedicineId.value] || [];
});
const showingText = computed(() => {
  if (filteredMedicines.value.length === 0) return 'Showing 0-0 of 0 medicines';
  const start = (listPage.value - 1) * pageSize.value + 1;
  const end = Math.min(listPage.value * pageSize.value, filteredMedicines.value.length);
  return `Showing ${start}-${end} of ${filteredMedicines.value.length} medicines`;
});

watch([searchQuery, categoryFilter, stockFilter, quickFilter, pageSize], () => {
  listPage.value = 1;
});

watch(pageCount, (count) => {
  if (listPage.value > count) listPage.value = count;
});

watch(filteredMedicines, (rows) => {
  if (rows.length === 0) {
    selectedMedicineId.value = null;
    return;
  }

  const exists = rows.some((row) => row.id === selectedMedicineId.value);
  if (!exists) selectedMedicineId.value = rows[0].id;
});

watch(
  () => addForm.category,
  (category) => {
    const types = categoryTypeMap[category] || [];
    if (types.length && !types.includes(addForm.type)) {
      addForm.type = types[0];
    }
  },
  { immediate: true }
);

watch(
  () => addForm.supplier,
  (supplier) => {
    const hint = supplierBatchHints[supplier];
    if (!hint) return;
    if (!addForm.batchNo.trim()) {
      addForm.batchNo = `${hint.prefix}-${String(Date.now()).slice(-4)}`;
    }
    if (!addForm.stockLocation.trim()) {
      addForm.stockLocation = hint.location;
    }
  }
);

const dialogTitle = computed(() => {
  if (actionType.value === 'add') return 'Add New Medicine';
  if (actionType.value === 'edit') return 'Edit Medicine';
  if (actionType.value === 'archive') return 'Archive Medicine';
  if (actionType.value === 'restock') return 'Restock Medicine';
  if (actionType.value === 'dispense') return 'Dispense Medicine';
  if (actionType.value === 'adjust') return 'Adjust Stock';
  return 'Fulfill Dispense Request';
});

const dialogActionText = computed(() => {
  if (actionType.value === 'add') return 'Add Stock';
  if (actionType.value === 'edit') return 'Save Changes';
  if (actionType.value === 'archive') return 'Archive';
  if (actionType.value === 'restock') return 'Restock';
  if (actionType.value === 'dispense') return 'Dispense';
  if (actionType.value === 'adjust') return 'Adjust Stock';
  return 'Fulfill';
});

function setQuickFilter(filter: QuickFilter): void {
  quickFilter.value = filter;
}

function toggleSort(key: SortKey): void {
  if (sortBy.value === key) {
    sortDirection.value = sortDirection.value === 'asc' ? 'desc' : 'asc';
    return;
  }

  sortBy.value = key;
  sortDirection.value = key === 'stock' ? 'asc' : 'desc';
}

function sortIcon(key: SortKey): string {
  if (sortBy.value !== key) return 'mdi-swap-vertical';
  return sortDirection.value === 'asc' ? 'mdi-arrow-up' : 'mdi-arrow-down';
}

function showToast(text: string, color: 'success' | 'info' | 'warning' | 'error' = 'success'): void {
  if (color === 'success') {
    emitSuccessModal({ title: 'Success', message: text, tone: 'success' });
    return;
  }
  snackbarText.value = text;
  snackbarColor.value = color;
  snackbar.value = true;
}

function statusChipColor(state: StockState): string {
  if (state === 'Out of Stock') return 'error';
  if (state === 'Low') return 'warning';
  return 'success';
}

function openAlerts(): void {
  alertsDialog.value = true;
}

function openHistoryDrawer(medicine: Medicine): void {
  selectedMedicineId.value = medicine.id;
  historyMedicineId.value = medicine.id;
  historyDrawer.value = true;
}

function openSelectedMedicineModal(medicine?: Medicine): void {
  if (medicine) {
    selectedMedicineId.value = medicine.id;
  }

  if (!selectedMedicine.value) {
    showToast('Select a medicine first.', 'warning');
    return;
  }

  selectedMedicineDialog.value = true;
}

function openAction(type: ActionType, medicine?: Medicine, request?: DispenseRequest): void {
  if (!actionAllowed(type)) {
    showToast(`Your role (${sessionRole.value}) is not allowed to run this action.`, 'warning');
    return;
  }
  actionType.value = type;
  actionRequest.value = null;
  Object.keys(formErrors).forEach((key) => {
    delete formErrors[key];
  });

  if (type === 'add') {
    resetForms();
    actionMedicineId.value = null;
    actionDialog.value = true;
    return;
  }

  if (type === 'fulfill') {
    const targetRequest = request;
    if (!targetRequest) {
      showToast('No dispense request selected.', 'warning');
      return;
    }
    actionRequest.value = targetRequest;
    actionMedicineId.value = medicines.value.find((item) => item.name === targetRequest.medicineName)?.id || null;
    actionDialog.value = true;
    return;
  }

  const targetMedicine = medicine || selectedMedicine.value;
  if (!targetMedicine) {
    showToast('Select a medicine first.', 'warning');
    return;
  }

  actionMedicineId.value = targetMedicine.id;
  if (type === 'edit') {
    editForm.type = targetMedicine.type;
    editForm.category = targetMedicine.category;
    editForm.supplier = targetMedicine.supplier;
    editForm.dosageStrength = targetMedicine.dosageStrength;
    editForm.unit = targetMedicine.unit;
    editForm.capacity = targetMedicine.capacity;
    editForm.lowThreshold = targetMedicine.lowThreshold;
    editForm.reorderLevel = targetMedicine.reorderLevel;
    editForm.expiryDate = targetMedicine.expiryDate;
    editForm.stockLocation = targetMedicine.stockLocation;
    editForm.storageRequirements = targetMedicine.storageRequirements;
  }
  if (type === 'restock') {
    restockForm.quantity = Math.max(10, targetMedicine.lowThreshold);
    restockForm.supplier = targetMedicine.supplier;
    restockForm.batchNo = '';
    restockForm.batchExpiry = targetMedicine.expiryDate;
    restockForm.purchaseCost = targetMedicine.purchaseCost;
    restockForm.stockLocation = targetMedicine.stockLocation;
    restockForm.reason = '';
  }
  if (type === 'dispense') {
    dispenseForm.patientName = '';
    dispenseForm.quantity = 1;
    dispenseForm.notes = '';
    dispenseForm.prescriptionRef = '';
    dispenseForm.dispenseReason = '';
  }
  if (type === 'adjust') {
    adjustForm.mode = 'increase';
    adjustForm.quantity = 1;
    adjustForm.reason = '';
  }
  actionDialog.value = true;
}

function resetForms(): void {
  addForm.sku = '';
  addForm.name = '';
  addForm.brandName = '';
  addForm.genericName = '';
  addForm.dosageStrength = '';
  addForm.category = 'Tablet';
  addForm.type = categoryTypeMap.Tablet?.[0] || '';
  addForm.supplier = supplierItems[0];
  addForm.purchaseCost = 0;
  addForm.sellingPrice = 0;
  addForm.batchNo = '';
  addForm.mfgDate = '';
  addForm.capacity = 100;
  addForm.stock = 100;
  addForm.lowThreshold = 25;
  addForm.reorderLevel = 30;
  addForm.expiryDate = '';
  addForm.unit = 'tabs';
  addForm.stockLocation = '';
  addForm.storageRequirements = '';
  addForm.barcode = '';
  restockForm.quantity = 20;
  restockForm.supplier = supplierItems[0];
  restockForm.batchNo = '';
  restockForm.batchExpiry = '';
  restockForm.purchaseCost = 0;
  restockForm.stockLocation = '';
  restockForm.reason = '';
}

function pushLog(detail: string, actor: string, tone: 'success' | 'warning' | 'info'): void {
  const id = inventoryLogs.value.length > 0 ? Math.max(...inventoryLogs.value.map((item) => item.id)) + 1 : 1;
  inventoryLogs.value.unshift({
    id,
    detail,
    actor,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    tone
  });
}

async function saveDraftAction(): Promise<void> {
  actionDraftLoading.value = true;
  try {
    await dispatchPharmacyAction({
      action: 'save_draft',
      role: sessionRole.value,
      draft_type: actionType.value,
      medicine_id: actionMedicine.value?.id || null,
      notes:
        actionType.value === 'add'
          ? `Draft add: ${addForm.name || '(unnamed)'}`
          : actionType.value === 'restock'
            ? `Draft restock: ${actionMedicine.value?.name || ''}`
            : `Draft dispense: ${actionMedicine.value?.name || ''}`
    });
    await loadPharmacyData();
    showToast('Draft saved.', 'info');
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionDraftLoading.value = false;
  }
}

function appendHistory(item: Medicine, event: string, detail: string, actor: string = sessionRole.value): void {
  const existingHistory = stockHistory.value[item.id] || [];
  existingHistory.unshift({
    id: existingHistory.length + 1,
    event,
    by: actor,
    at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    detail
  });
  stockHistory.value[item.id] = existingHistory;
}

function runAutoAlerts(item: Medicine): void {
  if (item.stock <= 0) {
    pushLog(`${item.name} out-of-stock alert triggered`, 'System', 'warning');
    appendHistory(item, 'Alert', 'Out-of-stock threshold reached', 'System');
    return;
  }
  if (item.stock <= item.reorderLevel) {
    pushLog(`${item.name} low-stock alert triggered`, 'System', 'warning');
    appendHistory(item, 'Alert', `Low stock reached (${item.stock}/${item.reorderLevel})`, 'System');
  }
  if (expiryState(item) === 'Expiring Soon') {
    pushLog(`${item.name} expiry warning raised`, 'System', 'warning');
    appendHistory(item, 'Alert', 'Medicine is expiring within 30 days', 'System');
  }
}

async function submitAction(): Promise<void> {
  actionLoading.value = true;
  await new Promise((resolve) => setTimeout(resolve, 240));
  try {
    if (actionType.value === 'add') {
      await dispatchPharmacyAction({
        action: 'create_medicine',
        role: sessionRole.value,
        sku: addForm.sku,
        medicine_name: addForm.name,
        brand_name: addForm.brandName,
        generic_name: addForm.genericName,
        dosage_strength: addForm.dosageStrength,
        category: addForm.category,
        medicine_type: addForm.type,
        supplier_name: addForm.supplier,
        purchase_cost: addForm.purchaseCost,
        selling_price: addForm.sellingPrice,
        batch_lot_no: addForm.batchNo,
        manufacturing_date: addForm.mfgDate || null,
        expiry_date: addForm.expiryDate,
        unit_of_measure: addForm.unit,
        stock_capacity: addForm.capacity,
        stock_on_hand: addForm.stock,
        low_stock_threshold: addForm.lowThreshold,
        reorder_level: addForm.reorderLevel,
        stock_location: addForm.stockLocation,
        storage_requirements: addForm.storageRequirements,
        barcode: addForm.barcode
      });
      showToast('Medicine added successfully.', 'success');
    } else if (actionType.value === 'edit') {
      if (!actionMedicine.value) throw 'No medicine selected.';
      await dispatchPharmacyAction({
        action: 'update_medicine',
        role: sessionRole.value,
        medicine_id: actionMedicine.value.id,
        medicine_type: editForm.type,
        category: editForm.category,
        supplier_name: editForm.supplier,
        dosage_strength: editForm.dosageStrength,
        unit_of_measure: editForm.unit,
        stock_capacity: editForm.capacity,
        low_stock_threshold: editForm.lowThreshold,
        reorder_level: editForm.reorderLevel,
        expiry_date: editForm.expiryDate,
        stock_location: editForm.stockLocation,
        storage_requirements: editForm.storageRequirements
      });
      showToast('Medicine updated.', 'success');
    } else if (actionType.value === 'archive') {
      if (!actionMedicine.value) throw 'No medicine selected.';
      await dispatchPharmacyAction({ action: 'archive_medicine', role: sessionRole.value, medicine_id: actionMedicine.value.id });
      showToast('Medicine archived.', 'info');
    } else if (actionType.value === 'restock') {
      if (!actionMedicine.value) throw 'No medicine selected.';
      await dispatchPharmacyAction({
        action: 'restock',
        role: sessionRole.value,
        medicine_id: actionMedicine.value.id,
        quantity: restockForm.quantity,
        supplier_name: restockForm.supplier,
        batch_lot_no: restockForm.batchNo,
        expiry_date: restockForm.batchExpiry || null,
        purchase_cost: restockForm.purchaseCost,
        stock_location: restockForm.stockLocation,
        reason: restockForm.reason
      });
      showToast('Medicine restocked.', 'success');
    } else if (actionType.value === 'dispense') {
      if (!actionMedicine.value) throw 'No medicine selected.';
      await dispatchPharmacyAction({
        action: 'dispense',
        role: sessionRole.value,
        medicine_id: actionMedicine.value.id,
        patient_name: dispenseForm.patientName,
        quantity: dispenseForm.quantity,
        notes: dispenseForm.notes,
        prescription_reference: dispenseForm.prescriptionRef,
        dispense_reason: dispenseForm.dispenseReason
      });
      showToast('Medicine dispensed successfully.', 'success');
    } else if (actionType.value === 'adjust') {
      if (!actionMedicine.value) throw 'No medicine selected.';
      await dispatchPharmacyAction({
        action: 'adjust_stock',
        role: sessionRole.value,
        medicine_id: actionMedicine.value.id,
        mode: adjustForm.mode,
        quantity: adjustForm.quantity,
        reason: adjustForm.reason
      });
      showToast('Stock adjusted successfully.', 'success');
    } else if (actionType.value === 'fulfill') {
      if (!actionRequest.value) throw 'No request selected.';
      await dispatchPharmacyAction({
        action: 'fulfill_request',
        role: sessionRole.value,
        request_id: actionRequest.value.id
      });
      showToast(`Request #${actionRequest.value.id} fulfilled.`, 'success');
    }

    await loadPharmacyData();
    actionDialog.value = false;
  } catch (error) {
    showToast(error instanceof Error ? error.message : String(error), 'error');
  } finally {
    actionLoading.value = false;
  }
}
</script>

<template>
  <div class="pharmacy-page">
    <div v-if="pageLoading">
      <v-skeleton-loader type="heading, text" class="mb-4" />
      <v-skeleton-loader type="image" class="mb-4" />
      <v-row>
        <v-col cols="12" lg="8">
          <v-skeleton-loader type="table-heading, table-row-divider@6" />
        </v-col>
        <v-col cols="12" lg="4">
          <v-skeleton-loader type="image, list-item-two-line@5" />
        </v-col>
      </v-row>
    </div>

    <div v-else class="pharmacy-content" :class="{ 'is-ready': pageReady }">
      <v-card class="hero-card mb-4" elevation="0">
        <v-card-text class="pa-6">
          <v-row align="center">
            <v-col cols="12" md="8">
              <div class="hero-kicker">Dispensing & Stock</div>
              <h1 class="text-h3 font-weight-black mb-2">Pharmacy & Inventory</h1>
              <p class="text-subtitle-1 hero-subtitle mb-0">
                Manage and dispense medicines, track stock levels, and control low-stock alerts.
              </p>
            </v-col>
            <v-col cols="12" md="4" class="d-flex justify-md-end mt-3 mt-md-0">
              <div class="d-flex ga-2 flex-wrap justify-md-end">
                <v-select v-model="sessionRole" :items="['Admin', 'Pharmacist', 'Pharmacy Staff', 'Nurse', 'Doctor']" label="Role" density="compact" variant="solo-filled" hide-details class="role-select" />
              </div>
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-total" elevation="0">
            <v-card-text>
              <div class="metric-title">Total Medicines</div>
              <div class="metric-value">{{ totals.total }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-low" elevation="0">
            <v-card-text>
              <div class="metric-title">Low Stock Alerts</div>
              <div class="metric-value">{{ totals.low }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-out" elevation="0">
            <v-card-text>
              <div class="metric-title">Out Of Stock</div>
              <div class="metric-value">{{ totals.out }}</div>
            </v-card-text>
          </v-card>
        </v-col>
        <v-col cols="12" sm="6" lg="3">
          <v-card class="metric-card metric-pending" elevation="0">
            <v-card-text>
              <div class="metric-title">Pending Dispense</div>
              <div class="metric-value">{{ totals.pending }}</div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card class="surface-card mb-4" variant="outlined">
        <v-card-item>
          <v-card-title>Stock & Dispense Table</v-card-title>
          <template #append>
            <div class="d-flex ga-2 flex-wrap justify-md-end">
              <v-btn class="saas-btn saas-btn-light" size="large" prepend-icon="mdi-plus" :disabled="!actionAllowed('add')" @click="openAction('add')">
                Add New Medicine
              </v-btn>
            </div>
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <v-row>
            <v-col cols="12" md="3">
              <v-select v-model="categoryFilter" :items="categoryItems" label="Categories" variant="outlined" density="comfortable" hide-details />
            </v-col>
            <v-col cols="12" md="3">
              <v-select
                v-model="stockFilter"
                :items="['All', 'Healthy', 'Low', 'Out of Stock']"
                label="Stock State"
                variant="outlined"
                density="comfortable"
                hide-details
              />
            </v-col>
            <v-col cols="12" md="3">
              <v-btn class="saas-btn saas-btn-warning w-100" prepend-icon="mdi-bell-alert" @click="openAlerts">
                Low Stock Alerts ({{ lowStockList.length }})
              </v-btn>
            </v-col>
            <v-col cols="12" md="3">
              <v-text-field
                v-model="searchQuery"
                label="Search"
                variant="outlined"
                density="comfortable"
                prepend-inner-icon="mdi-magnify"
                hide-details
              />
            </v-col>
          </v-row>
        </v-card-text>
      </v-card>

      <v-row class="mb-4">
        <v-col cols="12">
          <v-card class="surface-card h-100" variant="outlined">
            <v-card-item>
              <v-card-title>Medicine Stock Levels</v-card-title>
            </v-card-item>
            <v-card-text>
              <div class="summary-alert-bar mb-4">
                <button type="button" class="summary-alert alert-out" :class="{ active: quickFilter === 'out' }" @click="setQuickFilter('out')">
                  <span>🔴</span>
                  <span>{{ summaryAlerts.out }} Out of Stock</span>
                </button>
                <button type="button" class="summary-alert alert-low" :class="{ active: quickFilter === 'low' }" @click="setQuickFilter('low')">
                  <span>🟡</span>
                  <span>{{ summaryAlerts.low }} Low Stock</span>
                </button>
                <button type="button" class="summary-alert alert-healthy" :class="{ active: quickFilter === 'healthy' }" @click="setQuickFilter('healthy')">
                  <span>🟢</span>
                  <span>{{ summaryAlerts.healthy }} Healthy</span>
                </button>
                <button type="button" class="summary-alert alert-expiring" :class="{ active: quickFilter === 'expiring' }" @click="setQuickFilter('expiring')">
                  <span>⏳</span>
                  <span>{{ summaryAlerts.expiring }} Expiring Soon</span>
                </button>
              </div>

              <div class="d-flex align-center justify-space-between flex-wrap ga-2 mb-3">
                <div class="filter-chip-row">
                  <button type="button" class="quick-filter-chip" :class="{ active: quickFilter === 'all' }" @click="setQuickFilter('all')">All</button>
                  <button type="button" class="quick-filter-chip" :class="{ active: quickFilter === 'low' }" @click="setQuickFilter('low')">Low Stock</button>
                  <button type="button" class="quick-filter-chip" :class="{ active: quickFilter === 'out' }" @click="setQuickFilter('out')">Out of Stock</button>
                  <button type="button" class="quick-filter-chip" :class="{ active: quickFilter === 'expiring' }" @click="setQuickFilter('expiring')">
                    Expiring Soon
                  </button>
                  <button type="button" class="quick-filter-chip" :class="{ active: quickFilter === 'healthy' }" @click="setQuickFilter('healthy')">Healthy</button>
                </div>

                <div class="d-flex align-center ga-2">
                  <span class="text-caption text-medium-emphasis">Items per page</span>
                  <v-select v-model="pageSize" :items="pageSizeOptions" density="compact" variant="outlined" hide-details style="max-width: 90px" />
                </div>
              </div>

              <div class="stock-table-wrap">
                <v-table density="comfortable">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>
                        <button class="sortable-head" type="button" @click="toggleSort('name')">
                          MEDICINE NAME <v-icon :icon="sortIcon('name')" size="14" />
                        </button>
                      </th>
                      <th>
                        <button class="sortable-head" type="button" @click="toggleSort('stock')">
                          STOCK LEVEL <v-icon :icon="sortIcon('stock')" size="14" />
                        </button>
                      </th>
                      <th>
                        <button class="sortable-head" type="button" @click="toggleSort('type')">
                          TYPE <v-icon :icon="sortIcon('type')" size="14" />
                        </button>
                      </th>
                      <th>
                        <button class="sortable-head" type="button" @click="toggleSort('expiry')">
                          EXPIRY DATE <v-icon :icon="sortIcon('expiry')" size="14" />
                        </button>
                      </th>
                      <th class="text-right action-col">ACTIONS</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="item in pagedMedicines"
                      :key="item.id"
                      :class="[
                        'stock-row',
                        stockState(item) === 'Out of Stock' ? 'stock-row-out' : stockState(item) === 'Low' ? 'stock-row-low' : 'stock-row-healthy',
                        { 'selected-row': selectedMedicineId === item.id }
                      ]"
                      @click="openHistoryDrawer(item)"
                    >
                      <td>#{{ item.id }}</td>
                      <td>
                        <div class="font-weight-bold">{{ item.name }}</div>
                        <div class="text-caption text-medium-emphasis">{{ item.category }}</div>
                      </td>
                      <td>
                        <div class="d-flex align-center ga-2">
                          <v-chip size="small" :color="statusChipColor(stockState(item))" variant="tonal">{{ stockState(item) }}</v-chip>
                          <div class="stock-inline">
                            <div class="stock-summary">
                              <span>{{ item.stock }} left of {{ item.capacity }}</span>
                              <span>{{ stockPercent(item) }}%</span>
                            </div>
                            <div class="stock-bar stock-bar-thick">
                              <span :style="{ width: `${stockPercent(item)}%`, background: stockToneByPercent(stockPercent(item)) }"></span>
                            </div>
                          </div>
                        </div>
                      </td>
                      <td>{{ item.type }}</td>
                      <td>
                        <div>{{ item.expiryDate }}</div>
                        <v-chip size="x-small" :color="expiryStateColor(expiryState(item))" variant="tonal">{{ expiryState(item) }}</v-chip>
                      </td>
                      <td class="text-right action-col">
                        <div class="action-cell">
                          <v-btn size="small" class="saas-btn saas-btn-primary action-primary-btn" :disabled="!actionAllowed('restock')" @click.stop="openAction('restock', item)">Restock</v-btn>
                          <v-menu location="bottom end">
                            <template #activator="{ props }">
                              <v-btn
                                v-bind="props"
                                size="small"
                                variant="outlined"
                                color="primary"
                                class="saas-btn saas-btn-ghost action-more-btn"
                                append-icon="mdi-chevron-down"
                              >
                                More
                              </v-btn>
                            </template>
                            <v-list density="compact" min-width="180">
                              <v-list-item prepend-icon="mdi-pencil-outline" title="Edit" :disabled="!actionAllowed('edit')" @click="openAction('edit', item)" />
                              <v-list-item prepend-icon="mdi-eye-outline" title="View Details" @click="openSelectedMedicineModal(item)" />
                              <v-list-item prepend-icon="mdi-pill" title="Dispense" :disabled="!actionAllowed('dispense')" @click="openAction('dispense', item)" />
                              <v-list-item prepend-icon="mdi-tune-variant" title="Adjust Stock" :disabled="!actionAllowed('adjust')" @click="openAction('adjust', item)" />
                              <v-list-item prepend-icon="mdi-archive-outline" title="Archive" :disabled="!actionAllowed('archive')" @click="openAction('archive', item)" />
                            </v-list>
                          </v-menu>
                        </div>
                      </td>
                    </tr>
                    <tr v-if="pagedMedicines.length === 0">
                      <td colspan="6" class="text-center text-medium-emphasis py-4">No medicines found.</td>
                    </tr>
                  </tbody>
                </v-table>
              </div>

              <div class="d-flex align-center justify-space-between mt-3 flex-wrap ga-2">
                <div class="text-caption text-medium-emphasis">{{ showingText }}</div>
                <v-pagination v-model="listPage" :length="pageCount" density="comfortable" :total-visible="5" />
              </div>
            </v-card-text>
          </v-card>
        </v-col>
      </v-row>

      <v-card class="surface-card" variant="outlined">
        <v-card-item>
          <v-card-title>Pending Dispense Requests</v-card-title>
        </v-card-item>
        <v-card-text>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>ID</th>
                <th>PATIENT</th>
                <th>MEDICINE</th>
                <th>QTY</th>
                <th>PRESCRIPTION</th>
                <th>NOTES</th>
                <th>STATUS</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="request in pendingRequests" :key="request.id">
                <td>#{{ request.id }}</td>
                <td>{{ request.patientName }}</td>
                <td>{{ request.medicineName }}</td>
                <td>{{ request.quantity }}</td>
                <td>{{ request.prescriptionRef }}</td>
                <td>{{ request.notes }}</td>
                <td><v-chip size="small" color="warning" variant="tonal">{{ request.status }}</v-chip></td>
                <td class="text-right">
                  <v-btn class="saas-btn saas-btn-success" size="small" :disabled="!actionAllowed('fulfill')" @click="openAction('fulfill', undefined, request)">Fulfill</v-btn>
                </td>
              </tr>
              <tr v-if="pendingRequests.length === 0">
                <td colspan="8" class="text-center text-medium-emphasis py-4">No pending dispense requests.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>

      <v-card class="surface-card mt-4" variant="outlined">
        <v-card-item>
          <v-card-title>Recent Inventory Logs</v-card-title>
        </v-card-item>
        <v-card-text>
          <v-list lines="two" class="py-0">
            <v-list-item v-for="log in inventoryLogs.slice(0, 8)" :key="log.id">
              <template #prepend>
                <v-icon
                  :icon="log.tone === 'success' ? 'mdi-check-circle' : log.tone === 'warning' ? 'mdi-alert' : 'mdi-information'"
                  :color="log.tone"
                />
              </template>
              <v-list-item-title>{{ log.detail }}</v-list-item-title>
              <v-list-item-subtitle>{{ log.actor }} • {{ log.at }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </v-card-text>
      </v-card>
    </div>

    <v-navigation-drawer v-model="historyDrawer" temporary location="right" width="420">
      <div class="history-drawer" v-if="historyMedicine">
        <div class="d-flex align-center justify-space-between px-4 py-3 history-head">
          <div>
            <div class="text-subtitle-1 font-weight-bold">Stock History</div>
            <div class="text-body-2 text-medium-emphasis">{{ historyMedicine.name }} #{{ historyMedicine.id }}</div>
          </div>
          <v-btn icon="mdi-close" variant="text" @click="historyDrawer = false" />
        </div>

        <div class="px-4 py-3">
          <div class="d-flex align-center justify-space-between mb-2">
            <span class="text-body-2">Current Stock</span>
            <strong>{{ historyMedicine.stock }}/{{ historyMedicine.capacity }}</strong>
          </div>
          <div class="d-flex align-center justify-space-between mb-4">
            <span class="text-body-2">Expiry</span>
            <v-chip size="small" :color="expiryStateColor(expiryState(historyMedicine))" variant="tonal">
              {{ historyMedicine.expiryDate }}
            </v-chip>
          </div>

          <div class="text-subtitle-2 font-weight-bold mb-2">Movements</div>
          <v-timeline density="compact" side="end" align="start" truncate-line="start">
            <v-timeline-item v-for="entry in historyItems" :key="`${historyMedicine.id}-${entry.id}`" dot-color="primary" size="x-small">
              <div class="text-body-2 font-weight-bold">{{ entry.event }}</div>
              <div class="text-caption text-medium-emphasis">{{ entry.detail }}</div>
              <div class="text-caption text-medium-emphasis">{{ entry.by }} • {{ entry.at }}</div>
            </v-timeline-item>
            <v-timeline-item v-if="historyItems.length === 0" dot-color="grey" size="x-small">
              <div class="text-caption text-medium-emphasis">No movement history yet.</div>
            </v-timeline-item>
          </v-timeline>
        </div>
      </div>
    </v-navigation-drawer>

    <ModuleActivityLogs module="pharmacy" title="Module Activity Logs" :per-page="8" />

    <v-dialog v-model="selectedMedicineDialog" max-width="560" transition="dialog-bottom-transition">
      <v-card v-if="selectedMedicine">
        <v-card-item>
          <v-card-title>Medicine Actions</v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" @click="selectedMedicineDialog = false" />
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text class="pt-5">
          <div class="text-h5 font-weight-bold">{{ selectedMedicine.name }}</div>
          <div class="text-body-2 text-medium-emphasis mb-3">#{{ selectedMedicine.id }} • {{ selectedMedicine.type }} • {{ selectedMedicine.dosageStrength }}</div>
          <div class="text-body-2 mb-2">SKU: <strong>{{ selectedMedicine.sku }}</strong> • Batch: <strong>{{ selectedMedicine.batchNo }}</strong></div>
          <div class="text-body-2 mb-3">Supplier: <strong>{{ selectedMedicine.supplier }}</strong> • Location: <strong>{{ selectedMedicine.stockLocation }}</strong></div>

          <div class="d-flex align-center justify-space-between mb-2">
            <span>Stock State</span>
            <v-chip size="small" :color="statusChipColor(stockState(selectedMedicine))" variant="tonal">{{ stockState(selectedMedicine) }}</v-chip>
          </div>
          <div class="d-flex align-center justify-space-between mb-2">
            <span>Stock</span>
            <strong>{{ selectedMedicine.stock }}/{{ selectedMedicine.capacity }}</strong>
          </div>
          <div class="d-flex align-center justify-space-between mb-4">
            <span>Expiry</span>
            <strong>{{ selectedMedicine.expiryDate }}</strong>
          </div>

          <div class="d-grid ga-2 mb-2">
            <v-btn
              class="saas-btn saas-btn-primary"
              prepend-icon="mdi-truck-fast-outline"
              @click="
                selectedMedicineDialog = false;
                openAction('restock', selectedMedicine);
              "
            >
              Restock
            </v-btn>
            <v-btn
              class="saas-btn saas-btn-info"
              prepend-icon="mdi-pill"
              :disabled="!actionAllowed('dispense')"
              @click="
                selectedMedicineDialog = false;
                openAction('dispense', selectedMedicine);
              "
            >
              Dispense
            </v-btn>
            <v-btn
              class="saas-btn saas-btn-ghost"
              prepend-icon="mdi-tune-variant"
              :disabled="!actionAllowed('adjust')"
              @click="
                selectedMedicineDialog = false;
                openAction('adjust', selectedMedicine);
              "
            >
              Adjust Stock
            </v-btn>
          </div>
          <div class="d-flex align-center ga-2">
            <v-btn
              class="saas-btn saas-btn-ghost"
              prepend-icon="mdi-bell-alert"
              @click="
                selectedMedicineDialog = false;
                openAlerts();
              "
            >
              View Alerts
            </v-btn>
            <v-chip class="alerts-chip" color="warning" variant="tonal" size="small">
              {{ lowStockList.length }} active alerts
            </v-chip>
          </div>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="alertsDialog" max-width="760" transition="dialog-bottom-transition">
      <v-card>
        <v-card-item>
          <v-card-title>Low Stock Alerts ({{ lowStockList.length }})</v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" @click="alertsDialog = false" />
          </template>
        </v-card-item>
        <v-divider />
        <v-card-text>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>MEDICINE</th>
                <th>STOCK</th>
                <th>STATE</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in lowStockList" :key="`alert-${item.id}`">
                <td>
                  <div class="font-weight-bold">{{ item.name }}</div>
                  <div class="text-caption text-medium-emphasis">#{{ item.id }}</div>
                </td>
                <td>{{ item.stock }}/{{ item.capacity }}</td>
                <td><v-chip size="small" :color="statusChipColor(stockState(item))" variant="tonal">{{ stockState(item) }}</v-chip></td>
                <td class="text-right">
                  <v-btn class="saas-btn saas-btn-primary" size="small" @click="alertsDialog = false; openAction('restock', item)">Restock</v-btn>
                </td>
              </tr>
              <tr v-if="lowStockList.length === 0">
                <td colspan="4" class="text-center text-medium-emphasis py-4">No active alerts.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-dialog>

    <v-dialog v-model="actionDialog" max-width="680" transition="dialog-bottom-transition">
      <v-card>
        <v-card-item>
          <v-card-title>{{ dialogTitle }}</v-card-title>
          <template #append>
            <v-btn icon="mdi-close" variant="text" @click="actionDialog = false" />
          </template>
        </v-card-item>
        <v-divider />

        <v-card-text class="pt-5">
          <template v-if="actionType === 'add'">
            <v-row>
              <v-col cols="12" md="4">
                <v-text-field v-model="addForm.sku" label="Medicine SKU/Code *" variant="outlined" density="comfortable" :error-messages="formErrors.sku" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="addForm.brandName" label="Brand Name *" variant="outlined" density="comfortable" :error-messages="formErrors.brandName" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="addForm.genericName" label="Generic Name *" variant="outlined" density="comfortable" :error-messages="formErrors.genericName" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="addForm.name" label="Display Medicine Name *" variant="outlined" density="comfortable" :error-messages="formErrors.name" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="addForm.dosageStrength" label="Dosage/Strength (mg/ml) *" variant="outlined" density="comfortable" :error-messages="formErrors.dosageStrength" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="addForm.category" :items="Object.keys(categoryTypeMap)" label="Category" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="addForm.type" :items="typeItemsForAdd" label="Medicine Type *" variant="outlined" density="comfortable" :error-messages="formErrors.type" />
              </v-col>
              <v-col cols="12" md="6">
                <v-select v-model="addForm.supplier" :items="supplierItems" label="Supplier/Vendor *" variant="outlined" density="comfortable" :error-messages="formErrors.supplier" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="addForm.batchNo" label="Batch/Lot Number *" variant="outlined" density="comfortable" :error-messages="formErrors.batchNo" />
              </v-col>
              <v-col cols="12" md="4">
                <SaasDateTimePickerField v-model="addForm.mfgDate" mode="date" label="Manufacturing Date" clearable />
              </v-col>
              <v-col cols="12" md="4">
                <SaasDateTimePickerField v-model="addForm.expiryDate" mode="date" label="Expiry Date *" :error-messages="formErrors.expiryDate" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model="addForm.barcode" label="Barcode" variant="outlined" density="comfortable" hint="Use scanner input if available" persistent-hint />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model.number="addForm.purchaseCost" type="number" step="0.01" label="Purchase Cost" variant="outlined" density="comfortable" :error-messages="formErrors.purchaseCost" />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model.number="addForm.sellingPrice" type="number" step="0.01" label="Selling Price" variant="outlined" density="comfortable" :error-messages="formErrors.sellingPrice" />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model="addForm.unit" label="Unit of Measure (tab/ml/etc)" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="3">
                <v-text-field v-model="addForm.stockLocation" label="Stock Location (warehouse/shelf)" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model.number="addForm.capacity" type="number" label="Capacity" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model.number="addForm.stock" type="number" label="Initial Stock" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="4">
                <v-text-field v-model.number="addForm.lowThreshold" type="number" label="Low Stock Threshold" variant="outlined" density="comfortable" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model.number="addForm.reorderLevel" type="number" label="Reorder Level Automation" variant="outlined" density="comfortable" :error-messages="formErrors.reorderLevel" />
              </v-col>
              <v-col cols="12" md="6">
                <v-text-field v-model="addForm.storageRequirements" label="Storage Requirements" variant="outlined" density="comfortable" />
              </v-col>
            </v-row>
          </template>

          <template v-else-if="actionType === 'edit'">
            <v-select
              v-model="actionMedicineId"
              :items="actionMedicineOptions"
              label="Select Medicine To Edit"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <template v-if="actionMedicine">
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field v-model="editForm.type" label="Medicine Type" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-select
                    v-model="editForm.category"
                    :items="Object.keys(categoryTypeMap)"
                    label="Category"
                    variant="outlined"
                    density="comfortable"
                  />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="editForm.capacity" type="number" label="Capacity" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="editForm.lowThreshold" type="number" label="Low Threshold" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <SaasDateTimePickerField v-model="editForm.expiryDate" mode="date" label="Expiry Date" clearable />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="editForm.reorderLevel" type="number" label="Reorder Level" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model="editForm.supplier" label="Supplier" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model="editForm.dosageStrength" label="Dosage/Strength" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field v-model="editForm.unit" label="Unit" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field v-model="editForm.stockLocation" label="Stock Location" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12">
                  <v-text-field v-model="editForm.storageRequirements" label="Storage Requirements" variant="outlined" density="comfortable" />
                </v-col>
              </v-row>
            </template>
            <p v-else class="text-medium-emphasis mb-0">Select a medicine to continue.</p>
          </template>

          <template v-else-if="actionType === 'archive'">
            <v-select
              v-model="actionMedicineId"
              :items="actionMedicineOptions"
              label="Select Medicine To Archive"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <p v-if="actionMedicine" class="text-body-1 mb-0">
              Archive <strong>{{ actionMedicine.name }}</strong>? This removes it from active inventory list.
            </p>
            <p v-else class="text-medium-emphasis mb-0">Select a medicine to continue.</p>
          </template>

          <template v-else-if="actionType === 'restock'">
            <v-select
              v-model="actionMedicineId"
              :items="actionMedicineOptions"
              label="Select Medicine To Restock"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <template v-if="actionMedicine">
              <p class="text-body-1 mb-3">
                Restock <strong>{{ actionMedicine.name }}</strong> (Current: {{ actionMedicine.stock }}/{{ actionMedicine.capacity }})
              </p>
              <v-row>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="restockForm.quantity" type="number" label="Quantity" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model="restockForm.batchNo" label="Batch/Lot Number *" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <SaasDateTimePickerField v-model="restockForm.batchExpiry" mode="date" label="Batch Expiry" clearable />
                </v-col>
                <v-col cols="12" md="4">
                  <v-select v-model="restockForm.supplier" :items="supplierItems" label="Supplier" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="restockForm.purchaseCost" type="number" step="0.01" label="Purchase Cost" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model="restockForm.stockLocation" label="Stock Location" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12">
                  <v-text-field v-model="restockForm.reason" label="Restock Reason" variant="outlined" density="comfortable" hint="Required for audit trail" persistent-hint />
                </v-col>
              </v-row>
            </template>
            <p v-else class="text-medium-emphasis mb-0">Select a medicine to continue.</p>
          </template>

          <template v-else-if="actionType === 'dispense'">
            <v-select
              v-model="actionMedicineId"
              :items="actionMedicineOptions"
              label="Select Medicine To Dispense"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <template v-if="actionMedicine">
              <p class="text-body-1 mb-3">
                Dispense <strong>{{ actionMedicine.name }}</strong> (Available: {{ actionMedicine.stock }} {{ actionMedicine.unit }})
              </p>
              <v-row>
                <v-col cols="12" md="6">
                  <v-text-field v-model="dispenseForm.patientName" label="Patient Name" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field v-model.number="dispenseForm.quantity" type="number" label="Quantity" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field v-model="dispenseForm.prescriptionRef" label="Prescription Reference *" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="6">
                  <v-text-field v-model="dispenseForm.dispenseReason" label="Dispense Reason *" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12">
                  <v-textarea v-model="dispenseForm.notes" rows="3" label="Instruction Notes" variant="outlined" density="comfortable" />
                </v-col>
              </v-row>
            </template>
            <p v-else class="text-medium-emphasis mb-0">Select a medicine to continue.</p>
          </template>

          <template v-else-if="actionType === 'adjust'">
            <v-select
              v-model="actionMedicineId"
              :items="actionMedicineOptions"
              label="Select Medicine To Adjust"
              variant="outlined"
              density="comfortable"
              class="mb-3"
            />
            <template v-if="actionMedicine">
              <p class="text-body-1 mb-3">
                Adjust <strong>{{ actionMedicine.name }}</strong> (Current: {{ actionMedicine.stock }} {{ actionMedicine.unit }})
              </p>
              <v-row>
                <v-col cols="12" md="4">
                  <v-select v-model="adjustForm.mode" :items="['increase', 'decrease', 'set']" label="Adjustment Type" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field v-model.number="adjustForm.quantity" type="number" label="Quantity" variant="outlined" density="comfortable" />
                </v-col>
                <v-col cols="12" md="4">
                  <v-text-field :model-value="actionMedicine.stock + ' ' + actionMedicine.unit" label="Current Stock" variant="outlined" density="comfortable" readonly />
                </v-col>
                <v-col cols="12">
                  <v-textarea v-model="adjustForm.reason" rows="2" label="Stock Adjustment Reason *" variant="outlined" density="comfortable" hint="Required for audit logging." persistent-hint />
                </v-col>
              </v-row>
            </template>
            <p v-else class="text-medium-emphasis mb-0">Select a medicine to continue.</p>
          </template>

          <template v-else-if="actionType === 'fulfill' && actionRequest">
            <p class="text-body-1 mb-2">
              Fulfill request <strong>#{{ actionRequest.id }}</strong> for <strong>{{ actionRequest.patientName }}</strong>.
            </p>
            <p class="text-medium-emphasis mb-0">
              Medicine: {{ actionRequest.medicineName }} • Quantity: {{ actionRequest.quantity }} • RX: {{ actionRequest.prescriptionRef }} • Reason: {{ actionRequest.dispenseReason }}
            </p>
          </template>
        </v-card-text>

        <v-card-actions class="px-6 pb-5">
          <v-spacer />
          <v-btn class="saas-btn saas-btn-ghost" variant="text" @click="actionDialog = false">Cancel</v-btn>
          <v-btn
            v-if="actionType === 'add' || actionType === 'restock' || actionType === 'dispense'"
            class="saas-btn saas-btn-ghost"
            :loading="actionDraftLoading"
            :disabled="actionLoading"
            @click="saveDraftAction"
          >
            Save Draft
          </v-btn>
          <v-btn class="saas-btn saas-btn-primary" :loading="actionLoading" @click="submitAction">{{ dialogActionText }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :color="snackbarColor" :timeout="2400">{{ snackbarText }}</v-snackbar>
  </div>
</template>

<style scoped>
.pharmacy-page {
  background: radial-gradient(1000px 560px at 4% -12%, rgba(68, 108, 221, 0.14), transparent 60%),
    radial-gradient(860px 500px at 97% 4%, rgba(168, 91, 255, 0.1), transparent 58%);
}

.pharmacy-content {
  opacity: 0;
  transform: translateY(10px);
  transition: opacity 260ms ease, transform 260ms ease;
}

.pharmacy-content.is-ready {
  opacity: 1;
  transform: translateY(0);
}

.hero-card {
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(120deg, #152a7c 0%, #3063cc 52%, #47a8f2 100%);
  box-shadow: 0 16px 34px rgba(20, 45, 126, 0.24);
}

.hero-kicker {
  display: inline-flex;
  font-size: 12px;
  letter-spacing: 0.8px;
  text-transform: uppercase;
  font-weight: 800;
  border-radius: 999px;
  padding: 4px 10px;
  margin-bottom: 10px;
  background: rgba(255, 255, 255, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.35);
}

.hero-subtitle {
  color: rgba(255, 255, 255, 0.9) !important;
}

.role-select {
  min-width: 150px;
}

.surface-card {
  border-radius: 14px;
  background: linear-gradient(180deg, #ffffff 0%, #fbfdff 100%);
}

.metric-card {
  border-radius: 12px;
  color: #fff;
  box-shadow: 0 10px 22px rgba(19, 39, 108, 0.2);
}

.metric-total {
  background: linear-gradient(135deg, #2f64d0 0%, #3f8df2 100%);
}

.metric-low {
  background: linear-gradient(135deg, #e88235 0%, #f59e0b 100%);
}

.metric-out {
  background: linear-gradient(135deg, #7c3aed 0%, #5b21b6 100%);
}

.metric-pending {
  background: linear-gradient(135deg, #0891b2 0%, #0284c7 100%);
}

.metric-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.7px;
  font-weight: 700;
}

.metric-value {
  font-size: 34px;
  line-height: 1.1;
  font-weight: 800;
}

.summary-alert-bar {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
}

.summary-alert {
  border: 1px solid rgba(86, 113, 172, 0.24);
  border-radius: 12px;
  padding: 10px 12px;
  background: #f8faff;
  font-weight: 700;
  color: #304a7d;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  cursor: pointer;
  transition: all 180ms ease;
}

.summary-alert:hover {
  transform: translateY(-1px);
  box-shadow: 0 8px 16px rgba(32, 61, 122, 0.12);
}

.summary-alert.active {
  border-color: rgba(60, 111, 212, 0.42);
  background: #eef4ff;
}

.filter-chip-row {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.quick-filter-chip {
  border: 1px solid rgba(80, 112, 176, 0.23);
  border-radius: 999px;
  padding: 6px 12px;
  background: #f7f9ff;
  color: #425f95;
  font-size: 13px;
  font-weight: 700;
  cursor: pointer;
  transition: all 160ms ease;
}

.quick-filter-chip.active {
  color: #fff;
  border-color: transparent;
  background: linear-gradient(120deg, #2f67d2 0%, #38a0ef 100%);
}

.stock-table-wrap {
  max-height: 470px;
  overflow: auto;
  border-radius: 12px;
}

.stock-table-wrap :deep(thead th) {
  position: sticky;
  top: 0;
  z-index: 2;
  background: #f8fbff;
}

.sortable-head {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 0;
  padding: 0;
  background: transparent;
  font-size: 12px;
  font-weight: 800;
  color: inherit;
  cursor: pointer;
}

.stock-row {
  transition: background 180ms ease, box-shadow 180ms ease, transform 180ms ease;
}

.stock-row:hover {
  background: rgba(49, 96, 188, 0.08);
}

.action-col {
  min-width: 230px;
}

.action-cell {
  display: flex;
  justify-content: flex-end;
  align-items: center;
  gap: 6px;
  white-space: nowrap;
}

.action-primary-btn {
  min-width: 94px;
  min-height: 34px;
  flex: 0 0 auto;
}

.action-more-btn {
  min-width: 86px;
  min-height: 34px;
  flex: 0 0 auto;
}

.stock-row-out {
  box-shadow: inset 4px 0 0 rgba(239, 68, 68, 0.55);
}

.stock-row-low {
  box-shadow: inset 4px 0 0 rgba(249, 115, 22, 0.55);
}

.stock-row-healthy {
  box-shadow: inset 4px 0 0 rgba(34, 197, 94, 0.5);
}

.selected-row {
  background: rgba(59, 130, 246, 0.09);
}

.stock-inline {
  min-width: 280px;
}

.stock-summary {
  font-size: 12px;
  color: #425a89;
  margin-bottom: 6px;
  display: flex;
  justify-content: space-between;
  gap: 10px;
  font-weight: 700;
}

.stock-bar {
  width: 100%;
  height: 8px;
  border-radius: 999px;
  background: #e8edf8;
  overflow: hidden;
}

.stock-bar-thick {
  height: 11px;
}

.stock-bar span {
  display: block;
  height: 100%;
  border-radius: inherit;
}

.saas-btn {
  border-radius: 12px;
  min-height: 40px;
  text-transform: none;
  font-weight: 700;
  letter-spacing: 0.2px;
  transition: transform 170ms ease, box-shadow 170ms ease;
}

.saas-btn:hover {
  transform: translateY(-1px);
}

.saas-btn-primary {
  background: linear-gradient(120deg, #2d61d0 0%, #4094ee 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(34, 78, 165, 0.22);
}

.saas-btn-info {
  background: linear-gradient(120deg, #1f7ad5 0%, #06b6d4 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(34, 115, 165, 0.2);
}

.saas-btn-success {
  background: linear-gradient(120deg, #0d9e79 0%, #22c55e 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(27, 130, 84, 0.2);
}

.saas-btn-warning {
  background: linear-gradient(120deg, #eb8f22 0%, #f59e0b 100%) !important;
  color: #fff !important;
  box-shadow: 0 8px 16px rgba(163, 96, 26, 0.22);
}

.saas-btn-light {
  background: #fff !important;
  color: #1b3a74 !important;
  box-shadow: 0 8px 16px rgba(23, 50, 103, 0.14);
}

.saas-btn-ghost {
  background: #f5f8ff !important;
  color: #335792 !important;
  border: 1px solid rgba(52, 92, 168, 0.22) !important;
  box-shadow: none;
}

.alerts-chip {
  font-weight: 700;
}

.history-head {
  border-bottom: 1px solid rgba(90, 112, 165, 0.24);
}

:deep(.v-theme--dark) .stock-table-wrap :deep(thead th) {
  background: rgba(24, 36, 68, 0.94);
}

:deep(.v-theme--dark) .stock-bar {
  background: rgba(255, 255, 255, 0.18);
}

:deep(.v-theme--dark) .stock-summary {
  color: rgba(231, 237, 255, 0.9);
}

:deep(.v-theme--dark) .summary-alert {
  color: #dbe8ff;
  background: rgba(255, 255, 255, 0.06);
  border-color: rgba(177, 199, 245, 0.25);
}

@media (max-width: 1120px) {
  .summary-alert-bar {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 760px) {
  .summary-alert-bar {
    grid-template-columns: 1fr;
  }

  .stock-inline {
    min-width: 210px;
  }
}
</style>

