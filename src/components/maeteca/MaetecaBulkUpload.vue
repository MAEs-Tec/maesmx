<script setup>
import { ref, computed, watch } from 'vue'
import { useToast } from 'primevue/usetoast'
import { parseVideoRows, MAX_IMPORT_ROWS } from '../../utils/maetecaImport.js'
import { saveVideosBulk } from '../../firebase/db/maeteca'

const props = defineProps({
    visible: { type: Boolean, default: false },
    subjects: { type: Array, default: null },
    careers: { type: Array, default: () => [] },
    tagOptions: { type: Array, default: () => [] },
    existingVideos: { type: Array, default: () => [] }
})

const emit = defineEmits(['update:visible', 'uploaded'])

const toast = useToast()

const MAX_FILE_BYTES = 5 * 1024 * 1024
const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

const fileInput = ref(null)
const fileName = ref('')
const result = ref(null)
const errorMessage = ref('')
const reading = ref(false)
const uploading = ref(false)
const buildingTemplate = ref(false)
const exporting = ref(false)

const dialogVisible = computed({
    get: () => props.visible,
    set: (value) => emit('update:visible', value)
})

const validCount = computed(() => result.value?.valid.length ?? 0)
const updateCount = computed(() => result.value?.updates.length ?? 0)
const unchangedCount = computed(() => result.value?.unchanged.length ?? 0)
const invalidCount = computed(() => result.value?.invalid.length ?? 0)
const writeCount = computed(() => validCount.value + updateCount.value)
const exportableCount = computed(() =>
    (props.existingVideos ?? []).filter((v) => v && v.Tipo !== 'pdf' && v.Video).length
)

const previewRows = computed(() => {
    if (!result.value) return []
    const row = (rowNumber, titulo, link, status, errors = []) => ({ rowNumber, titulo, link, status, errors })
    return [
        ...result.value.valid.map((v) => row(v.rowNumber, v.data.Titulo, v.data.Video, 'new')),
        ...result.value.updates.map((v) => row(v.rowNumber, v.data.Titulo, v.link, 'update')),
        ...result.value.unchanged.map((v) => row(v.rowNumber, v.titulo, v.link, 'same')),
        ...result.value.invalid.map((v) => row(v.rowNumber, v.raw?.titulo ?? '', v.raw?.link ?? '', 'error', v.errors))
    ].sort((a, b) => a.rowNumber - b.rowNumber)
})

const summary = computed(() => {
    const parts = [`${validCount.value} ${validCount.value === 1 ? 'nuevo' : 'nuevos'}`]
    if (updateCount.value) parts.push(`${updateCount.value} por actualizar`)
    if (unchangedCount.value) parts.push(`${unchangedCount.value} sin cambios`)
    parts.push(`${invalidCount.value} con errores`)
    return parts.join(', ')
})

const newTagsText = computed(() => (result.value?.newTags ?? []).map((t) => `#${t}`).join(', '))

const warnText = computed(() =>
    invalidCount.value === 1
        ? 'La fila con error se omitirá.'
        : `Las ${invalidCount.value} filas con error se omitirán.`
)

const uploadLabel = computed(() => {
    if (!updateCount.value) return validCount.value === 1 ? 'Subir 1 video' : `Subir ${validCount.value} videos`
    return writeCount.value === 1 ? 'Guardar 1 video' : `Guardar ${writeCount.value} videos`
})

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

// El archivo se arma al momento con los catálogos actuales. ExcelJS se carga solo
// aquí porque es pesado; la lectura sigue con xlsx. Con `videos`, sale lleno.
async function downloadWorkbook({ videos, filename }) {
    const [{ default: ExcelJS }, { buildTemplateWorkbook }, { saveAs }] = await Promise.all([
        import('exceljs'),
        import('../../utils/maetecaTemplate.js'),
        import('file-saver')
    ])
    const workbook = buildTemplateWorkbook(ExcelJS, {
        subjects: props.subjects ?? [],
        careers: props.careers,
        tagOptions: props.tagOptions,
        videos
    })
    const buffer = await workbook.xlsx.writeBuffer()
    saveAs(new Blob([buffer], { type: XLSX_TYPE }), filename)
}

async function downloadTemplate() {
    if (buildingTemplate.value) return
    buildingTemplate.value = true
    try {
        await downloadWorkbook({ filename: 'plantilla-maeteca-videos.xlsx' })
    } catch (error) {
        console.error('Error generando la plantilla:', error)
        toast.add({ severity: 'error', summary: 'Error', detail: 'No se pudo generar la plantilla.', life: 4000 })
    } finally {
        buildingTemplate.value = false
    }
}

async function downloadCurrentVideos() {
    if (exporting.value) return
    exporting.value = true
    try {
        const date = new Date().toISOString().slice(0, 10)
        await downloadWorkbook({ videos: props.existingVideos ?? [], filename: `maeteca-videos-${date}.xlsx` })
        if (exportableCount.value > MAX_IMPORT_ROWS) {
            toast.add({
                severity: 'warn',
                summary: 'Archivo grande',
                detail: `Hay ${exportableCount.value} videos. Para volver a subirlo, divídelo en archivos de máximo ${MAX_IMPORT_ROWS} filas.`,
                life: 6000
            })
        }
    } catch (error) {
        console.error('Error exportando los videos:', error)
        toast.add({ severity: 'error', summary: 'Error', detail: 'No se pudo generar el Excel de los videos.', life: 4000 })
    } finally {
        exporting.value = false
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
            careers: props.careers,
            tagOptions: props.tagOptions,
            existingVideos: props.existingVideos ?? []
        })
    } catch (error) {
        errorMessage.value = error?.message || 'No se pudo leer el archivo.'
    } finally {
        reading.value = false
    }
}

function savedDetail(created, updated) {
    const parts = []
    if (created) parts.push(created === 1 ? 'se subió 1 video' : `se subieron ${created} videos`)
    if (updated) parts.push(updated === 1 ? 'se actualizó 1' : `se actualizaron ${updated}`)
    const text = parts.join(' y ')
    return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`
}

async function upload() {
    if (uploading.value || !writeCount.value) return
    uploading.value = true
    try {
        const { created, updated } = await saveVideosBulk({
            creates: result.value.valid.map((v) => v.data),
            updates: result.value.updates.map((v) => ({ id: v.id, data: v.data }))
        })
        toast.add({
            severity: 'success',
            summary: 'Videos guardados',
            detail: savedDetail(created, updated),
            life: 4000
        })
        emit('uploaded', created + updated)
        close()
        resetState()
    } catch (error) {
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: error?.message || 'No se pudieron guardar los videos.',
            life: 5000
        })
        const saved = (error?.created ?? 0) + (error?.updated ?? 0)
        if (saved > 0) {
            emit('uploaded', saved)
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
                    Para editar los que ya están, descarga los videos actuales, cambia el Excel y vuelve a subirlo.
                </p>
                <div class="download-links">
                    <button type="button" class="template-link" :disabled="buildingTemplate" @click="downloadTemplate">
                        <i class="pi pi-download"></i>
                        <span>Descargar plantilla</span>
                    </button>
                    <button
                        type="button"
                        class="template-link"
                        :disabled="exporting || !exportableCount"
                        @click="downloadCurrentVideos"
                    >
                        <i :class="exporting ? 'pi pi-spin pi-spinner' : 'pi pi-file-excel'"></i>
                        <span>Descargar videos actuales ({{ exportableCount }})</span>
                    </button>
                </div>
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
                <p v-if="newTagsText" class="new-tags">Etiquetas nuevas: {{ newTagsText }}</p>

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
                            <Tag v-if="data.status === 'new'" severity="success" value="Nuevo" />
                            <Tag v-else-if="data.status === 'update'" severity="info" value="Se actualiza" />
                            <span v-else-if="data.status === 'same'" class="text-color-secondary">Sin cambios</span>
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
                    :disabled="!writeCount || uploading || reading"
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

.template-link:hover:not(:disabled) {
    text-decoration: underline;
}

.template-link:disabled {
    cursor: default;
    opacity: 0.6;
}

.download-links {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem 1.5rem;
}

.new-tags {
    margin: 0;
    color: var(--text-color-secondary);
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
