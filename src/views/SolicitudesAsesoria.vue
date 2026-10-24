<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { useRoute, useRouter } from 'vue-router';
import { v4 as uuid } from 'uuid';
import { getCurrentUser } from '@/firebase/db/users';
import { getSubjects } from '@/firebase/db/subjects';
import { getCampuses } from '@/firebase/db/campuses';
import { getClaimsRole, ROLE_GROUPS } from '@/auth/roles';
import {
    createAdvisoryRequest, offerAdvisoryHelp, withdrawAdvisoryOffer,
    assignAdvisoryRequest, unassignAdvisoryRequest, closeAdvisoryRequest,
    subscribeMyRequests, subscribeCampusRequests, subscribeRequest,
    subscribeOffers, subscribeNotifications, getAdvisoryRequest, getRequestHistory
} from '@/firebase/db/advisoryRequests';

const route = useRoute();
const router = useRouter();
const profile = ref(null);
const role = ref('');
const studentKey = ref('');
const loading = ref(true);
const error = ref('');
const detailError = ref('');
const busy = ref(false);
const subjects = ref([]);
const campuses = ref([]);
const ownRequests = ref([]);
const campusRequests = ref([]);
const invitations = ref([]);
const selected = ref(null);
const offers = ref([]);
const detailLoading = ref(false);
const tab = ref('mine');
const showCreate = ref(false);
const forAnother = ref(false);
const studentEmail = ref('');
const campus = ref('');
const subject = ref(null);
const topic = ref('');
const location = ref('');
const createError = ref('');
const operationId = ref(uuid());
const closeDialog = ref(false);
const closeReason = ref('not_held');
const history = ref([]);
const historyLoading = ref(false);
const hasMoreHistory = ref(true);
let historyCursor = null;
let stopAuth;
let subscriptions = [];
let detailSubscriptions = [];
let generation = 0;
let detailGeneration = 0;
let invitationGeneration = 0;
const requestCache = new Map();
let historyGeneration = 0;
const isCoordi = computed(() => ROLE_GROUPS.coordi.includes(role.value));
const isMae = computed(() => ROLE_GROUPS.mae.includes(role.value));
const isOwner = computed(() => selected.value?.studentKey === studentKey.value);
const canManage = computed(() => isOwner.value || selected.value?.creatorKey === studentKey.value || (
    isCoordi.value && (['admin', 'tec'].includes(role.value) || selected.value?.campus === profile.value?.campus)
));
const activeOffers = computed(() => offers.value.filter(offer => offer.status === 'active' && offer.assignmentVersion === selected.value?.assignmentVersion));
const myOffer = computed(() => activeOffers.value.find(offer => (offer.maeKey || offer.id) === studentKey.value));
const FIVE_HOURS_MS = 5 * 60 * 60 * 1000;
const hasActiveTurnInCampus = computed(() => {
    const session = profile.value?.activeSession;
    const start = session?.startTime?.toMillis?.() ?? (session?.startTime?.seconds ? session.startTime.seconds * 1000 : null);
    return !!start && Date.now() - start < FIVE_HOURS_MS && !!selected.value?.campus && profile.value?.campus === selected.value.campus;
});
const canOffer = computed(() => isMae.value && selected.value?.status === 'open' && !isOwner.value);
const currentRequests = computed(() => tab.value === 'campus' ? campusRequests.value : tab.value === 'invitations' ? invitations.value : ownRequests.value);
const olderRequests = computed(() => {
    const currentIds = new Set(currentRequests.value.map(item => item.id));
    return history.value.filter(item => !currentIds.has(item.id));
});
const closed = request => ['closed', 'registered'].includes(request.status);
const statusText = request => ({
    open: 'Buscando asesor',
    assigned: 'Asignada · pendiente de registro',
    registered: 'Asesoría registrada',
    closed: {
        missing_registration: 'Cerrada · falta registro',
        expired: 'Caducó sin asesor'
    }[request.closeReason] || 'Cerrada · no se realizó'
}[request.status] || 'Solicitud');
const canRegister = computed(() => isOwner.value && (
    selected.value?.status === 'assigned' ||
    (selected.value?.status === 'closed' && selected.value?.closeReason === 'missing_registration')
) && selected.value?.assignedMaeKey);
const dateLabel = value => {
    const date = value?.toDate ? value.toDate() : value?.seconds ? new Date(value.seconds * 1000) : null;
    return date ? date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '';
};
function message(cause) {
    if (cause?.code?.includes('unavailable')) return 'No hay conexión. Revisa tu internet y vuelve a intentarlo.';
    return cause?.message || 'No pudimos completar la acción. Vuelve a intentarlo.';
}
function clearSubscriptions() {
    subscriptions.forEach(stop => stop());
    subscriptions = [];
    detailSubscriptions.forEach(stop => stop());
    detailSubscriptions = [];
    detailGeneration++;
    invitationGeneration++;
}
function watchDetail() {
    detailSubscriptions.forEach(stop => stop());
    detailSubscriptions = [];
    const current = ++detailGeneration;
    selected.value = null;
    offers.value = [];
    detailError.value = '';
    detailLoading.value = false;
    if (!route.params.id || !profile.value) return;
    detailLoading.value = true;
    let offersStarted = false;
    const fail = cause => {
        if (current !== detailGeneration) return;
        detailLoading.value = false;
        detailError.value = message(cause);
    };
    detailSubscriptions.push(subscribeRequest(route.params.id, value => {
        if (current !== detailGeneration) return;
        selected.value = value;
        detailLoading.value = false;
        if (!value) detailError.value = 'Esta solicitud no está disponible.';
        if (value && !offersStarted) {
            offersStarted = true;
            detailSubscriptions.push(subscribeOffers(value.id, values => {
                if (current === detailGeneration) offers.value = values;
            }, fail, canManage.value ? undefined : studentKey.value));
        }
    }, fail));
}
watch(() => route.params.id, watchDetail);
watch(tab, () => {
    historyGeneration++;
    historyLoading.value = false;
    history.value = [];
    historyCursor = null;
    hasMoreHistory.value = true;
});
onMounted(() => {
    stopAuth = onAuthStateChanged(getAuth(), async user => {
        const current = ++generation;
        clearSubscriptions();
        profile.value = null;
        requestCache.clear();
        ownRequests.value = [];
        campusRequests.value = [];
        invitations.value = [];
        selected.value = null;
        history.value = [];
        historyCursor = null;
        hasMoreHistory.value = true;
        historyGeneration++;
        historyLoading.value = false;
        role.value = '';
        studentKey.value = '';
        error.value = '';
        loading.value = true;
        if (!user?.emailVerified || !user.email) {
            loading.value = false;
            error.value = 'Inicia sesión con tu correo institucional verificado para consultar solicitudes.';
            return;
        }
        try {
            const [userProfile, claimRole, subjectList, campusList] = await Promise.all([
                getCurrentUser({ forceRefresh: true }), getClaimsRole(), getSubjects(), getCampuses()
            ]);
            if (current !== generation) return;
            if (!userProfile) throw new Error('Completa tu perfil para usar las solicitudes.');
            profile.value = userProfile;
            studentKey.value = user.email.trim().toLowerCase().split('@')[0];
            role.value = claimRole;
            subjects.value = subjectList || [];
            campuses.value = campusList || [];
            campus.value = userProfile.campus || '';
            location.value = userProfile.activeSession?.location || '';
            const fail = cause => { if (current === generation) error.value = message(cause); };
            subscriptions.push(subscribeMyRequests(studentKey.value, values => { ownRequests.value = values; }, fail));
            if (isCoordi.value && userProfile.campus) {
                subscriptions.push(subscribeCampusRequests(userProfile.campus, values => { campusRequests.value = values; }, fail));
            }
            if (isMae.value) {
                subscriptions.push(subscribeNotifications(studentKey.value, async values => {
                    const invitationLoad = ++invitationGeneration;
                    const ids = [...new Set(values.map(value => value.requestId).filter(Boolean))];
                    // Only fetch what is not loaded yet; closed/registered requests never change again.
                    const pending = ids.filter(id => !requestCache.has(id) || !closed(requestCache.get(id)));
                    const results = await Promise.allSettled(pending.map(id => getAdvisoryRequest(id)));
                    if (current !== generation || invitationLoad !== invitationGeneration) return;
                    results.forEach((result, index) => {
                        if (result.status === 'fulfilled' && result.value) requestCache.set(pending[index], result.value);
                    });
                    invitations.value = ids.map(id => requestCache.get(id)).filter(Boolean);
                }, fail));
            }
            if (route.query.create === '1') {
                showCreate.value = true;
                subject.value = subjects.value.find(item => item.id === route.query.subjectId) || null;
            }
            watchDetail();
        } catch (cause) {
            if (current === generation) error.value = message(cause);
        } finally {
            if (current === generation) loading.value = false;
        }
    });
});
onBeforeUnmount(() => {
    generation++;
    historyGeneration++;
    stopAuth?.();
    clearSubscriptions();
});
function openCreate() {
    operationId.value = uuid();
    createError.value = '';
    showCreate.value = true;
}
async function create() {
    if (busy.value || !subject.value) return;
    busy.value = true;
    createError.value = '';
    try {
        let email = studentEmail.value.trim().toLowerCase();
        if (email && !email.includes('@')) email += '@tec.mx';
        const result = await createAdvisoryRequest({
            operationId: operationId.value,
            subjectId: subject.value.id,
            topic: topic.value.trim(),
            ...(forAnother.value && isCoordi.value ? { studentEmail: email, campus: campus.value } : {})
        });
        showCreate.value = false;
        topic.value = '';
        operationId.value = uuid();
        await router.push({ name: 'solicitudAsesoria', params: { id: result.requestId } });
    } catch (cause) {
        createError.value = message(cause);
    } finally { busy.value = false; }
}
async function act(action) {
    if (busy.value) return;
    busy.value = true;
    detailError.value = '';
    try {
        await action();
        closeDialog.value = false;
    } catch (cause) {
        detailError.value = message(cause);
    } finally { busy.value = false; }
}
async function loadHistory() {
    if (historyLoading.value || !profile.value || tab.value === 'invitations') return;
    const current = ++historyGeneration;
    const currentTab = tab.value;
    historyLoading.value = true;
    try {
        const result = await getRequestHistory({
            ...(currentTab === 'campus' ? { campus: profile.value.campus } : { studentKey: studentKey.value }),
            cursor: historyCursor
        });
        if (tab.value !== currentTab || current !== historyGeneration) return;
        const ids = new Set(history.value.map(item => item.id));
        history.value.push(...result.items.filter(item => !ids.has(item.id)));
        historyCursor = result.cursor;
        hasMoreHistory.value = result.hasMore;
    } catch (cause) { if (current === historyGeneration) error.value = message(cause); }
    finally { if (current === historyGeneration) historyLoading.value = false; }
}
</script>

<template>
    <div class="requests-page">
        <header class="flex flex-wrap align-items-center justify-content-between gap-3 mb-4">
            <div>
                <h1 class="text-2xl mb-2">Solicitudes de asesoría</h1>
                <p class="text-color-secondary m-0">Encuentra a un MAE disponible y da seguimiento a tu asesoría.</p>
            </div>
            <Button label="Solicitar asesoría" icon="pi pi-plus" :disabled="loading || !profile" @click="openCreate" />
        </header>
        <p v-if="loading" role="status">Cargando solicitudes…</p>
        <Message v-if="error" severity="error" :closable="false">{{ error }}</Message>
        <div v-if="profile" class="request-columns">
            <section class="card">
                <div class="flex flex-wrap gap-2 mb-3" aria-label="Filtrar solicitudes">
                    <Button label="Mis solicitudes" :outlined="tab !== 'mine'" severity="secondary" @click="tab = 'mine'" />
                    <Button v-if="isMae" label="Avisos recibidos" :outlined="tab !== 'invitations'" severity="secondary" @click="tab = 'invitations'" />
                    <Button v-if="isCoordi" label="Mi campus" :outlined="tab !== 'campus'" severity="secondary" @click="tab = 'campus'" />
                </div>
                <p v-if="!currentRequests.length" class="text-color-secondary">No hay solicitudes en esta lista.</p>
                <ul class="request-list">
                    <li v-for="item in currentRequests" :key="item.id">
                        <router-link :to="{ name: 'solicitudAsesoria', params: { id: item.id } }" class="request-row" :class="{ selected: route.params.id === item.id }">
                            <strong>{{ item.subject?.name || 'Asesoría' }}</strong>
                            <span v-if="item.topic">{{ item.topic }}</span>
                            <small>{{ statusText(item) }} · {{ dateLabel(item.createdAt) }}</small>
                        </router-link>
                    </li>
                </ul>
                <template v-if="tab !== 'invitations'">
                    <h2 class="text-base mt-4">Historial</h2>
                    <ul class="request-list">
                        <li v-for="item in olderRequests" :key="item.id">
                            <router-link :to="{ name: 'solicitudAsesoria', params: { id: item.id } }" class="request-row">
                                <strong>{{ item.subject?.name || 'Asesoría' }}</strong>
                                <small>{{ statusText(item) }} · {{ dateLabel(item.createdAt) }}</small>
                            </router-link>
                        </li>
                    </ul>
                    <Button v-if="hasMoreHistory" label="Cargar anteriores" severity="secondary" text :loading="historyLoading" @click="loadHistory" />
                    <p v-else class="text-color-secondary text-sm">No hay más solicitudes.</p>
                </template>
            </section>
            <section class="card" aria-label="Detalle de solicitud">
                <p v-if="detailLoading" role="status">Cargando detalle…</p>
                <Message v-if="detailError" severity="error" :closable="false">{{ detailError }}</Message>
                <template v-if="selected">
                    <div class="flex justify-content-between align-items-start gap-2">
                        <h2 class="text-xl mt-0">{{ selected.subject?.name }}</h2>
                        <Tag :value="statusText(selected)" :severity="selected.status === 'registered' ? 'success' : 'info'" />
                    </div>
                    <p v-if="selected.topic">{{ selected.topic }}</p>
                    <p class="text-color-secondary text-sm">Campus {{ selected.campus }} · {{ dateLabel(selected.createdAt) }}</p>
                    <p v-if="canManage">Estudiante: {{ selected.studentName || selected.studentEmail }}</p>
                    <Message v-if="selected.status === 'open' && !selected.activeOfferCount" severity="info" :closable="false">
                        Aún no hay respuestas. Primero se avisa a los MAEs en turno con esta materia; si no hay coincidencias, o nadie se ofrece en cinco minutos, se avisa a todos los MAEs en turno del campus.
                    </Message>
                    <div v-if="selected.assignedMaeKey" class="assignment">
                        <strong>{{ selected.assignedMaeName || selected.assignedMaeKey }}</strong>
                        <p class="mb-0"><i class="pi pi-map-marker mr-2" aria-hidden="true"></i>{{ selected.assignedLocation }}</p>
                    </div>
                    <p v-if="selected.status === 'assigned'" class="text-color-secondary">La solicitud se verificará cuando el estudiante registre la asesoría.</p>
                    <router-link v-if="canRegister" :to="{ path: `/mae/${selected.assignedMaeKey}`, query: { requestId: selected.id } }">
                        <Button label="Registrar mi asesoría" icon="pi pi-check" class="my-3" />
                    </router-link>
                    <div v-if="canOffer" class="mt-4">
                        <h3 class="text-base">Ofrecer apoyo</h3>
                        <label for="offer-location" class="block mb-2">Mesa o ubicación</label>
                        <InputText id="offer-location" v-model="location" maxlength="200" class="w-full mb-2" placeholder="Ej. Biblioteca, piso 3, mesa 4" />
                        <div class="flex flex-wrap gap-2">
                            <Button :label="myOffer ? 'Actualizar mi ubicación' : 'Puedo apoyar'" :disabled="busy || !location.trim() || !hasActiveTurnInCampus" @click="act(() => offerAdvisoryHelp({ requestId: selected.id, location: location.trim() }))" />
                            <Button v-if="myOffer" label="Retirar mi oferta" severity="secondary" outlined :disabled="busy" @click="act(() => withdrawAdvisoryOffer({ requestId: selected.id }))" />
                        </div>
                        <small v-if="!hasActiveTurnInCampus" class="block text-color-secondary mt-2">Necesitas tener un turno vigente en este campus.</small>
                    </div>
                    <div v-if="selected.status === 'open' && activeOffers.length" class="mt-4">
                        <h3 class="text-base">{{ canManage ? 'MAEs que pueden apoyar' : 'Mi oferta de apoyo' }}</h3>
                        <ul class="request-list">
                            <li v-for="offer in activeOffers" :key="offer.id" class="offer-row">
                                <div><strong>{{ offer.name || offer.maeKey || offer.id }}</strong><p class="mb-0">{{ offer.location }}</p></div>
                                <Button v-if="canManage && selected.status === 'open'" label="Elegir" severity="secondary" :disabled="busy" @click="act(() => assignAdvisoryRequest({ requestId: selected.id, maeKey: offer.maeKey || offer.id }))" />
                            </li>
                        </ul>
                    </div>
                    <div v-if="canManage && !closed(selected)" class="flex flex-wrap gap-2 mt-4 pt-3 border-top-1 surface-border">
                        <Button v-if="selected.status === 'assigned'" label="Volver a buscar asesor" severity="secondary" outlined :disabled="busy" @click="act(() => unassignAdvisoryRequest({ requestId: selected.id }))" />
                        <Button label="Cerrar solicitud" severity="secondary" text :disabled="busy" @click="closeReason = 'not_held'; closeDialog = true" />
                    </div>
                </template>
                <p v-else-if="!detailLoading && !detailError" class="text-color-secondary">Selecciona una solicitud para consultar sus respuestas y seguimiento.</p>
            </section>
        </div>
        <Dialog v-model:visible="showCreate" header="Solicitar asesoría" modal :style="{ width: '32rem', maxWidth: '95vw' }" :closable="!busy">
            <form class="flex flex-column gap-3" @submit.prevent="create">
                <div v-if="isCoordi" class="flex align-items-center gap-2">
                    <Checkbox v-model="forAnother" inputId="another-student" binary :disabled="busy" />
                    <label for="another-student">Publicar por otro estudiante</label>
                </div>
                <template v-if="isCoordi && forAnother">
                    <label for="request-email">Matrícula o correo institucional del estudiante</label>
                    <InputText id="request-email" v-model="studentEmail" placeholder="A0…@tec.mx" :disabled="busy" required />
                    <small class="text-color-secondary">No necesita tener cuenta todavía. La solicitud se asociará cuando se registre con ese correo.</small>
                    <label for="request-campus">Campus donde solicita la asesoría</label>
                    <Dropdown v-model="campus" inputId="request-campus" :options="campuses" optionLabel="name" optionValue="id" filter :disabled="busy" placeholder="Selecciona el campus" />
                </template>
                <label for="request-subject">Materia</label>
                <Dropdown v-model="subject" inputId="request-subject" :options="subjects" optionLabel="name" filter :disabled="busy" placeholder="Selecciona la materia" />
                <label for="request-topic">Tema <span class="text-color-secondary">(opcional)</span></label>
                <Textarea id="request-topic" v-model="topic" rows="3" maxlength="500" :disabled="busy" />
                <Message v-if="createError" severity="error" :closable="false">{{ createError }}</Message>
                <Button type="submit" label="Publicar solicitud" :loading="busy" :disabled="!subject || (forAnother && isCoordi && (!studentEmail.trim() || !campus))" />
            </form>
        </Dialog>
        <Dialog v-model:visible="closeDialog" header="Cerrar solicitud" modal :style="{ width: '28rem', maxWidth: '95vw' }" :closable="!busy">
            <p>Indica qué ocurrió. Solo el registro del estudiante verifica la asesoría.</p>
            <div class="flex align-items-center gap-2 mb-3">
                <RadioButton v-model="closeReason" inputId="not-held" value="not_held" /><label for="not-held">No se realizó</label>
            </div>
            <div v-if="selected?.assignedMaeKey" class="flex align-items-center gap-2 mb-3">
                <RadioButton v-model="closeReason" inputId="missing-registration" value="missing_registration" /><label for="missing-registration">Se realizó, falta registro</label>
            </div>
            <Message v-if="detailError" severity="error" :closable="false">{{ detailError }}</Message>
            <Button label="Confirmar cierre" :loading="busy" @click="act(() => closeAdvisoryRequest({ requestId: selected.id, reason: closeReason }))" />
        </Dialog>
    </div>
</template>

<style scoped>
.request-columns { display: grid; grid-template-columns: minmax(17rem, 0.85fr) minmax(0, 1.4fr); gap: 1.25rem; align-items: start; }
.request-list { list-style: none; margin: 0; padding: 0; }
.request-row { display: flex; flex-direction: column; gap: 0.4rem; padding: 1rem 0.75rem; border-bottom: 1px solid var(--surface-border); color: var(--text-color); border-left: 3px solid transparent; overflow-wrap: anywhere; }
.request-row small { color: var(--text-color-secondary); }
.request-row:hover, .request-row.selected { background: var(--surface-hover); }
.request-row.selected { border-left-color: var(--primary-color); }
.offer-row { display: flex; align-items: center; justify-content: space-between; gap: 1rem; padding: 1rem 0; border-bottom: 1px solid var(--surface-border); }
.assignment { padding: 1rem; border: 1px solid var(--surface-border); border-radius: 6px; overflow-wrap: anywhere; }
@media (max-width: 900px) { .request-columns { grid-template-columns: 1fr; } }
</style>
