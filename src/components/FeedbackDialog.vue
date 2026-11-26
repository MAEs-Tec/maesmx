<script setup>
import { computed, reactive, ref, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useToast } from 'primevue/usetoast';
import { FEEDBACK_LIMITS, FEEDBACK_TYPES, submitFeedback } from '@/firebase/db/feedback';

const props = defineProps({ visible: { type: Boolean, default: false } });
const emit = defineEmits(['update:visible']);

const route = useRoute();
const toast = useToast();
const sending = ref(false);
const form = reactive({ type: 'sugerencia', title: '', body: '' });

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
});

const isBug = computed(() => form.type === 'fallo');
const canSend = computed(
    () =>
        !sending.value &&
        form.title.trim().length >= FEEDBACK_LIMITS.titleMin &&
        form.body.trim().length >= FEEDBACK_LIMITS.bodyMin
);

watch(
    () => props.visible,
    (open) => {
        if (open && !sending.value) {
            form.type = 'sugerencia';
            form.title = '';
            form.body = '';
        }
    }
);

async function send() {
    if (!canSend.value) return;
    sending.value = true;
    try {
        await submitFeedback({ type: form.type, title: form.title.trim(), body: form.body.trim(), page: route.path });
        toast.add({
            severity: 'success',
            summary: '¡Gracias!',
            detail: isBug.value ? 'Recibimos tu reporte. Lo vamos a revisar.' : 'Recibimos tu idea. La vamos a revisar.',
            life: 4000
        });
        dialogVisible.value = false;
    } catch (error) {
        toast.add({ severity: 'error', summary: 'No se pudo enviar', detail: error?.message || 'Intenta de nuevo más tarde.', life: 5000 });
    } finally {
        sending.value = false;
    }
}
</script>

<template>
    <Dialog v-model:visible="dialogVisible" modal header="Sugerencias y fallos" :closable="!sending" :style="{ width: '32rem' }" :breakpoints="{ '640px': '95vw' }">
        <div class="flex flex-column gap-3">
            <div class="flex flex-wrap gap-2" role="radiogroup" aria-label="Tipo de mensaje">
                <Button
                    v-for="option in FEEDBACK_TYPES"
                    :key="option.code"
                    :label="option.name"
                    :icon="option.icon"
                    :outlined="form.type !== option.code"
                    severity="secondary"
                    role="radio"
                    :aria-checked="form.type === option.code"
                    @click="form.type = option.code"
                />
            </div>

            <div class="flex flex-column gap-2">
                <label for="feedback-title" class="font-semibold">{{ isBug ? '¿Qué falla?' : '¿Cuál es tu idea?' }}</label>
                <InputText
                    id="feedback-title"
                    v-model="form.title"
                    :maxlength="FEEDBACK_LIMITS.titleMax"
                    :placeholder="isBug ? 'Ej. No carga la Maeteca en el celular' : 'Ej. Poder filtrar MAEs por materia'"
                    :disabled="sending"
                />
            </div>

            <div class="flex flex-column gap-2">
                <label for="feedback-body" class="font-semibold">{{ isBug ? 'Cuéntanos qué pasó' : 'Cuéntanos más' }}</label>
                <Textarea
                    id="feedback-body"
                    v-model="form.body"
                    rows="5"
                    autoResize
                    :maxlength="FEEDBACK_LIMITS.bodyMax"
                    :placeholder="isBug ? 'Qué hiciste, qué esperabas y qué pasó en cambio.' : '¿Qué te gustaría y para qué te ayudaría?'"
                    :disabled="sending"
                />
                <small class="text-color-secondary">
                    Se agrega la página en la que estás ({{ route.path }}) y tu navegador.
                </small>
            </div>

            <p class="feedback-note m-0">
                <i class="pi pi-info-circle" aria-hidden="true"></i>
                <span>Lo que escribas se publica en el GitHub del proyecto, que es público, sin tu nombre ni tu correo. No incluyas datos personales ni contraseñas.</span>
            </p>
        </div>

        <template #footer>
            <Button label="Cancelar" severity="secondary" text :disabled="sending" @click="dialogVisible = false" />
            <Button label="Enviar" icon="pi pi-send" :loading="sending" :disabled="!canSend" @click="send" />
        </template>
    </Dialog>
</template>

<style scoped>
.feedback-note {
    display: flex;
    gap: 0.5rem;
    align-items: flex-start;
    padding: 0.75rem;
    border: 1px solid var(--surface-border);
    border-radius: 8px;
    color: var(--text-color-secondary);
    font-size: 0.9rem;
    line-height: 1.4;
}

.feedback-note .pi {
    margin-top: 0.15rem;
}
</style>
