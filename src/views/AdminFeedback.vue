<script setup>
import { computed, onMounted, ref } from 'vue';
import { useToast } from 'primevue/usetoast';
import { FEEDBACK_STATUSES, FEEDBACK_TYPES, listFeedback, retryFeedbackIssue, updateFeedbackStatus } from '@/firebase/db/feedback';

const toast = useToast();
const items = ref([]);
const loading = ref(true);
const typeFilter = ref('all');
const statusFilter = ref('open');
const expanded = ref([]); // PrimeVue 3.30: expandedRows es un arreglo de filas

const typeOptions = [{ code: 'all', name: 'Todos' }, ...FEEDBACK_TYPES.map((t) => ({ code: t.code, name: t.code === 'fallo' ? 'Fallos' : 'Sugerencias' }))];
const statusOptions = [{ code: 'open', name: 'Pendientes' }, { code: 'all', name: 'Todos' }, ...FEEDBACK_STATUSES];

const statusMeta = (code) => FEEDBACK_STATUSES.find((s) => s.code === code) ?? FEEDBACK_STATUSES[0];
const typeName = (code) => (code === 'fallo' ? 'Fallo' : 'Sugerencia');

const filtered = computed(() =>
    items.value.filter((item) => {
        if (typeFilter.value !== 'all' && item.type !== typeFilter.value) return false;
        if (statusFilter.value === 'open') return ['nuevo', 'en_revision'].includes(item.status ?? 'nuevo');
        return statusFilter.value === 'all' || item.status === statusFilter.value;
    })
);

const pendingCount = computed(() => items.value.filter((i) => ['nuevo', 'en_revision'].includes(i.status ?? 'nuevo')).length);

function formatDate(value) {
    const date = value?.toDate?.();
    return date ? date.toLocaleString('es-MX', { dateStyle: 'medium', timeStyle: 'short' }) : '—';
}

async function load() {
    loading.value = true;
    try {
        items.value = await listFeedback();
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: error?.message || 'No se pudieron cargar las sugerencias.', life: 5000 });
    } finally {
        loading.value = false;
    }
}

const retrying = ref(null);

async function retry(item) {
    retrying.value = item.id;
    try {
        const { issueUrl, issueNumber } = await retryFeedbackIssue(item.id);
        Object.assign(item, { issueUrl, issueNumber, issueError: null });
        toast.add({ severity: 'success', summary: 'Issue abierto', detail: `Se abrió el issue #${issueNumber}.`, life: 4000 });
    } catch (error) {
        item.issueError = error?.message || item.issueError;
        toast.add({ severity: 'error', summary: 'No se pudo abrir el issue', detail: error?.message || 'Intenta de nuevo más tarde.', life: 6000 });
    } finally {
        retrying.value = null;
    }
}

async function changeStatus(item, status) {
    const previous = item.status;
    item.status = status;
    try {
        await updateFeedbackStatus(item.id, status);
    } catch (error) {
        item.status = previous;
        toast.add({ severity: 'error', summary: 'No se guardó', detail: error?.message || 'Intenta de nuevo.', life: 5000 });
    }
}

onMounted(load);
</script>

<template>
    <div class="sm:flex sm:align-items-center sm:justify-content-between mb-3 sm:mb-5">
        <div>
            <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Sugerencias</h1>
            <p class="text-color-secondary mt-2 mb-0">Ideas y fallos que mandan los usuarios desde el botón de la barra superior. {{ pendingCount }} pendientes.</p>
        </div>
        <Button label="Actualizar" icon="pi pi-refresh" severity="secondary" outlined class="w-full sm:w-auto mt-3 sm:mt-0" :loading="loading" @click="load" />
    </div>

    <div class="card mb-0">
        <div class="flex flex-wrap gap-2 mb-3" data-tour="sugerencias-filtros">
            <SelectButton v-model="typeFilter" :options="typeOptions" optionLabel="name" optionValue="code" :allowEmpty="false" aria-label="Filtrar por tipo" />
            <Dropdown v-model="statusFilter" :options="statusOptions" optionLabel="name" optionValue="code" aria-label="Filtrar por estado" class="w-full sm:w-12rem" />
        </div>

        <DataTable
            v-model:expandedRows="expanded"
            data-tour="sugerencias-tabla"
            :value="filtered"
            dataKey="id"
            :loading="loading"
            paginator
            :rows="25"
            responsiveLayout="stack"
            breakpoint="640px"
        >
            <template #empty>No hay mensajes con estos filtros.</template>
            <template #loading>Cargando…</template>
            <Column expander style="width: 3rem" />
            <Column header="Mensaje" style="min-width: 16rem">
                <template #body="{ data }">
                    <Tag :value="typeName(data.type)" :severity="data.type === 'fallo' ? 'danger' : 'info'" class="mb-1" />
                    <span class="block font-semibold">{{ data.title }}</span>
                    <small v-if="data.page" class="block text-color-secondary">{{ data.page }}</small>
                </template>
            </Column>
            <Column header="Quién" style="min-width: 9rem">
                <template #body="{ data }">
                    <span class="uppercase">{{ data.uid }}</span>
                    <small class="block text-color-secondary">{{ data.role }} · {{ formatDate(data.createdAt) }}</small>
                </template>
            </Column>
            <Column style="width: 8rem">
                <template #header><span data-tour="sugerencias-github">GitHub</span></template>
                <template #body="{ data }">
                    <span v-if="data.issueUrl" class="flex align-items-center gap-1">
                        <a :href="data.issueUrl" target="_blank" rel="noopener">#{{ data.issueNumber }}</a>
                        <i
                            v-if="data.issueSyncError"
                            class="pi pi-exclamation-circle text-orange-500"
                            v-tooltip.top="`El estado no se pasó a GitHub: ${data.issueSyncError}`"
                            aria-label="Estado sin sincronizar con GitHub"
                        ></i>
                    </span>
                    <span v-else-if="data.issueError" class="flex align-items-center gap-1">
                        <i class="pi pi-exclamation-circle text-orange-500" v-tooltip.top="data.issueError" aria-label="Sin issue"></i>
                        <Button
                            label="Reintentar"
                            text
                            size="small"
                            class="p-1"
                            :loading="retrying === data.id"
                            :disabled="!!retrying"
                            :aria-label="`Reintentar el issue de ${data.title}`"
                            @click="retry(data)"
                        />
                    </span>
                    <span v-else class="text-color-secondary">—</span>
                </template>
            </Column>
            <Column style="min-width: 10rem">
                <template #header><span data-tour="sugerencias-estado">Estado</span></template>
                <template #body="{ data }">
                    <Dropdown
                        :modelValue="data.status ?? 'nuevo'"
                        :options="FEEDBACK_STATUSES"
                        optionLabel="name"
                        optionValue="code"
                        class="w-full"
                        :aria-label="`Estado de ${data.title}`"
                        @update:modelValue="(value) => changeStatus(data, value)"
                    >
                        <template #value="{ value }">
                            <Tag :value="statusMeta(value).name" :severity="statusMeta(value).severity" />
                        </template>
                    </Dropdown>
                </template>
            </Column>
            <template #expansion="{ data }">
                <div class="p-3">
                    <p class="white-space-pre-line m-0 mb-3">{{ data.body }}</p>
                    <small class="block text-color-secondary">{{ data.name || data.email }} · {{ data.email }}</small>
                    <small v-if="data.userAgent" class="block text-color-secondary">{{ data.userAgent }}</small>
                </div>
            </template>
        </DataTable>
    </div>
</template>
