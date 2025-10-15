<template>
    <div class="grid">
        <div class="col-12">
            
                <!-- Título y Buscador -->
                <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-5 header-container">
                    <h1 class="text-black text-6xl font-bold mb-2 text-center sm:text-left">Maeteca</h1>
                    <div class="flex align-items-center mt-3 sm:mt-0">
                        <Button
                            v-if="canManageVideos"
                            icon="pi pi-plus"
                            class="p-button-rounded mr-2 custom-add-button cruz p-button-lg"
                            style="font-size: 2rem;"
                            @click="handleOpenAddVideo"
                        />
                        <!-- Botón temporal para probar carga de videos de ejemplo -->
                        <Button
                            v-if="canManageVideos"
                            label="Cargar ejemplos"
                            icon="pi pi-database"
                            class="ml-2"
                            @click="onCreateSamples"
                            :disabled="loadingSamples"
                        />
                        <Button
                            label="Probar lectura"
                            icon="pi pi-eye"
                            class="ml-2"
                            @click="onTestRead"
                            :disabled="testingRead"
                        />
                        <span class="p-input-icon-left">
                            <i class="pi pi-search" />
                            <InputText placeholder="Buscar" class="custom-search-input" />
                        </span>
                    </div>
                </div>

                <!-- pop up para agregar video -->
                <Dialog
                    v-model:visible="showAddVideoDialog"
                    modal
                    class="add-video-dialog"
                    dismissableMask
                    :closable="!savingVideo"
                    @hide="resetVideoForm"
                >
                    <template #header>
                        <div class="dialog-header">
                            <h2>Agregar video</h2>
                        </div>
                    </template>
                    <div class="dialog-content">
                        <div class="field-group">
                            <label for="video-link">Link</label>
                            <div class="input-with-icon">
                                <i class="pi pi-info-circle"></i>
                                <InputText
                                    id="video-link"
                                    v-model="videoForm.link"
                                    placeholder="youtube.com/maeteca/como-usar"
                                    class="w-full"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label for="video-title">Nombre del video</label>
                            <InputText
                                id="video-title"
                                v-model="videoForm.title"
                                placeholder="youtube.com/maeteca/como-usar"
                                class="w-full"
                            />
                        </div>
                        <div class="field-row">
                            <div class="field-group">
                                <label for="video-subject">Materia</label>
                                <Dropdown
                                    id="video-subject"
                                    v-model="videoForm.subject"
                                    :options="videoSubjects"
                                    optionLabel="name"
                                    placeholder="General"
                                    class="w-full"
                                />
                            </div>
                            <div class="field-group">
                                <label for="video-career">Carrera</label>
                                <Dropdown
                                    id="video-career"
                                    v-model="videoForm.career"
                                    :options="videoCareers"
                                    optionLabel="name"
                                    placeholder="Todas"
                                    class="w-full"
                                />
                            </div>
                        </div>
                        <div class="field-group">
                            <label>Etiquetas</label>
                            <div class="tag-collection" v-if="videoForm.tags.length">
                                <span
                                    v-for="tag in videoForm.tags"
                                    :key="tag"
                                    class="tag-pill"
                                >
                                    <span>{{ tagLabelMap[tag] || `#${tag}` }}</span>
                                    <button type="button" @click="removeTag(tag)" aria-label="Eliminar etiqueta">
                                        <i class="pi pi-times"></i>
                                    </button>
                                </span>
                            </div>
                            <MultiSelect
                                v-model="videoForm.tags"
                                :options="availableTagOptions"
                                optionLabel="label"
                                optionValue="value"
                                filter
                                filterPlaceholder="Buscar etiqueta"
                                placeholder="Selecciona etiquetas"
                                :class="['w-full tag-multiselect', { 'tag-multiselect--has-selection': videoForm.tags.length }]"
                            />
                        </div>
                    </div>
                    <template #footer>
                        <div class="dialog-footer">
                            <Button
                                label="Cancelar"
                                class="p-button-text"
                                @click="showAddVideoDialog = false"
                                :disabled="savingVideo"
                            />
                            <Button
                                label="Agregar"
                                class="add-video-submit"
                                :loading="savingVideo"
                                @click="onSubmitVideo"
                                :disabled="isSubmitDisabled"
                            />
                        </div>
                    </template>
                </Dialog>

                <!-- Contenido Principal -->
                <div class="flex flex-column xl:flex-row align-items-stretch gap-4 mb-6">
                    <!-- Card Grande de Video -->
                    <div class="flex-1">
                        <div class="video-wrapper">
                            <iframe width="560" height="315" src="https://www.youtube.com/embed/dphZsfFEqRA?si=1fv4fzGF9Di9QPT2" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
                        </div>
                    </div>

                    <!-- Card de Información -->
                    <div class="w-full xl:w-25rem">
                        <div class="mae-card mae-card-info flex flex-column h-full w-full">
                            <div class="mae-card__band band--info flex-none flex align-items-center justify-content-end pr-2">
                                <Button icon="pi pi-ellipsis-h" class="p-button-text p-button-rounded mae-card__menu-inline" />
                            </div>
                            <div class="mae-card__body flex-1 flex flex-column">
                                <div class="flex-1">
                                    <h3 class="m-0 mb-3 mae-card__title">¿Cómo usar la maeteca?</h3>
                                    <p class="mb-3 mae-card__description">Aprende como manejarte por medio en la nueva biblioteca digital MAE. Conoce como encontrar temas de tu interés.</p>
                                </div>
                                <div class="flex gap-2">
                                    <Tag value="#maeteca" class="custom-tag"></Tag>
                                    <Tag value="#general" severity="info" class="custom-tag"></Tag>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Filtros y Selección -->
                <div class="mt-5">
                    <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-4">
                        <h2 class="text-2xl font-normal m-0 selection-title">Nuestra selección para ti</h2>
                        <div class="flex align-items-center gap-2 mt-3 sm:mt-0">
                            <Dropdown v-model="selectedTag" :options="tags" optionLabel="name" placeholder="Etiqueta" class="w-full md:w-10rem custom-dropdown" />
                            <Dropdown v-model="selectedCareer" :options="careers" optionLabel="name" placeholder="Carrera" class="w-full md:w-10rem custom-dropdown" />
                            <Dropdown v-model="selectedSemester" :options="semesters" optionLabel="name" placeholder="Semestre" class="w-full md:w-10rem custom-dropdown" />
                            <Dropdown v-model="selectedType" :options="types" optionLabel="name" placeholder="Tipo" class="w-full md:w-10rem custom-dropdown" />
                        </div>
                    </div>

                    <!-- Cards de Selección -->
                    <div v-if="videos.length" class="mae-cards-grid">
                        <div
                            v-for="(video, index) in videos"
                            :key="video.id || index"
                            class="mae-card"
                        >
                            <div :class="['mae-card__band', bandColors[index % bandColors.length]]"></div>
                            <Button icon="pi pi-ellipsis-h" class="p-button-text p-button-rounded mae-card__menu" />
                            <div class="mae-card__body">
                                <div
                                    v-if="getVideoThumbnail(video)"
                                    class="mae-card__thumbnail"
                                    role="button"
                                    tabindex="0"
                                    @click="openVideo(video.Video)"
                                    @keyup.enter="handleThumbnailKey($event, video.Video)"
                                    @keyup.space="handleThumbnailKey($event, video.Video)"
                                >
                                    <img
                                        :src="getVideoThumbnail(video)"
                                        :alt="`Miniatura del video ${video.Titulo || ''}`"
                                        loading="lazy"
                                    />
                                    <span class="mae-card__thumbnail-overlay">
                                        <i class="pi pi-play"></i>
                                    </span>
                                </div>
                                <div v-else-if="video.Video" class="mae-card__actions">
                                    <Button
                                        label="Ver video"
                                        icon="pi pi-play"
                                        class="p-button-sm"
                                        @click="openVideo(video.Video)"
                                    />
                                </div>
                                <h3 class="mae-card__title">{{ video.Titulo || 'Video sin título' }}</h3>
                                <p class="mae-card__description">
                                    {{ video.Informacion || 'Este video no tiene descripción disponible.' }}
                                </p>
                                <div class="mae-card__tags" v-if="Array.isArray(video.Relacionado) && video.Relacionado.length">
                                    <Tag
                                        v-for="tag in video.Relacionado"
                                        :key="tag"
                                        :value="`#${tag}`"
                                        class="custom-tag"
                                    ></Tag>
                                </div>
                            </div>
                        </div>
                    </div>
                    <div v-else class="mae-empty-state">
                        <i class="pi pi-info-circle"></i>
                        <p>No se encontraron videos en la Maeteca.</p>
                    </div>
                </div>
            
        </div>
    </div>
</template>

<script setup>
import { ref, computed, onMounted, reactive } from 'vue';
import MultiSelect from 'primevue/multiselect';
import { useToast } from 'primevue/usetoast';
import {
    createSampleVideos,
    addVideoToMaeteca,
    loadMaetecaVideos,
    canUserManageVideos,
    getVideoThumbnail,
    openVideo,
    handleThumbnailKey
} from '../firebase/db/maeteca';
import { getCurrentUser } from '../firebase/db/users';

// Datos de ejemplo para los dropdowns
const selectedTag = ref();
const tags = ref([
    { name: 'Programación', code: 'PROG' },
    { name: 'Matemáticas', code: 'MATH' },
    { name: 'Física', code: 'PHY' }
]);

const selectedCareer = ref();
const careers = ref([
    { name: 'ITC', code: 'ITC' },
    { name: 'IMT', code: 'IMT' },
    { name: 'IDS', code: 'IDS' }
]);

const selectedSemester = ref();
const semesters = ref([
    { name: 'Primer Semestre', code: '1' },
    { name: 'Segundo Semestre', code: '2' },
    { name: 'Tercer Semestre', code: '3' }
]);

const selectedType = ref();
const types = ref([
    { name: 'Video', code: 'VID' },
    { name: 'Artículo', code: 'ART' },
    { name: 'Libro', code: 'BOOK' }
]);

// Colores alternos para bandas de cartas
const bandColors = ['band--red', 'band--purple', 'band--green'];

// Acción: crear videos de ejemplo en Firestore
const toast = useToast();
const loadingSamples = ref(false);
const testingRead = ref(false);
const currentUserRole = ref(null);
const canManageVideos = computed(() => canUserManageVideos(currentUserRole.value));
const videos = ref([]);

const showAddVideoDialog = ref(false);
const savingVideo = ref(false);
const availableTagOptions = ref([
    { label: '#maeteca', value: 'maeteca' },
    { label: '#general', value: 'general' },
    { label: '#tutorial', value: 'tutorial' },
    { label: '#matematicas', value: 'matematicas' },
    { label: '#Quimica', value: 'Quimica' },
    { label: '#Ciencias sociales', value: 'Ciencias sociales' },
    { label: '#Creatividad', value: 'Creatividad' },
    { label: '#Fisica', value: 'Fisica' }
]);

const tagLabelMap = computed(() =>
    availableTagOptions.value.reduce((acc, option) => {
        acc[option.value] = option.label;
        return acc;
    }, {})
);

const videoForm = reactive({
    link: '',
    title: '',
    subject: { name: 'General', code: 'general' },
    career: { name: 'Todas', code: 'all' },
    tags: []
});

const videoSubjects = ref([
    { name: 'General', code: 'general' },
    { name: 'Matemáticas', code: 'math' },
    { name: 'Programación', code: 'prog' }
]);

const videoCareers = ref([
    { name: 'Todas', code: 'all' },
    { name: 'ITC', code: 'itc' },
    { name: 'IMT', code: 'imt' },
    { name: 'IDS', code: 'ids' }
]);

const isSubmitDisabled = computed(() => !videoForm.link.trim() || !videoForm.title.trim() || savingVideo.value);

const resetVideoForm = () => {
    videoForm.link = '';
    videoForm.title = '';
    videoForm.subject = { name: 'General', code: 'general' };
    videoForm.career = { name: 'Todas', code: 'all' };
    videoForm.tags = [];
};

const handleOpenAddVideo = () => {
    resetVideoForm();
    showAddVideoDialog.value = true;
};

const removeTag = (tag) => {
    videoForm.tags = videoForm.tags.filter((item) => item !== tag);
};

const onSubmitVideo = async () => {
    if (isSubmitDisabled.value) {
        toast.add({ severity: 'warn', summary: 'Formulario incompleto', detail: 'Completa la información obligatoria.', life: 3000 });
        return;
    }

    try {
        savingVideo.value = true;
        await addVideoToMaeteca({
            Video: videoForm.link.trim(),
            Titulo: videoForm.title.trim(),
            Materia: videoForm.subject?.code ?? null,
            Carrera: videoForm.career?.code ?? null,
            Relacionado: [...videoForm.tags],
            Informacion: ''
        });
        toast.add({ severity: 'success', summary: 'Video agregado', detail: 'El video se agregó correctamente.', life: 3000 });
        showAddVideoDialog.value = false;
        resetVideoForm();
        await loadVideos();
    } catch (error) {
        const msg = error?.message || 'No se pudo agregar el video';
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 4000 });
    } finally {
        savingVideo.value = false;
    }
};

const loadVideos = async ({ showToast = false } = {}) => {
    try {
        testingRead.value = true;
    videos.value = await loadMaetecaVideos();
        if (showToast) {
            const count = videos.value.length;
            toast.add({
                severity: 'info',
                summary: 'Lectura completada',
                detail: `Se encontraron ${count} videos en la Maeteca.`,
                life: 4000
            });
        }
        console.log('Videos obtenidos:', videos.value);
    } catch (error) {
        const msg = error?.message || 'No se pudieron leer los videos';
        if (showToast) {
            toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 4000 });
        }
        console.error('Error cargando videos de la Maeteca:', error);
    } finally {
        testingRead.value = false;
    }
};

onMounted(async () => {
    try {
        const user = await getCurrentUser();
        currentUserRole.value = user?.role ?? null;
    } catch (error) {
        console.error('Error fetching current user for Maeteca:', error);
        currentUserRole.value = null;
    }
    await loadVideos();
});

const onCreateSamples = async () => {
    if (!canManageVideos.value) {
        toast.add({ severity: 'warn', summary: 'Permiso requerido', detail: 'Tu rol no permite cargar videos en la Maeteca.', life: 4000 });
        return;
    }
    try {
        loadingSamples.value = true;
        await createSampleVideos();
        toast.add({ severity: 'success', summary: 'Éxito', detail: 'Videos de ejemplo creados', life: 3000 });
        await loadVideos();
    } catch (e) {
        const msg = e?.message || 'No se pudieron crear los videos de ejemplo';
        toast.add({ severity: 'error', summary: 'Error', detail: msg, life: 4000 });
    } finally {
        loadingSamples.value = false;
    }
};

const onTestRead = async () => {
    await loadVideos({ showToast: true });
};

</script>

<style scoped>
/* Título y Buscador con margin-right solo en pantalla completa */
/* @media (min-width: 1200px) {
    .header-container {
        margin-right: 125px;
    }
} */

/* Puedes agregar estilos personalizados si es necesario */
.p-card {
    box-shadow: none;
}

/* Wrapper responsive para iframe 16:9 sin borde */
.video-wrapper {
    position: relative;
    /*Cambiar porcentaje en width si el video pareciera estar muy grande */
    width: 100%;
    padding-top: 56.25%; /* Proporción 16:9 (9/16 = 0.5625) */
    overflow: hidden;
    border-radius: 20px;
    max-height: 287px;
}

.video-wrapper iframe {
    position: absolute;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    width: 100%;
    height: 100%;
    border: 0;
    border-radius: 20px; /* Solo el iframe tiene bordes redondeados */
}

.cruz{
    color: #C1C1C1;
}

.custom-add-button .pi::before,
.custom-add-button .pi-plus::before {
    font-size: 2rem !important;
}

.cruz:hover{
    color: #C1C1C1;
}

/* Estilo de cartas de selección/información */
.mae-card {
    width: 100%;
    max-width: 460px;
    min-height: 420px;
    flex-shrink: 0;
    border-radius: 20px;
    border: 2px solid #E0E0E0;
    background: #FFF;
    position: relative;
    padding: 0; /* el contenido interno define su propio padding */
    overflow: hidden;
}

.mae-card__band {
    height: 39px;
    max-height: 39px;
    width: 100%;
}

.mae-card__menu {
    position: absolute;
    top: 10px;
    right: 10px;
    color: var(--text-color-secondary);
}

/* Botón del menú dentro de la banda */
.mae-card__menu-inline {
    color: white !important;
    padding: 0.25rem !important;
    width: auto !important;
    height: auto !important;
    margin-right: 15px !important;
}

.mae-card__menu-inline:hover {
    background-color: rgba(255, 255, 255, 0.1) !important;
}

.mae-card__body {
    padding: 12px 20px 20px 20px;
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
}

.mae-card__thumbnail {
    position: relative;
    width: 100%;
    padding-top: 56.25%;
    border-radius: 16px;
    overflow: hidden;
    cursor: pointer;
    margin-bottom: 1rem;
}

.mae-card__thumbnail img {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    transition: transform 0.3s ease;
}

.mae-card__thumbnail-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(0, 0, 0, 0.25);
    color: #fff;
    font-size: 2rem;
    transition: background 0.3s ease;
}

.mae-card__thumbnail:hover img,
.mae-card__thumbnail:focus img {
    transform: scale(1.05);
}

.mae-card__thumbnail:hover .mae-card__thumbnail-overlay,
.mae-card__thumbnail:focus .mae-card__thumbnail-overlay {
    background: rgba(0, 0, 0, 0.4);
}

.mae-card__thumbnail:focus {
    outline: 2px solid #4466A7;
    outline-offset: 3px;
}

.mae-card__title {
    color: #3B3B3E !important;
    text-align: center !important;
    font-family: Inter !important;
    font-size: 28px !important;
    font-style: normal !important;
    font-weight: 700 !important;
    line-height: normal !important;
    letter-spacing: -1.5px !important;
}

.mae-card__description {
    color: #3B3B3E !important;
    font-family: Inter !important;
    font-size: 18px !important;
    font-style: normal !important;
    font-weight: 500 !important;
    line-height: 1.25 !important;
    letter-spacing: -1px !important;
}

.mae-card__tags {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    margin-top: auto;
}

.mae-card__actions {
    margin-top: 1rem;
    display: flex;
    justify-content: flex-start;
}

.custom-tag {
    border-radius: 26px !important;
    background: linear-gradient(0deg, #4466A7 0%, #4466A7 100%) !important;
    box-shadow: 0 1px 4.2px 0 rgba(0, 0, 0, 0.25) !important;
    color: #FFF !important;
    font-family: Inter !important;
    font-size: 18px !important;
    font-style: normal !important;
    font-weight: 700 !important;
    line-height: normal !important;
    letter-spacing: 0 !important;
    padding: 4px 12px !important;
    width: auto !important;
    display: inline-flex !important;
    align-items: center !important;
    border: none !important;
}

.selection-title {
    color: #3B3B3E !important;
    font-family: Inter !important;
    font-size: 30px !important;
    font-style: normal !important;
    font-weight: 700 !important;
    line-height: normal !important;
    letter-spacing: -1.5px !important;
}

.custom-dropdown {
    border-radius: 15px !important;
    border: 2px solid #BDBDBD !important;
    background: #FFF !important;
}

.custom-dropdown .p-dropdown {
    border-radius: 15px !important;
    border: 2px solid #BDBDBD !important;
    background: #FFF !important;
}

:deep(.add-video-dialog) {
    width: 420px;
    max-width: 95vw;
}

:deep(.add-video-dialog .p-dialog-header) {
    background: #eef2ff;
    border-top-left-radius: 26px;
    border-top-right-radius: 26px;
    padding: 1.75rem 2rem 1rem;
}

:deep(.add-video-dialog .p-dialog-content) {
    background: #eef2ff;
    padding: 0 2rem 1.5rem;
}

:deep(.add-video-dialog .p-dialog-footer) {
    background: #eef2ff;
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
    color: #3b3b3e;
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
    border: 2px solid #d0d7eb;
    background: #fff;
}

.field-group .p-inputtext {
    height: 3.25rem;
    border-radius: 18px;
    border: 2px solid #d0d7eb;
    background: #fff;
}

.field-group :deep(.p-dropdown) {
    height: 3.25rem;
    border-radius: 18px;
    border: 2px solid #d0d7eb;
    background: #fff;
}

.tag-collection {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
}

.tag-pill {
    background: linear-gradient(90deg, #4466A7 0%, #51A3AC 100%);
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

.tag-multiselect :deep(.p-multiselect) {
    border-radius: 18px;
    border: 2px solid #d0d7eb;
    min-height: 3rem;
    background: #fff;
}

.tag-multiselect :deep(.p-multiselect-label) {
    padding: 0.75rem 1rem;
    min-height: 3rem;
    display: flex;
    align-items: center;
    color: #637292;
    caret-color: #637292;
}

.tag-multiselect :deep(.p-multiselect-token) {
    display: none;
}

.tag-multiselect--has-selection :deep(.p-multiselect-label) {
    color: transparent;
    caret-color: #637292;
}

.dialog-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 1rem;
}

.dialog-footer .p-button-text {
    color: #5f6064;
    font-weight: 600;
}

.add-video-submit {
    background: linear-gradient(90deg, #4466A7 0%, #51A3AC 100%) !important;
    border: none !important;
    color: #fff !important;
    font-weight: 700 !important;
    padding: 0.75rem 2.5rem !important;
    border-radius: 18px !important;
    box-shadow: 0 8px 20px rgba(68, 102, 167, 0.35) !important;
}

.add-video-submit:disabled {
    filter: grayscale(0.4);
    cursor: not-allowed;
    box-shadow: none !important;
}

@media (max-width: 640px) {
    .field-row {
        flex-direction: column;
    }

    :deep(.add-video-dialog) {
        width: 100%;
    }
}

/* Variantes de color para las bandas */
.band--red { background: linear-gradient(90deg, #A74444 0%, #AC8551 100%); }
.band--purple { background: linear-gradient(90deg, #6D55B3 0%, #D689D8 100%); }
.band--green { background: linear-gradient(90deg, #44A79B 0%, #69AC51 100%); }
.band--info { background: linear-gradient(90deg, #4466A7 0%, #51A3AC 100%); }

/* Grid con separación de 25px entre tarjetas */
.mae-cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 25px; /* separa columnas y filas */
}

.mae-empty-state {
    padding: 3rem 1rem;
    text-align: center;
    color: #6c757d;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
}

.mae-empty-state .pi {
    font-size: 2rem;
}

/* Responsivo: en pantallas pequeñas, que las cartas no desborden */
@media (max-width: 768px) {
    .mae-card {
        max-width: 100%;
        border-radius: 16px;
    }
    .mae-cards-grid {
        grid-template-columns: 1fr;
    }
}

@media (min-width: 769px) and (max-width: 1200px) {
    .mae-cards-grid {
        grid-template-columns: repeat(2, 1fr);
    }
}

.custom-search-input {
    height: 51px !important;
    flex-shrink: 0;
    border-radius: 41px !important;
    border: 3px solid #C1C1C1 !important;
    background: #FFF !important;
    padding-left: 50px !important; 
    color: #C1C1C1;
}


.custom-search-input::placeholder {
    color: #C1C1C1 !important;
    font-weight: 600;
    font-family: 'Inter', sans-serif;
}

.custom-add-button {
    width: 51px !important;
    height: 51px !important;
    flex-shrink: 0;
    border-radius: 50% !important;
    border: 3px solid #C1C1C1 !important;
    background: #FFF !important;
    fill: #FFF !important;
    stroke-width: 3px !important;
    stroke: #C1C1C1 !important;
}

span.p-input-icon-left {
    display: flex !important;
    align-items: center;
    position: relative;
}

span.p-input-icon-left .pi-search {
    left: 25px !important;
    position: absolute;
    z-index: 1;
    color: #C1C1C1;
    font-size: 1.25rem !important;
}

.custom-search-input {
    flex: 1;
    width: 100% !important;
}
</style>
