<script setup>
import { computed, nextTick, reactive, ref, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import {
    extractYoutubeId,
    getKahootEmbedUrl,
    validatePdfFile,
    resolveSubjectValue,
    GENERAL_SUBJECT,
    MAX_TITLE_LENGTH,
    MAX_TAG_LENGTH,
    normalizeKey,
    cleanTag,
    resolveTagValue
} from '@/utils/maetecaImport.js'
import {
    RESOURCE_TYPES,
    getResourceType,
    addVideoToMaeteca,
    addPdfToMaeteca,
    addKahootToMaeteca,
    updateMaetecaResource,
    VIDEO_CAREERS,
    AVAILABLE_TAG_OPTIONS
} from '@/firebase/db/maeteca'

const props = defineProps({
    visible: { type: Boolean, default: false },
    resource: { type: Object, default: null },
    subjects: { type: Array, default: null },
    careers: { type: Array, default: () => VIDEO_CAREERS },
    tagOptions: { type: Array, default: () => AVAILABLE_TAG_OPTIONS }
})
const emit = defineEmits(['update:visible', 'saved'])

const toast = useToast()
const saving = ref(false)
const fileInput = ref(null)
const fileError = ref('')
const filteredSubjects = ref([])
const tagQuery = ref('')
const tagSuggestions = ref([])

const form = reactive({
    type: 'video',
    link: '',
    title: '',
    subject: GENERAL_SUBJECT,
    career: 'all',
    tags: [],
    file: null
})

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
})

const isEdit = computed(() => !!props.resource)
const isVideo = computed(() => form.type === 'video')
const isKahoot = computed(() => form.type === 'kahoot')
const subjectOptions = computed(() => [GENERAL_SUBJECT, ...(props.subjects ?? [])])
// Si el recurso trae una carrera que ya no está en el catálogo, se conserva como opción.
const careerOptions = computed(() => {
    const list = props.careers?.length ? props.careers : VIDEO_CAREERS
    const current = form.career
    if (!current || list.some((c) => c.code === current)) return list
    return [...list, { name: String(current).toUpperCase(), code: current }]
})
const previewId = computed(() => extractYoutubeId(form.link))
const showLinkError = computed(() => form.link.trim() !== '' && !previewId.value)
const kahootEmbedUrl = computed(() => getKahootEmbedUrl(form.link))
const showKahootError = computed(() => form.link.trim() !== '' && !kahootEmbedUrl.value)

const fileSizeLabel = computed(() =>
    form.file ? `${(form.file.size / (1024 * 1024)).toFixed(1)} MB` : ''
)

const isSubmitDisabled = computed(() => {
    if (saving.value) return true
    if (!form.title.trim()) return true
    if (isVideo.value && !previewId.value) return true
    if (isKahoot.value && !kahootEmbedUrl.value) return true
    if (!isEdit.value && form.type === 'pdf' && !form.file) return true
    return false
})

const selectedTagItems = computed(() =>
    form.tags.map((value) => {
        const option = props.tagOptions.find((o) => o.value === value)
        return { value, label: option ? option.label : `#${value}` }
    })
)

function resetForm() {
    const resource = props.resource
    const options = subjectOptions.value
    const materia = resource?.Materia

    let subject = GENERAL_SUBJECT
    if (materia && materia !== 'general') {
        subject = options.find((s) => s.id === materia) ?? { id: materia, name: materia }
    }

    form.type = resource ? getResourceType(resource) : 'video'
    form.link = resource?.Tipo === 'kahoot' ? (resource?.Kahoot ?? '') : (resource?.Video ?? '')
    form.title = resource?.Titulo ?? ''
    form.subject = subject
    form.career = resource?.Carrera ?? 'all'
    form.tags = [...(resource?.Relacionado ?? [])]
    form.file = null
    tagQuery.value = ''
    fileError.value = ''
    if (fileInput.value) fileInput.value.value = ''
}

watch(
    () => props.visible,
    (open) => {
        if (open) resetForm()
    },
    { immediate: true }
)

watch(
    () => form.type,
    () => {
        fileError.value = ''
        if (!isEdit.value) form.link = ''
    }
)

function filterSubjects(event) {
    const query = normalizeKey(event.query ?? '')
    const all = subjectOptions.value
    filteredSubjects.value = !query
        ? [...all]
        : all.filter(
              (s) => normalizeKey(s.name).includes(query) || normalizeKey(s.id).includes(query)
          )
}

function openFilePicker() {
    fileInput.value?.click()
}

function onFileChange(event) {
    const input = event.target
    const file = input.files?.[0] ?? null
    if (file) {
        const error = validatePdfFile(file)
        fileError.value = error || ''
        form.file = error ? null : file
    }
    input.value = ''
}

function removeTag(value) {
    form.tags = form.tags.filter((t) => t !== value)
}

const hasTag = (value) => form.tags.some((t) => normalizeKey(t) === normalizeKey(value))

// Sugerencias: etiquetas existentes que coinciden y, si lo escrito no existe, la opción de crearla.
function filterTags(event) {
    const typed = cleanTag(event.query ?? '')
    const query = normalizeKey(typed)
    const matches = props.tagOptions
        .filter((o) => !hasTag(o.value) && (!query || normalizeKey(o.value).includes(query)))
        .slice(0, 20)
        .map((o) => ({ value: o.value, label: o.label || `#${o.value}`, isNew: false }))
    const exact = props.tagOptions.some((o) => normalizeKey(o.value) === query)
    const canCreate = typed && !exact && !hasTag(typed) && typed.length <= MAX_TAG_LENGTH
    // Las existentes van primero para que Enter elija la coincidencia y no cree una parecida.
    tagSuggestions.value = canCreate
        ? [...matches, { value: typed, label: `Crear #${typed}`, isNew: true }]
        : matches
}

function onTagSelect(event) {
    const value = resolveTagValue(event.value?.value ?? event.value, props.tagOptions)
    if (value && !hasTag(value)) form.tags = [...form.tags, value]
    nextTick(() => {
        tagQuery.value = ''
    })
}

function resolveSubject() {
    const subject = form.subject
    if (!subject) return 'general'
    if (typeof subject === 'object' && subject.id) return subject.id
    if (typeof subject === 'string') {
        if (!subject.trim()) return 'general'
        return resolveSubjectValue(subject, props.subjects ?? [])
    }
    return 'general'
}

async function save() {
    if (isSubmitDisabled.value) return

    const Materia = resolveSubject()
    if (Materia === null) {
        toast.add({
            severity: 'warn',
            summary: 'Materia no válida',
            detail: 'Elige una materia de la lista.',
            life: 4000
        })
        return
    }

    const base = {
        Titulo: form.title.trim(),
        Materia,
        Carrera: form.career ?? 'all',
        Relacionado: [...form.tags]
    }

    saving.value = true
    try {
        if (isEdit.value) {
            await updateMaetecaResource(props.resource, {
                ...base,
                ...(isVideo.value ? { Video: form.link.trim() } : {}),
                ...(isKahoot.value ? { Kahoot: form.link.trim() } : {})
            })
            emit('saved', { id: props.resource.id, action: 'updated' })
            toast.add({
                severity: 'success',
                summary: 'Cambios guardados',
                detail: 'El recurso se actualizó.',
                life: 3000
            })
        } else if (isVideo.value) {
            const created = await addVideoToMaeteca({
                Video: form.link.trim(),
                ...base,
                Informacion: ''
            })
            emit('saved', { id: created.id, action: 'created' })
            toast.add({
                severity: 'success',
                summary: 'Recurso agregado',
                detail: 'El video se agregó a la Maeteca.',
                life: 3000
            })
        } else if (isKahoot.value) {
            const { id } = await addKahootToMaeteca({ Kahoot: form.link.trim(), ...base, Informacion: '' })
            emit('saved', { id, action: 'created' })
            toast.add({
                severity: 'success',
                summary: 'Recurso agregado',
                detail: 'El kahoot se agregó a la Maeteca.',
                life: 3000
            })
        } else {
            const { id } = await addPdfToMaeteca({ file: form.file, ...base, Informacion: '' })
            emit('saved', { id, action: 'created' })
            toast.add({
                severity: 'success',
                summary: 'Recurso agregado',
                detail: 'El PDF se agregó a la Maeteca.',
                life: 3000
            })
        }
        dialogVisible.value = false
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'No se pudo guardar el recurso.',
            life: 5000
        })
    } finally {
        saving.value = false
    }
}
</script>

<template>
    <Dialog
        v-model:visible="dialogVisible"
        modal
        :dismissableMask="!saving"
        :closeOnEscape="!saving"
        :closable="!saving"
        class="add-video-dialog md:w-4"
    >
        <template #header>
            <div class="dialog-header">
                <h2>{{ isEdit ? 'Editar recurso' : 'Agregar recurso' }}</h2>
            </div>
        </template>

        <div class="dialog-content">
            <div class="field-group">
                <label for="resource-type">Tipo de recurso</label>
                <Dropdown
                    inputId="resource-type"
                    v-model="form.type"
                    :options="RESOURCE_TYPES"
                    optionLabel="name"
                    optionValue="code"
                    :disabled="isEdit || saving"
                />
            </div>

            <div v-if="isVideo" class="field-group">
                <label for="resource-link">Link</label>
                <div class="input-with-icon">
                    <i
                        class="pi pi-info-circle"
                        v-tooltip.top="'Pega un link de YouTube: youtube.com/watch?v=…, youtu.be/… o youtube.com/shorts/…'"
                    ></i>
                    <InputText
                        id="resource-link"
                        v-model="form.link"
                        class="w-full"
                        placeholder="youtube.com/watch?v=…"
                    />
                </div>
                <div v-if="previewId" class="link-preview">
                    <iframe
                        :src="`https://www.youtube.com/embed/${previewId}`"
                        title="Vista previa del video"
                        allowfullscreen
                    ></iframe>
                </div>
                <small v-else-if="showLinkError" class="text-red-600">Solo se permiten links de YouTube.</small>
            </div>

            <div v-else-if="isKahoot" class="field-group">
                <label for="resource-kahoot">Link del kahoot</label>
                <div class="input-with-icon">
                    <i
                        class="pi pi-info-circle"
                        v-tooltip.top="'Pega el link del kahoot (create.kahoot.it/details/…) o el código de inserción. Debe ser público o no listado.'"
                    ></i>
                    <InputText
                        id="resource-kahoot"
                        v-model="form.link"
                        class="w-full"
                        placeholder="create.kahoot.it/details/…"
                    />
                </div>
                <div v-if="kahootEmbedUrl" class="link-preview">
                    <iframe :src="kahootEmbedUrl" title="Vista previa del kahoot" allowfullscreen></iframe>
                </div>
                <small v-else-if="showKahootError" class="text-red-600">
                    No se encontró el ID del kahoot. Los links de juego con PIN no se pueden insertar.
                </small>
                <small v-if="kahootEmbedUrl" class="file-note">
                    Si la vista previa sale en blanco, el kahoot es privado: cámbialo a público o no listado en Kahoot.
                </small>
            </div>

            <div v-else-if="!isEdit" class="field-group">
                <label for="resource-file">Archivo PDF</label>
                <input
                    id="resource-file"
                    ref="fileInput"
                    type="file"
                    accept="application/pdf,.pdf"
                    class="hidden"
                    @change="onFileChange"
                />
                <div class="file-row">
                    <Button
                        label="Elegir PDF"
                        icon="pi pi-file-pdf"
                        severity="secondary"
                        :disabled="saving"
                        @click="openFilePicker"
                    />
                    <span v-if="form.file" class="file-name">
                        {{ form.file.name }} ({{ fileSizeLabel }})
                    </span>
                </div>
                <small v-if="fileError" class="text-red-600">{{ fileError }}</small>
            </div>

            <div v-else class="field-group">
                <span class="file-name">Archivo: {{ resource.ArchivoNombre || 'PDF' }}</span>
                <small class="file-note">
                    El archivo no se puede cambiar. Para reemplazarlo, elimina el recurso y súbelo de nuevo.
                </small>
            </div>

            <div class="field-group">
                <label for="resource-title">Nombre del recurso</label>
                <InputText
                    id="resource-title"
                    v-model="form.title"
                    :maxlength="MAX_TITLE_LENGTH"
                    class="w-full"
                    placeholder="¿Cómo usar?"
                />
            </div>

            <div class="field-row">
                <div class="field-group">
                    <label for="resource-subject">Materia</label>
                    <AutoComplete
                        inputId="resource-subject"
                        v-model="form.subject"
                        :suggestions="filteredSubjects"
                        @complete="filterSubjects"
                        field="name"
                        dropdown
                        forceSelection
                        placeholder="General"
                    />
                </div>
                <div class="field-group">
                    <label for="resource-career">Carrera</label>
                    <Dropdown
                        inputId="resource-career"
                        v-model="form.career"
                        :options="careerOptions"
                        optionLabel="name"
                        optionValue="code"
                        filter
                        :filterFields="['name', 'fullName']"
                        filterPlaceholder="Buscar carrera"
                        placeholder="Todas"
                    >
                        <template #option="{ option }">
                            <span>{{ option.name }}</span>
                            <small v-if="option.fullName && option.fullName !== option.name" class="career-full-name">
                                {{ option.fullName }}
                            </small>
                        </template>
                    </Dropdown>
                </div>
            </div>

            <div class="field-group">
                <label for="resource-tags">Etiquetas</label>
                <div v-if="selectedTagItems.length" class="tag-collection">
                    <span v-for="tag in selectedTagItems" :key="tag.value" class="tag-pill">
                        {{ tag.label }}
                        <button type="button" aria-label="Eliminar etiqueta" @click="removeTag(tag.value)">
                            <i class="pi pi-times"></i>
                        </button>
                    </span>
                </div>
                <AutoComplete
                    inputId="resource-tags"
                    v-model="tagQuery"
                    :suggestions="tagSuggestions"
                    optionLabel="label"
                    :delay="100"
                    autoOptionFocus
                    completeOnFocus
                    class="w-full tag-autocomplete"
                    placeholder="Busca o escribe una etiqueta nueva"
                    @complete="filterTags"
                    @item-select="onTagSelect"
                >
                    <template #option="{ option }">
                        <span :class="{ 'tag-option--new': option.isNew }">{{ option.label }}</span>
                    </template>
                </AutoComplete>
                <small class="file-note">Elige una de la lista o escribe una nueva y presiona Enter.</small>
            </div>
        </div>

        <template #footer>
            <div class="flex justify-content-end gap-2">
                <Button label="Cancelar" severity="secondary" :disabled="saving" @click="dialogVisible = false" />
                <Button
                    :label="isEdit ? 'Guardar' : 'Agregar'"
                    :loading="saving"
                    :disabled="isSubmitDisabled"
                    @click="save"
                />
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
:deep(.add-video-dialog) {
    width: 420px;
    max-width: 95vw;
}

:deep(.add-video-dialog .p-dialog-header) {
    background: var(--surface-card);
    border-top-left-radius: 26px;
    border-top-right-radius: 26px;
    padding: 1.75rem 2rem 1rem;
}

:deep(.add-video-dialog .p-dialog-content) {
    background: var(--surface-card);
    padding: 0 2rem 1.5rem;
}

:deep(.add-video-dialog .p-dialog-footer) {
    background: var(--surface-card);
    border-bottom-left-radius: 26px;
    border-bottom-right-radius: 26px;
    padding: 0 2rem 2rem;
}

.dialog-header h2 {
    font-size: 1.75rem;
    font-weight: 700;
    color: #2d2d30;
    margin: 0;
}

.dialog-content {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 1rem;
}

.field-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.field-group label {
    font-weight: 600;
    color: var(--text-color, #3b3b3e);
    font-size: 1rem;
}

.field-row {
    display: flex;
    gap: 1rem;
}

.field-row .field-group {
    flex: 1;
}

.input-with-icon {
    position: relative;
    display: flex;
    align-items: center;
}

.input-with-icon .pi {
    position: absolute;
    left: 1rem;
    color: #637292;
    font-size: 1.15rem;
}

.input-with-icon .p-inputtext {
    padding-left: 2.75rem;
    height: 3.25rem;
    border-radius: 18px;
    border: 2px solid var(--surface-border, #d0d7eb);
    background: var(--surface-card);
}

.field-group .p-inputtext {
    height: 3.25rem;
    border-radius: 18px;
    border: 2px solid var(--surface-border, #d0d7eb);
    background: var(--surface-card);
}

.field-group :deep(.p-dropdown) {
    height: 3.25rem;
    border-radius: 18px;
    border: 2px solid var(--surface-border, #d0d7eb);
    background: var(--surface-card);
}

/* Estilo del AutoComplete para que coincida con los otros campos y la flecha quede dentro sin fondo azul */
.field-group :deep(.p-autocomplete) {
    width: 100%;
    position: relative;
}
.field-group :deep(.p-autocomplete .p-inputtext) {
    height: 3.25rem;
    background: var(--surface-card);
    color: var(--text-color, #3b3b3e);
    border: 2px solid var(--surface-border, #d0d7eb);
    border-radius: 18px;
    padding-right: 2.75rem; /* espacio para la flecha dentro del campo */
}
.field-group :deep(.p-autocomplete .p-autocomplete-dropdown) {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: transparent !important; /* sin fondo azul */
    border: none !important;
    box-shadow: none !important;
    color: #637292;
    width: 2.25rem;
    height: 2.25rem;
}
.field-group :deep(.p-autocomplete .p-autocomplete-dropdown:hover),
.field-group :deep(.p-autocomplete .p-autocomplete-dropdown:focus) {
    background: transparent !important;
    box-shadow: none !important;
}

.tag-collection {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}

.tag-pill {
    background: #4466A7;
    color: #fff;
    border-radius: 999px;
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 0.9rem;
    font-weight: 600;
    font-size: 0.95rem;
    box-shadow: 0 2px 6px rgba(0, 0, 0, 0.15);
}

.tag-pill button {
    background: transparent;
    border: none;
    color: inherit;
    cursor: pointer;
    padding: 0;
    display: flex;
    align-items: center;
}

.tag-autocomplete :deep(.p-autocomplete-input) {
    width: 100%;
}

.tag-option--new {
    font-weight: 600;
}

.career-full-name {
    display: block;
    color: var(--text-color-secondary);
    white-space: normal;
}

.link-preview {
    position: relative;
    width: 100%;
    padding-top: 56.25%;
    border-radius: 16px;
    overflow: hidden;
}

.link-preview iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
}

.file-row {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    flex-wrap: wrap;
}

.file-name {
    color: var(--text-color, #3b3b3e);
    font-size: 0.95rem;
    overflow-wrap: anywhere;
}

.file-note {
    color: var(--text-color-secondary);
}

@media (max-width: 640px) {
    .field-row {
        flex-direction: column;
    }

    :deep(.add-video-dialog) {
        width: 100%;
    }
}
</style>
