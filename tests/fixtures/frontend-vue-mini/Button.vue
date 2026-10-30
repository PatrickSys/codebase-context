<script setup lang="ts">
export interface ButtonProps {
  label: string;
  variant?: 'primary' | 'ghost';
}

const props = defineProps<ButtonProps>();
</script>

<template>
  <button type="button" :data-variant="props.variant">{{ props.label }}</button>
</template>
