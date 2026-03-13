<script setup>
import Icon from '../IconSet.vue';

const props = defineProps({ item: Object, level: Number });
</script>

<template>
  <!---Single Item-->
  <v-list-item
    :to="item.type === 'external' ? '' : item.to"
    :href="item.type === 'external' ? item.to : ''"
    exact
    rounded
    class="mb-1 cashier-nav-item"
    color="secondary"
    :disabled="item.disabled"
    :target="item.type === 'external' ? '_blank' : ''"
  >
    <!---If icon-->
    <template v-slot:prepend>
      <div class="cashier-nav-icon">
        <Icon :item="props.item" :level="props.level" />
      </div>
    </template>
    <v-list-item-title>{{ item.title }}</v-list-item-title>
    <!---If Caption-->
    <v-list-item-subtitle v-if="item.subCaption" class="text-caption mt-n1 hide-menu">
      {{ item.subCaption }}
    </v-list-item-subtitle>
    <!---If any chip or label-->
    <template v-slot:append v-if="item.chip">
      <v-chip
        :color="item.chipColor"
        class="sidebarchip hide-menu"
        :size="item.chipIcon ? 'small' : 'default'"
        :variant="item.chipVariant"
        :prepend-icon="item.chipIcon"
      >
        {{ item.chip }}
      </v-chip>
    </template>
  </v-list-item>
</template>

<style scoped>
.cashier-nav-item {
  min-height: 48px;
  border-radius: 14px;
  transition:
    background-color 0.2s ease,
    transform 0.2s ease,
    box-shadow 0.2s ease;
}

.cashier-nav-item :deep(.v-list-item__prepend) {
  margin-inline-end: 12px;
}

.cashier-nav-item :deep(.v-list-item-title) {
  font-weight: 600;
  letter-spacing: 0.01em;
}

.cashier-nav-icon {
  width: 32px;
  height: 32px;
  border-radius: 10px;
  display: grid;
  place-items: center;
  background: rgba(255, 255, 255, 0.08);
  color: inherit;
}

.cashier-nav-item:hover {
  transform: translateX(1px);
}

.cashier-nav-item.v-list-item--active {
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.08);
}

.cashier-nav-item.v-list-item--active .cashier-nav-icon {
  background: rgba(255, 255, 255, 0.14);
}
</style>
