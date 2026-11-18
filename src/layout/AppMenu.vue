<script setup>
import { ref, onMounted } from 'vue';
import { getAuth } from 'firebase/auth';
import { buildMenuForRole, getClaimsRole } from '@/auth/roles';

import AppMenuItem from './AppMenuItem.vue';

const model = ref([]);

onMounted(async () => {
    const role = await getClaimsRole();
    // El menú "Mi perfil" necesita la matrícula (parte antes del @), no el UID de Auth,
    // porque los docs en Firestore usan la matrícula como docId.
    const email = getAuth().currentUser?.email;
    const matricula = email ? email.split('@')[0] : getAuth().currentUser?.uid;
    model.value = buildMenuForRole(role, matricula);
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
