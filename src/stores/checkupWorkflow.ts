import { defineStore } from 'pinia';
import {
  dispatchCheckupAction,
  fetchCheckupQueue,
  type CheckupActionRequest,
  type CheckupAnalytics,
  type CheckupState,
  type CheckupVisit
} from '@/services/checkupWorkflow';
import { REALTIME_POLICY } from '@/config/realtimePolicy';

type QueueFilters = {
  search: string;
  status: 'All' | CheckupState;
  page: number;
  perPage: number;
};

function fallbackVisits(): CheckupVisit[] {
  return [
    {
      id: 9001,
      visit_id: 'VISIT-LOCAL-2101',
      patient_name: 'Maria Santos',
      assigned_doctor: 'Unassigned',
      source: 'appointment_confirmed',
      status: 'intake',
      chief_complaint: 'Fever with sore throat',
      diagnosis: '',
      clinical_notes: '',
      consultation_started_at: '',
      lab_requested: false,
      lab_result_ready: false,
      prescription_created: false,
      prescription_dispensed: false,
      follow_up_date: '',
      is_emergency: false,
      version: 1,
      updated_at: new Date().toISOString()
    },
    {
      id: 9002,
      visit_id: 'VISIT-LOCAL-2102',
      patient_name: 'Rico Dela Cruz',
      assigned_doctor: 'Dr. Humour',
      source: 'walkin_triage_completed',
      status: 'queue',
      chief_complaint: 'Persistent headache',
      diagnosis: '',
      clinical_notes: '',
      consultation_started_at: '',
      lab_requested: false,
      lab_result_ready: false,
      prescription_created: false,
      prescription_dispensed: false,
      follow_up_date: '',
      is_emergency: false,
      version: 1,
      updated_at: new Date().toISOString()
    },
    {
      id: 9003,
      visit_id: 'VISIT-LOCAL-2103',
      patient_name: 'Ana Perez',
      assigned_doctor: 'Dr. Jenni',
      source: 'appointment_confirmed',
      status: 'in_consultation',
      chief_complaint: 'Cough with fever',
      diagnosis: 'Upper respiratory tract infection',
      clinical_notes: 'Initial assessment ongoing.',
      consultation_started_at: new Date().toISOString(),
      lab_requested: true,
      lab_result_ready: false,
      prescription_created: false,
      prescription_dispensed: false,
      follow_up_date: '',
      is_emergency: false,
      version: 2,
      updated_at: new Date().toISOString()
    }
  ];
}

function buildAnalytics(visits: CheckupVisit[]): CheckupAnalytics {
  return {
    intake: visits.filter((item) => item.status === 'intake' && !item.is_emergency).length,
    queue: visits.filter((item) => item.status === 'queue' && !item.is_emergency).length,
    doctorAssigned: visits.filter((item) => item.status === 'doctor_assigned' && !item.is_emergency).length,
    inConsultation: visits.filter((item) => item.status === 'in_consultation' && !item.is_emergency).length,
    labRequested: visits.filter((item) => item.status === 'lab_requested' && !item.is_emergency).length,
    pharmacy: visits.filter((item) => item.status === 'pharmacy' && !item.is_emergency).length,
    completed: visits.filter((item) => item.status === 'completed').length,
    emergency: visits.filter((item) => item.is_emergency && item.status !== 'archived').length
  };
}

export const useCheckupWorkflowStore = defineStore('checkupWorkflow', {
  state: () => ({
    loading: false,
    syncing: false,
    lastError: '',
    filters: {
      search: '',
      status: 'All',
      page: 1,
      perPage: 8
    } as QueueFilters,
    visits: [] as CheckupVisit[],
    analytics: {
      intake: 0,
      queue: 0,
      doctorAssigned: 0,
      inConsultation: 0,
      labRequested: 0,
      pharmacy: 0,
      completed: 0,
      emergency: 0
    } as CheckupAnalytics,
    meta: {
      page: 1,
      perPage: 8,
      total: 0,
      totalPages: 1
    },
    _refreshTimer: 0 as unknown as ReturnType<typeof setInterval> | 0,
    _fetchToken: 0
  }),
  getters: {
    visitById: (state) => (id: number | null) => state.visits.find((item) => item.id === id) || null
  },
  actions: {
    async fetchQueue(options: { silent?: boolean } = {}) {
      const token = ++this._fetchToken;
      if (!options.silent) {
        this.loading = true;
      }
      try {
        const payload = await fetchCheckupQueue({
          search: this.filters.search,
          status: this.filters.status === 'All' ? undefined : this.filters.status,
          page: this.filters.page,
          perPage: this.filters.perPage
        });
        if (token !== this._fetchToken) return;
        this.visits = payload.items;
        this.analytics = payload.analytics;
        this.meta = payload.meta;
        this.lastError = '';
      } catch (error) {
        if (token !== this._fetchToken) return;
        const fallback = fallbackVisits();
        this.visits = fallback;
        this.analytics = buildAnalytics(fallback);
        this.meta = {
          page: 1,
          perPage: this.filters.perPage,
          total: fallback.length,
          totalPages: 1
        };
        this.lastError = error instanceof Error ? error.message : String(error);
      } finally {
        if (!options.silent && token === this._fetchToken) {
          this.loading = false;
        }
      }
    },
    async syncQueue(options: { silent?: boolean } = {}) {
      if (!options.silent) {
        this.syncing = true;
      }
      try {
        await this.fetchQueue({ silent: options.silent ?? true });
      } finally {
        if (!options.silent) {
          this.syncing = false;
        }
      }
    },
    async executeAction(request: CheckupActionRequest) {
      const updated = await dispatchCheckupAction(request);
      const index = this.visits.findIndex((item) => item.id === updated.id);
      if (index >= 0) {
        this.visits[index] = updated;
      }
      await this.syncQueue({ silent: false });
      return updated;
    },
    startRealtimePolling(intervalMs = REALTIME_POLICY.polling.checkupMs) {
      this.stopRealtimePolling();
      this._refreshTimer = setInterval(() => {
        void this.syncQueue({ silent: true });
      }, intervalMs);
    },
    stopRealtimePolling() {
      if (this._refreshTimer) {
        clearInterval(this._refreshTimer);
        this._refreshTimer = 0;
      }
    }
  }
});
