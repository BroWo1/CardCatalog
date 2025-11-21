<template>
  <UApp>
    <NuxtPage />
  </UApp>
</template>

<script setup>
import { useColorMode } from '#imports';
const colorMode = useColorMode();

if (colorMode.preference !== 'light') {
  colorMode.preference = 'light';
}
if (colorMode.value !== 'light') {
  colorMode.value = 'light';
}
</script>
