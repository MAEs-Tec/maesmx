<script setup>
import { computed } from 'vue'

const props = defineProps({
    url: { type: String, required: true },
    title: { type: String, default: '' }
})

// Solo http(s): el campo viene de Firestore y no debe llegar un esquema como javascript: al iframe.
const safeUrl = computed(() => (/^https?:\/\//i.test(props.url) ? props.url : null))
</script>

<template>
    <p v-if="!safeUrl" class="pdf-viewer__fallback">El archivo de este recurso no es válido.</p>
    <div v-else class="pdf-viewer">
        <div class="pdf-viewer__header">
            <span class="pdf-viewer__title">
                <i class="pi pi-file-pdf"></i>
                <span class="pdf-viewer__title-text">{{ title || 'Documento PDF' }}</span>
            </span>
            <a :href="safeUrl" target="_blank" rel="noopener noreferrer" class="p-button p-button-sm p-button-outlined">
                <i class="pi pi-external-link mr-2"></i>
                <span>Abrir en otra pestaña</span>
            </a>
        </div>
        <iframe :key="safeUrl" :src="safeUrl" :title="`PDF: ${title || 'documento'}`" class="pdf-viewer__frame"></iframe>
        <p class="pdf-viewer__fallback">
            ¿No ves el PDF?
            <a :href="safeUrl" target="_blank" rel="noopener noreferrer">Ábrelo en otra pestaña</a>.
        </p>
    </div>
</template>

<style scoped>
.pdf-viewer {
    border: 2px solid var(--surface-border);
    border-radius: 20px;
    background: var(--surface-card);
    overflow: hidden;
}

.pdf-viewer__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.5rem 1rem;
    border-bottom: 1px solid var(--surface-border);
}

.pdf-viewer__title {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-width: 0;
    font-weight: 600;
    color: var(--text-color);
}

.pdf-viewer__title-text {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.pdf-viewer__frame {
    display: block;
    width: 100%;
    height: 480px;
    border: 0;
}

.pdf-viewer__fallback {
    margin: 0;
    padding: 0.5rem 1rem;
    font-size: 0.85rem;
    color: var(--text-color-secondary);
}

@media (max-width: 768px) {
    .pdf-viewer__frame {
        height: 60vh;
    }
}
</style>
