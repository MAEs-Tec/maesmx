<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useRouter } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { subscribeNotifications, markNotificationRead, markNotificationsRead } from '@/firebase/db/advisoryRequests';
import { getClaimsRole, ROLE_GROUPS } from '@/auth/roles';
import { playNotificationSound, unlockNotificationSound, listenForSoundUnlock, isNotificationSoundOn, setNotificationSoundOn } from '@/utils/notificationSound';

const router = useRouter();
const toast = useToast();
const panel = ref(null);
const notifications = ref([]);
const error = ref('');
const userKey = ref('');
const role = ref('');
const soundOn = ref(isNotificationSoundOn());
const markingAll = ref(false);
const unread = computed(() => notifications.value.filter(item => !item.readAt).length);
// MAEs y coordinación reciben avisos de solicitudes en turno: para ellos suena y "Ver todas" abre esos avisos.
const isStaff = computed(() => ROLE_GROUPS.mae.includes(role.value));
let stopAuth;
let stopNotifications;
let stopSoundUnlock;
// Avisos de una misma solicitud que llegan juntos (p. ej. "publicada" y "¿puedes apoyar?") se muestran una vez.
const REPEAT_WINDOW_MS = 30 * 1000;
let generation = 0;

onMounted(() => {
    // El navegador solo deja sonar audio después de que la persona interactúa con la página.
    stopSoundUnlock = listenForSoundUnlock();
    stopAuth = onAuthStateChanged(getAuth(), user => {
        generation++;
        stopNotifications?.();
        if (userKey.value) toast.removeGroup('advisory-requests');
        notifications.value = [];
        error.value = '';
        userKey.value = '';
        role.value = '';
        if (!user?.emailVerified || !user.email) return;
        userKey.value = user.email.trim().toLowerCase().split('@')[0];
        const currentGeneration = generation;
        getClaimsRole().then(value => {
            if (currentGeneration === generation) role.value = value || '';
        }).catch(() => {});
        let initialized = false;
        const seen = new Set();
        const lastShown = new Map();
        stopNotifications = subscribeNotifications(userKey.value, items => {
            if (currentGeneration !== generation) return;
            notifications.value = items;
            // Un solo toast por solicitud aunque lleguen varios avisos de ella en el mismo cambio.
            const fresh = new Map();
            const now = Date.now();
            for (const item of items) {
                const key = item.requestId || item.id;
                if (initialized && !seen.has(item.id) && !item.readAt && !fresh.has(key) &&
                    !(now - (lastShown.get(key) || 0) < REPEAT_WINDOW_MS)) {
                    fresh.set(key, item);
                }
                seen.add(item.id);
            }
            for (const key of fresh.keys()) lastShown.set(key, now);
            for (const item of fresh.values()) {
                toast.add({
                    group: 'advisory-requests', severity: 'info',
                    summary: item.title || 'Solicitud de asesoría',
                    detail: item.body || 'Hay novedades en una solicitud.',
                    data: item, life: 10000
                });
            }
            if (fresh.size && isStaff.value && soundOn.value) playNotificationSound();
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
    stopSoundUnlock?.();
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
// "Ver todas": marca como leídos los avisos pendientes y abre la lista donde aparecen.
async function openAll() {
    if (markingAll.value) return;
    panel.value?.hide();
    const currentGeneration = generation;
    const pending = notifications.value.filter(item => !item.readAt).map(item => item.id);
    markingAll.value = true;
    try {
        if (pending.length) await markNotificationsRead(userKey.value, pending);
    } catch {
        if (currentGeneration === generation) error.value = 'No pudimos marcar los avisos como leídos. Vuelve a intentarlo.';
    } finally {
        markingAll.value = false;
    }
    if (currentGeneration !== generation) return;
    await router.push({ name: 'solicitudAsesoria', query: isStaff.value ? { tab: 'avisos' } : {} });
}
function toggleSound() {
    soundOn.value = !soundOn.value;
    setNotificationSoundOn(soundOn.value);
    if (soundOn.value) {
        unlockNotificationSound();
        playNotificationSound();
    }
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
                    <div class="flex align-items-center gap-2">
                        <button
                            v-if="isStaff"
                            type="button"
                            class="p-link sound-toggle"
                            :aria-label="soundOn ? 'Silenciar avisos' : 'Activar sonido de avisos'"
                            :title="soundOn ? 'Sonido activado' : 'Sonido desactivado'"
                            @click="toggleSound"
                        >
                            <i :class="soundOn ? 'pi pi-volume-up' : 'pi pi-volume-off'" aria-hidden="true"></i>
                        </button>
                        <button type="button" class="p-link view-all" :disabled="markingAll" @click="openAll">Ver todas</button>
                    </div>
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
.view-all { color: var(--primary-color); font-weight: 500; }
.view-all:hover { text-decoration: underline; }
.sound-toggle { color: var(--text-color-secondary); padding: 0.25rem; border-radius: 4px; }
.sound-toggle:hover { background: var(--surface-hover); }
.notification-list { list-style: none; padding: 0; margin: 0; max-height: 24rem; overflow-y: auto; }
.notification-item { display: flex; flex-direction: column; gap: 0.35rem; text-align: left; width: 100%; padding: 0.8rem; color: var(--text-color); border: 0; border-top: 1px solid var(--surface-border); background: transparent; cursor: pointer; }
.notification-item:hover, .notification-item:focus-visible { background: var(--surface-hover); }
.notification-item.unread { border-left: 3px solid var(--primary-color); }
</style>
