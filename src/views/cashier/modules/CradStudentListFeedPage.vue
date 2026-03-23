<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import CashierAnalyticsCard from '@/components/shared/CashierAnalyticsCard.vue';
import {
  fetchCradStudentListFeedSnapshot,
  sendPaidStudentToCradStudentListFeed,
  type CradPaidStudentItem,
  type CradSentStudentItem
} from '@/services/cradStudentListFeed';

const loading = ref(false);
const actionLoadingId = ref<number | null>(null);
const errorMessage = ref('');
const snackbar = ref(false);
const snackbarMessage = ref('');
const search = ref('');
const stats = ref<Array<{ title: string; value: string; subtitle: string; icon: string; tone: 'green' | 'blue' | 'orange' | 'purple' }>>([]);
const eligibleItems = ref<CradPaidStudentItem[]>([]);
const sentItems = ref<CradSentStudentItem[]>([]);

const filteredEligibleItems = computed(() => {
  const keyword = search.value.trim().toLowerCase();
  if (!keyword) return eligibleItems.value;
  return eligibleItems.value.filter((item) =>
    [item.studentNo, item.studentName, item.batchId, item.semester, item.academicYear].join(' ').toLowerCase().includes(keyword)
  );
});

async function loadSnapshot() {
  loading.value = true;
  errorMessage.value = '';
  try {
    const snapshot = await fetchCradStudentListFeedSnapshot();
    stats.value = snapshot.stats;
    eligibleItems.value = snapshot.eligibleItems;
    sentItems.value = snapshot.sentItems;
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : 'Unable to load CRAD student feed data.';
  } finally {
    loading.value = false;
  }
}

async function sendToCrad(item: CradPaidStudentItem) {
  if (item.alreadySent) return;
  actionLoadingId.value = item.enrollmentFeedId;
  try {
    const response = await sendPaidStudentToCradStudentListFeed(item.enrollmentFeedId);
    snackbarMessage.value = response.message || `${item.studentName} was sent to CRAD student list feed.`;
    snackbar.value = true;
    await loadSnapshot();
  } catch (error) {
    snackbarMessage.value = error instanceof Error ? error.message : 'Unable to send student to CRAD feed.';
    snackbar.value = true;
  } finally {
    actionLoadingId.value = null;
  }
}

onMounted(() => {
  loadSnapshot();
});
</script>

<template>
  <v-row>
    <v-col cols="12">
      <v-card class="hero-banner" elevation="0">
        <v-card-text class="pa-6">
          <div class="hero-kicker">CRAD Integration</div>
          <h1 class="text-h4 font-weight-black mb-2">Paid Downpayment Student List</h1>
          <p class="hero-subtitle mb-0">
            Review students with paid downpayment and send eligible records to <code>crad_student_list_feed</code>.
          </p>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col v-for="stat in stats" :key="stat.title" cols="12" sm="6" lg="3">
      <CashierAnalyticsCard :title="stat.title" :value="stat.value" :subtitle="stat.subtitle" :icon="stat.icon" :tone="stat.tone" />
    </v-col>

    <v-col cols="12">
      <v-card variant="outlined">
        <v-card-item>
          <v-card-title>Eligible Paid Students</v-card-title>
          <v-card-subtitle>Approved registrar enrollment feed students are eligible to send to CRAD.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-alert v-if="errorMessage" type="error" variant="tonal" class="mb-4">{{ errorMessage }}</v-alert>
          <v-text-field
            v-model="search"
            label="Search student"
            placeholder="Student no, name, batch, semester"
            variant="outlined"
            density="comfortable"
            class="mb-4"
            clearable
          />
          <div v-if="loading" class="py-10 text-center">
            <v-progress-circular indeterminate color="primary" />
          </div>
          <v-table v-else density="comfortable">
            <thead>
              <tr>
                <th>Student No</th>
                <th>Name</th>
                <th>Semester</th>
                <th>Downpayment</th>
                <th>Paid Amount</th>
                <th>Downpayment Balance</th>
                <th>Billing Balance</th>
                <th>Billing</th>
                <th>Status</th>
                <th class="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="item in filteredEligibleItems" :key="item.enrollmentFeedId">
                <td>{{ item.studentNo }}</td>
                <td>{{ item.studentName }}</td>
                <td>{{ item.semester || '--' }}</td>
                <td>{{ item.downpaymentAmountFormatted }}</td>
                <td>{{ item.paidAmountFormatted }}</td>
                <td>{{ item.downpaymentBalanceAmountFormatted }}</td>
                <td>{{ item.billingBalanceAmountFormatted }}</td>
                <td>
                  <v-chip :color="item.hasUnpaidBilling ? 'error' : 'success'" size="small" variant="tonal">
                    {{ item.hasUnpaidBilling ? 'Unpaid Billing' : 'No Unpaid Billing' }}
                  </v-chip>
                </td>
                <td>
                  <v-chip :color="item.alreadySent ? 'success' : 'warning'" size="small" variant="tonal">
                    {{ item.alreadySent ? 'Sent' : 'Ready to Send' }}
                  </v-chip>
                </td>
                <td class="text-right">
                  <v-btn
                    color="primary"
                    size="small"
                    :disabled="item.alreadySent || !item.readyToSend"
                    :loading="actionLoadingId === item.enrollmentFeedId"
                    @click="sendToCrad(item)"
                  >
                    Send to CRAD
                  </v-btn>
                </td>
              </tr>
              <tr v-if="!filteredEligibleItems.length">
                <td colspan="10" class="text-center text-medium-emphasis py-6">No approved students found.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-col>

    <v-col cols="12">
      <v-card variant="outlined">
        <v-card-item>
          <v-card-title>Already Sent to CRAD</v-card-title>
          <v-card-subtitle>Recent rows inserted into <code>crad_student_list_feed</code>.</v-card-subtitle>
        </v-card-item>
        <v-card-text>
          <v-table density="comfortable">
            <thead>
              <tr>
                <th>Student No</th>
                <th>Name</th>
                <th>Semester</th>
                <th>Downpayment</th>
                <th>Paid Amount</th>
                <th>Sent At</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="row in sentItems" :key="row.id">
                <td>{{ row.studentNo }}</td>
                <td>{{ row.studentName }}</td>
                <td>{{ row.semester || '--' }}</td>
                <td>{{ row.downpaymentAmountFormatted }}</td>
                <td>{{ row.paidAmountFormatted }}</td>
                <td>{{ row.sentAt ? new Date(row.sentAt).toLocaleString() : '--' }}</td>
              </tr>
              <tr v-if="!sentItems.length">
                <td colspan="6" class="text-center text-medium-emphasis py-6">No records have been sent yet.</td>
              </tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </v-col>

    <v-snackbar v-model="snackbar" color="primary" location="top right" :timeout="2400">
      {{ snackbarMessage }}
    </v-snackbar>
  </v-row>
</template>

<style scoped>
.hero-banner {
  border-radius: 18px;
  color: #fff;
  background: linear-gradient(125deg, #163066 0%, #25549d 52%, #5ba6dc 100%);
}

.hero-kicker {
  display: inline-flex;
  align-items: center;
  padding: 4px 12px;
  border-radius: 999px;
  margin-bottom: 12px;
  background: rgba(255, 255, 255, 0.15);
  border: 1px solid rgba(255, 255, 255, 0.26);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  font-size: 12px;
  font-weight: 800;
}

.hero-subtitle {
  max-width: 780px;
  color: rgba(255, 255, 255, 0.92);
}
</style>
