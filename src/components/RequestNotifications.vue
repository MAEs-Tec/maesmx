<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { subscribeNotifications, markNotificationRead } from '@/firebase/db/advisoryRequests';

const router = useRouter();
const toast = useToast();
const panel = ref(null);
const notifications = ref([]);
const error = ref('');
const userKey = ref('');
const unread = computed(() => notifications.value.filter(item => !item.readAt).length);
let stopAuth;
let stopNotifications;
let generation = 0;

onMounted(() => {
    stopAuth = onAuthStateChanged(getAuth(), user => {
        generation++;
        stopNotifications?.();
        if (userKey.value) toast.removeGroup('advisory-requests');
        notifications.value = [];
        error.value = '';
        userKey.value = '';
        if (!user?.emailVerified || !user.email) return;
        userKey.value = user.email.trim().toLowerCase().split('@')[0];
        const currentGeneration = generation;
        let initialized = false;
        const seen = new Set();
        stopNotifications = subscribeNotifications(userKey.value, items => {
            if (currentGeneration !== generation) return;
            notifications.value = items;
            for (const item of items) {
                if (initialized && !seen.has(item.id) && !item.readAt) {
                    toast.add({
                        group: 'advisory-requests', severity: 'info',
                        summary: item.title || 'Solicitud de asesoría',
                        detail: item.body || 'Hay novedades en una solicitud.',
                        data: item, life: 10000
                    });
                }
                seen.add(item.id);
            }
            initialized = true;
        }, () => {
            if (currentGeneration === generation) error.value = 'No pudimos actualizar tus avisos. Recarga la página para reintentar.';
        });
    });
});
onBeforeUnmount(() => {
    generation++;
    stopAuth?.();
    stopNotifications?.();
    toast.removeGroup('advisory-requests');
});
async function openNotification(item) {
    panel.value?.hide();
    if (!item.requestId) return;
    const currentGeneration = generation;
    try {
        if (!item.readAt) await markNotificationRead(userKey.value, item.id);
    } catch {
        if (currentGeneration !== generation) return;
        error.value = 'El aviso sigue pendiente de lectura. Puedes consultar la solicitud.';
    }
    if (currentGeneration !== generation) return;
    await router.push({ name: 'solicitudAsesoria', params: { id: item.requestId } });
}
</script>

<template>
    <div class="request-notifications">
        <button class="p-link layout-topbar-button" :aria-label="`Solicitudes: ${unread} avisos sin leer`" aria-haspopup="true" aria-controls="request-notifications-panel" @click="panel.toggle($event)">
            <i class="pi pi-bell" aria-hidden="true"></i>
            <span v-if="unread" class="notification-count">{{ unread > 99 ? '99+' : unread }}</span>
        </button>
        <OverlayPanel ref="panel" id="request-notifications-panel" class="request-notification-panel">
            <div class="notification-content">
                <div class="flex align-items-center justify-content-between gap-3 mb-3">
                    <strong>Solicitudes de asesoría</strong>
                    <router-link to="/solicitudes" @click="panel.hide()">Ver todas</router-link>
                </div>
                <Message v-if="error" severity="warn" :closable="false">{{ error }}</Message>
                <p v-if="!notifications.length" class="text-color-secondary">No tienes avisos pendientes.</p>
                <ul v-else class="notification-list">
                    <li v-for="item in notifications" :key="item.id">
                        <button class="notification-item" :class="{ unread: !item.readAt }" @click="openNotification(item)">
                            <strong>{{ item.title || 'Solicitud de asesoría' }}</strong>
                            <span>{{ item.body }}</span>
                            <small v-if="!item.readAt">Sin leer</small>
                        </button>
                    </li>
                </ul>
            </div>
        </OverlayPanel>
        <Toast group="advisory-requests" position="bottom-right">
            <template #message="{ message }">
                <div class="flex flex-column gap-2">
                    <strong>{{ message.summary }}</strong>
                    <span>{{ message.detail }}</span>
                    <Button label="Ver solicitud" size="small" severity="secondary" @click="openNotification(message.data)" />
                </div>
            </template>
        </Toast>
    </div>
</template>

<style scoped>
.request-notifications { position: relative; }
.request-notifications .layout-topbar-button .notification-count { display: inline-flex; align-items: center; justify-content: center; position: absolute; top: 0; right: 0; min-width: 1.1rem; padding: 0.1rem 0.3rem; border-radius: 1rem; background: var(--primary-color); color: var(--primary-color-text); font-size: 0.7rem; }
.notification-content { width: min(22rem, 76vw); }
.notification-list { list-style: none; padding: 0; margin: 0; max-height: 24rem; overflow-y: auto; }
.notification-item { display: flex; flex-direction: column; gap: 0.35rem; text-align: left; width: 100%; padding: 0.8rem; color: var(--text-color); border: 0; border-top: 1px solid var(--surface-border); background: transparent; cursor: pointer; }
.notification-item:hover, .notification-item:focus-visible { background: var(--surface-hover); }
.notification-item.unread { border-left: 3px solid var(--primary-color); }
</style>
