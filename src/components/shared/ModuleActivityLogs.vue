<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { fetchModuleActivity, type ModuleActivityItem } from '@/services/moduleActivity';

const props = withDefaults(
  defineProps<{
    module: string;
    title?: string;
    perPage?: number;
  }>(),
  {
    title: 'Activity Logs',
    perPage: 8
  }
);

const loading = ref(false);
const page = ref(1);
const totalPages = ref(1);
const total = ref(0);
const rows = ref<ModuleActivityItem[]>([]);
const error = ref('');

const headerTitle = computed(() => props.title || 'Activity Logs');
const moduleLabel = computed(() => (props.module || 'all').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase()));
const summaryText = computed(() => {
  if (!total.value) return 'No logs available.';
  const start = (page.value - 1) * props.perPage + 1;
  const end = Math.min(page.value * props.perPage, total.value);
  return `Showing ${start}-${end} of ${total.value} logs`;
});

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value || '--';
  return parsed.toLocaleString();
}

async function load(): Promise<void> {
  loading.value = true;
  error.value = '';
  try {
    const payload = await fetchModuleActivity({
      module: props.module,
      page: page.value,
      perPage: props.perPage
    });
    rows.value = payload.items || [];
    total.value = payload.meta.total || 0;
    totalPages.value = payload.meta.totalPages || 1;
  } catch (e) {
    rows.value = [];
    total.value = 0;
    totalPages.value = 1;
    error.value = e instanceof Error ? e.message : String(e);
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.module,
  () => {
    page.value = 1;
    void load();
  }
);

watch(page, () => {
  void load();
});

onMounted(() => {
  void load();
});
</script>

<template>
  <v-card class="module-log-card mt-4" variant="outlined">
    <v-card-item>
      <v-card-title class="d-flex align-center justify-space-between ga-2">
        <span>{{ headerTitle }}</span>
        <v-chip size="small" color="primary" variant="tonal">{{ moduleLabel }}</v-chip>
      </v-card-title>
      <v-card-subtitle>{{ summaryText }}</v-card-subtitle>
    </v-card-item>
    <v-divider />
    <v-card-text>
      <v-alert v-if="error" type="error" variant="tonal" density="comfortable" class="mb-3">{{ error }}</v-alert>
      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-2" />
      <v-table density="comfortable" class="module-log-table">
        <thead>
          <tr>
            <th>ACTION</th>
            <th>DETAIL</th>
            <th>ACTOR</th>
            <th>ENTITY</th>
            <th>DATE/TIME</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in rows" :key="item.id">
            <td class="font-weight-bold">{{ item.action }}</td>
            <td>{{ item.detail }}</td>
            <td>{{ item.actor || '--' }}</td>
            <td>{{ item.entity_key || item.entity_type || '--' }}</td>
            <td>{{ formatDate(item.created_at) }}</td>
          </tr>
          <tr v-if="!loading && !rows.length">
            <td colspan="5" class="text-center text-medium-emphasis py-5">No activity logs found.</td>
          </tr>
        </tbody>
      </v-table>
      <div class="d-flex justify-end mt-3" v-if="totalPages > 1">
        <v-pagination v-model="page" :length="totalPages" total-visible="6" density="comfortable" />
      </div>
    </v-card-text>
  </v-card>
</template>

<style scoped>
.module-log-card {
  border-radius: 16px;
  border-color: rgba(78, 107, 168, 0.2) !important;
  background: linear-gradient(180deg, #ffffff 0%, #f9fbff 100%);
}

.module-log-table th {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.45px;
  color: #48608d;
}

.module-log-table td {
  vertical-align: middle;
}
</style>
