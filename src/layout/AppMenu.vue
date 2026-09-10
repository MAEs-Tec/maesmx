<script setup>
import { ref, onMounted } from 'vue';
import { getAuth } from 'firebase/auth';
import { buildMenuForRole, getClaimsRole } from '@/auth/roles';

import AppMenuItem from './AppMenuItem.vue';

const model = ref([]);

onMounted(async () => {
    const role = await getClaimsRole();
    model.value = buildMenuForRole(role, getAuth().currentUser?.uid);
})
</script>

<template>
    <ul class="layout-menu">
        <template v-for="(item, i) in model" :key="item.label">
            <app-menu-item v-if="!item.separator" :item="item" :index="i"></app-menu-item>
            <li v-if="item.separator" class="menu-separator"></li>
        </template>
    </ul>
</template>

<style lang="scss" scoped></style>
