<script setup>
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import {
    parseVideoRows
} from '../../utils/maetecaImport.js'
import {
    addVideosBulk,
    VIDEO_CAREERS,
    AVAILABLE_TAG_OPTIONS
} from '../../firebase/db/maeteca'

const props = defineProps({
    visible: { type: Boolean, default: false },
    subjects: { type: Array, default: null },
    existingVideos: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:visible', 'uploaded'])

const toast = useToast()

const MAX_FILE_BYTES = 5 * 1024 * 1024

const fileInput = ref(null)
const fileName = ref('')
const result = ref(null)
const errorMessage = ref('')
const reading = ref(false)
const uploading = ref(false)
const buildingTemplate = ref(false)

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
})

const validCount = computed(() => result.value?.valid.length ?? 0)
const invalidCount = computed(() => result.value?.invalid.length ?? 0)

const previewRows = computed(() => {
    if (!result.value) return []
    const valid = result.value.valid.map((v) => ({
        rowNumber: v.rowNumber,
        titulo: v.data.Titulo,
        link: v.data.Video,
        errors: []
    }))
    const invalid = result.value.invalid.map((v) => ({
        rowNumber: v.rowNumber,
        titulo: v.raw?.titulo ?? '',
        link: v.raw?.link ?? '',
        errors: v.errors
    }))
    return [...valid, ...invalid].sort((a, b) => a.rowNumber - b.rowNumber)
})

const summary = computed(() => {
    const ready = validCount.value === 1 ? 'listo' : 'listos'
    return `${validCount.value} ${ready}, ${invalidCount.value} con errores`
})

const warnText = computed(() =>
    invalidCount.value === 1
        ? 'La fila con error se omitirá.'
        : `Las ${invalidCount.value} filas con error se omitirán.`
)

const uploadLabel = computed(() =>
    validCount.value === 1 ? 'Subir 1 video' : `Subir ${validCount.value} videos`
)

function resetState() {
    fileName.value = ''
    result.value = null
    errorMessage.value = ''
    reading.value = false
    uploading.value = false
}

watch(
    () => props.visible,
    (value) => {
        if (!value) resetState()
    }
)

// La plantilla se arma al momento con el catálogo actual de materias.
// ExcelJS se carga solo aquí porque es pesado; la lectura sigue con xlsx.
async function downloadTemplate() {
    if (buildingTemplate.value) return
    buildingTemplate.value = true
    try {
        const [{ default: ExcelJS }, { buildTemplateWorkbook }, { saveAs }] = await Promise.all([
            import('exceljs'),
            import('../../utils/maetecaTemplate.js'),
            import('file-saver')
        ])
        const workbook = buildTemplateWorkbook(ExcelJS, {
            subjects: props.subjects ?? [],
            careers: VIDEO_CAREERS,
            tagOptions: AVAILABLE_TAG_OPTIONS
        })
        const buffer = await workbook.xlsx.writeBuffer()
        saveAs(
            new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
            'plantilla-maeteca-videos.xlsx'
        )
    } catch (error) {
        console.error('Error generando la plantilla:', error)
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'No se pudo generar la plantilla.',
            life: 4000
        })
    } finally {
        buildingTemplate.value = false
    }
}

function openPicker() {
    fileInput.value?.click()
}

function close() {
    dialogVisible.value = false
}

async function onFileChange(event) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    fileName.value = file.name
    result.value = null
    errorMessage.value = ''

    if (!file.name.toLowerCase().endsWith('.xlsx')) {
        errorMessage.value = 'Solo se aceptan archivos .xlsx. Usa la plantilla.'
        return
    }
    if (file.size > MAX_FILE_BYTES) {
        errorMessage.value = 'El archivo pesa más de 5 MB.'
        return
    }

    reading.value = true
    try {
        const XLSX = await import('xlsx')
        const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' })
        const sheet = workbook.Sheets['Videos'] ?? workbook.Sheets[workbook.SheetNames[0]]
        if (!sheet) throw new Error('El archivo no tiene hojas.')
        const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' })
        result.value = parseVideoRows(rows, {
            subjects: props.subjects ?? [],
            careers: VIDEO_CAREERS,
            tagOptions: AVAILABLE_TAG_OPTIONS,
            existingVideos: props.existingVideos ?? []
        })
    } catch (error) {
        errorMessage.value = error?.message || 'No se pudo leer el archivo.'
    } finally {
        reading.value = false
    }
}

async function upload() {
    if (uploading.value || !validCount.value) return
    uploading.value = true
    try {
        const { created } = await addVideosBulk(result.value.valid.map((v) => v.data))
        toast.add({
            severity: 'success',
            summary: 'Videos subidos',
            detail: created === 1 ? 'Se subió 1 video.' : `Se subieron ${created} videos.`,
            life: 4000
        })
        emit('uploaded', created)
        close()
        resetState()
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'No se pudieron subir los videos.',
            life: 5000
        })
        if (error?.created > 0) {
            emit('uploaded', error.created)
            result.value = null
            fileName.value = ''
            errorMessage.value = 'Vuelve a elegir el archivo para ver qué falta.'
        }
    } finally {
        uploading.value = false
    }
}
</script>

<template>
    <Dialog
        v-model:visible="dialogVisible"
        modal
        :dismissableMask="!uploading"
        :closeOnEscape="!uploading"
        :closable="!uploading"
        class="bulk-upload-dialog"
        :style="{ width: '720px' }"
        :breakpoints="{ '768px': '95vw' }"
    >
        <template #header>
            <div class="dialog-header">
                <h2>Carga en masa de videos</h2>
            </div>
        </template>

        <div class="dialog-content">
            <div class="intro">
                <p class="intro-text">
                    Llena la plantilla con un video por fila y súbela aquí. Máximo 500 videos por archivo.
                </p>
                <button type="button" class="template-link" :disabled="buildingTemplate" @click="downloadTemplate">
                    <i class="pi pi-download"></i>
                    <span>Descargar plantilla</span>
                </button>
            </div>

            <div class="file-picker">
                <input
                    ref="fileInput"
                    type="file"
                    accept=".xlsx"
                    class="hidden"
                    @change="onFileChange"
                />
                <Button
                    label="Elegir archivo Excel"
                    icon="pi pi-file-excel"
                    severity="secondary"
                    :loading="reading"
                    :disabled="uploading"
                    @click="openPicker"
                />
                <span v-if="fileName" class="file-name" :title="fileName">{{ fileName }}</span>
            </div>

            <Message v-if="errorMessage" severity="error" :closable="false">
                {{ errorMessage }}
            </Message>

            <template v-if="result">
                <p class="summary">{{ summary }}</p>
                <Message v-if="invalidCount > 0" severity="warn" :closable="false">
                    {{ warnText }}
                </Message>

                <DataTable
                    :value="previewRows"
                    size="small"
                    scrollable
                    scrollHeight="320px"
                    :paginator="previewRows.length > 10"
                    :rows="10"
                    dataKey="rowNumber"
                >
                    <Column field="rowNumber" header="Fila" style="width: 4rem" />
                    <Column field="titulo" header="Nombre" style="min-width: 10rem" />
                    <Column header="Link" style="min-width: 10rem; max-width: 14rem">
                        <template #body="{ data }">
                            <span class="link-cell" :title="data.link">{{ data.link }}</span>
                        </template>
                    </Column>
                    <Column header="Estado" style="min-width: 10rem">
                        <template #body="{ data }">
                            <Tag v-if="!data.errors.length" severity="success" value="Listo" />
                            <ul v-else class="error-list">
                                <li v-for="(err, i) in data.errors" :key="i" class="text-red-600">
                                    {{ err }}
                                </li>
                            </ul>
                        </template>
                    </Column>
                </DataTable>
            </template>
        </div>

        <template #footer>
            <div class="flex justify-content-end gap-2">
                <Button
                    label="Cancelar"
                    severity="secondary"
                    :disabled="uploading"
                    @click="close"
                />
                <Button
                    :label="uploadLabel"
                    :loading="uploading"
                    :disabled="!validCount || uploading || reading"
                    @click="upload"
                />
            </div>
        </template>
    </Dialog>
</template>

<style scoped>
:deep(.bulk-upload-dialog .p-dialog-header) {
    background: var(--surface-card);
    border-top-left-radius: 26px;
    border-top-right-radius: 26px;
    padding: 1.75rem 2rem 1rem;
}

:deep(.bulk-upload-dialog .p-dialog-content) {
    background: var(--surface-card);
    padding: 0 2rem 1.5rem;
}

:deep(.bulk-upload-dialog .p-dialog-footer) {
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

.intro {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
}

.intro-text {
    margin: 0;
}

.template-link {
    display: inline-flex;
    align-items: center;
    gap: 0.5rem;
    width: fit-content;
    padding: 0;
    border: 0;
    background: none;
    font: inherit;
    cursor: pointer;
    color: var(--primary-color);
    text-decoration: none;
    font-weight: 600;
}

.template-link:hover {
    text-decoration: underline;
}

.file-picker {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    min-width: 0;
}

.hidden {
    display: none;
}

.file-name {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
    color: var(--text-color-secondary);
}

.summary {
    margin: 0;
    font-weight: 600;
}

.link-cell {
    display: block;
    max-width: 14rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}

.error-list {
    margin: 0;
    padding-left: 1rem;
}
</style>
