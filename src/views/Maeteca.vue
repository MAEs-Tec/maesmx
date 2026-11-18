<script setup>
import { ref, computed, onMounted } from 'vue';
import { useToast } from 'primevue/usetoast';
import { getSubjects } from '../firebase/db/subjects';
import { getMajors } from '../firebase/db/majors';
import { buildCareerOptions, buildTagOptions } from '../utils/maetecaImport.js';
import {
    loadMaetecaVideos,
    canUserManageVideos,
    getVideoThumbnail,
    getVideoById,
    getVideoEmbedUrl,
    getResourceType,
    deleteMaetecaResource,
    RESOURCE_TYPES,
    VIDEO_CAREERS,
    SEMESTERS,
    TYPES,
    // TAGS is the dropdown of simple {name,code}
    TAGS,
    AVAILABLE_TAG_OPTIONS,
    filterVideosByText
} from '../firebase/db/maeteca';
import { getCurrentUser } from '../firebase/db/users';
import MaetecaResourceDialog from '@/components/maeteca/MaetecaResourceDialog.vue';
import MaetecaBulkUpload from '@/components/maeteca/MaetecaBulkUpload.vue';
import MaetecaPdfViewer from '@/components/maeteca/MaetecaPdfViewer.vue';

// Datos de ejemplo para los dropdowns (importados desde la capa de datos).
// Los filtros están ocultos temporalmente en la plantilla; se conservan para reactivarlos.
/* eslint-disable no-unused-vars */
const selectedTag = ref();
const tags = TAGS;

const selectedCareer = ref();
const careers = VIDEO_CAREERS;

const selectedSemester = ref();
const semesters = SEMESTERS;

const selectedType = ref();
const types = TYPES;
/* eslint-enable no-unused-vars */

// Colores alternos para bandas de cartas
const bandColors = ['band--red', 'band--purple', 'band--green'];

const toast = useToast();
const testingRead = ref(false);
const currentUserRole = ref(null);
const canManageVideos = computed(() => canUserManageVideos(currentUserRole.value));
const videos = ref([]);
// Catálogos para el diálogo de recursos y la carga en masa
const subjects = ref([]);
const careerOptions = ref(buildCareerOptions([], VIDEO_CAREERS));
// Etiquetas conocidas: la lista base más las que ya usan los recursos
const tagOptions = computed(() => buildTagOptions(AVAILABLE_TAG_OPTIONS, videos.value));
// Buscador global movible
const searchQuery = ref('');

// Filtro por tipo de recurso
const typeFilter = ref('all');
const typeFilterOptions = [{ name: 'Todos', code: 'all' }, ...RESOURCE_TYPES];

// Filtrado tipo MaesActivos: busca en título y descripción, normalizado, y por tipo
const displayedVideos = computed(() =>
    filterVideosByText(videos.value, searchQuery.value).filter((v) => typeFilter.value === 'all' || getResourceType(v) === typeFilter.value)
);

// Recurso principal (intro) cargado desde documento 'intro-maeteca'
const mainVideo = ref(null);
const mainVideoEmbedUrl = computed(() => (getResourceType(mainVideo.value) === 'pdf' ? null : getVideoEmbedUrl(mainVideo.value) || null));

// Diálogo de crear/editar
const showResourceDialog = ref(false);
const editingResource = ref(null);
const showBulkUpload = ref(false);

// Menú de tres puntos
const resourceMenu = ref(null);
const menuTarget = ref(null);
const resourceMenuItems = computed(() => [
    { label: 'Editar', icon: 'pi pi-pencil', command: () => openEdit(menuTarget.value) },
    { label: 'Eliminar', icon: 'pi pi-trash', disabled: menuTarget.value?.id === 'intro-maeteca', command: () => askDelete(menuTarget.value) }
]);

const openResourceMenu = (event, resource) => {
    menuTarget.value = resource;
    resourceMenu.value.toggle(event);
};

const handleOpenAddVideo = () => {
    editingResource.value = null;
    showResourceDialog.value = true;
};

const openEdit = (resource) => {
    editingResource.value = resource;
    showResourceDialog.value = true;
};

// Borrado
const showDeleteDialog = ref(false);
const deleteTarget = ref(null);
const deleting = ref(false);

const askDelete = (resource) => {
    if (!resource) return;
    deleteTarget.value = resource;
    showDeleteDialog.value = true;
};

const confirmDelete = async () => {
    const target = deleteTarget.value;
    if (!target) return;
    const titulo = target.Titulo || 'Sin título';
    try {
        deleting.value = true;
        const { fileDeleted } = await deleteMaetecaResource(target);
        toast.add({ severity: 'success', summary: 'Recurso eliminado', detail: `Se eliminó "${titulo}".`, life: 3000 });
        if (getResourceType(target) === 'pdf' && !fileDeleted) {
            toast.add({ severity: 'warn', summary: 'Archivo pendiente', detail: 'Se borró el recurso, pero el PDF no se pudo borrar de Storage.', life: 5000 });
        }
        if (mainVideo.value?.id === target.id) {
            mainVideo.value = (await getVideoById('intro-maeteca')) ?? null;
        }
        await loadVideos();
        showDeleteDialog.value = false;
        deleteTarget.value = null;
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: error?.message || 'No se pudo eliminar el recurso.', life: 4000 });
    } finally {
        deleting.value = false;
    }
};

const onResourceSaved = async ({ id } = {}) => {
    await loadVideos();
    if (id && mainVideo.value?.id === id) {
        const fresh = videos.value.find((v) => v.id === id) || (await getVideoById(id));
        if (fresh) mainVideo.value = fresh;
    }
};

const onBulkUploaded = async () => {
    await loadVideos();
};

// Selecciona un recurso para mostrarlo en el área principal
const selectMainVideo = (video) => {
    if (!video) return;
    mainVideo.value = video;
    // Llevar el viewport al área principal
    try {
        const el = document.querySelector('.maeteca-main');
        if (el && typeof el.scrollIntoView === 'function') {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    } catch (e) {
        // no bloquear si falla el scroll
        console.warn('scroll to video failed', e);
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
                detail: `Se encontraron ${count} recursos en la Maeteca.`,
                life: 4000
            });
        }
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
    // Cargar materias y carreras para el diálogo de recursos y la carga en masa
    const [subjectList, majorList] = await Promise.all([
        getSubjects().catch((e) => {
            console.error('Error cargando materias:', e);
            return [];
        }),
        getMajors().catch((e) => {
            console.error('Error cargando carreras:', e);
            return [];
        })
    ]);
    subjects.value = subjectList ?? [];
    careerOptions.value = buildCareerOptions(majorList ?? [], VIDEO_CAREERS);
    // Cargar video intro desde Firestore
    const loadIntroVideo = async () => {
        try {
            const intro = await getVideoById('intro-maeteca');
            if (intro) mainVideo.value = intro;
        } catch (e) {
            console.error('Error cargando video intro:', e);
        }
    };

    await loadIntroVideo();
    await loadVideos();
});
</script>

<template>
    <div class="grid">
        <div class="col-12">

                <!-- Título y Buscador -->
                <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-5 header-container">
                    <h1 class="text-black text-6xl font-bold mb-2 text-center sm:text-left">Maeteca</h1>
                    <div class="flex align-items-center mt-3 sm:mt-0">
                        <Button
                            v-if="canManageVideos"
                            icon="pi pi-upload"
                            class="p-button-rounded mr-2 custom-add-button cruz p-button-lg"
                            style="font-size: 2rem;"
                            aria-label="Carga en masa de videos"
                            v-tooltip.bottom="'Carga en masa de videos'"
                            @click="showBulkUpload = true"
                        />
                        <Button
                            v-if="canManageVideos"
                            icon="pi pi-plus"
                            class="p-button-rounded mr-2 custom-add-button cruz p-button-lg"
                            style="font-size: 2rem;"
                            aria-label="Agregar recurso"
                            v-tooltip.bottom="'Agregar recurso'"
                            @click="handleOpenAddVideo"
                        />
                        <!-- buscador movido abajo junto a los filtros -->
                    </div>
                </div>

                <template v-if="canManageVideos">
                    <MaetecaResourceDialog
                        v-model:visible="showResourceDialog"
                        :resource="editingResource"
                        :subjects="subjects"
                        :careers="careerOptions"
                        :tag-options="tagOptions"
                        @saved="onResourceSaved"
                    />
                    <MaetecaBulkUpload
                        v-model:visible="showBulkUpload"
                        :subjects="subjects"
                        :careers="careerOptions"
                        :tag-options="tagOptions"
                        :existing-videos="videos"
                        @uploaded="onBulkUploaded"
                    />
                    <Menu ref="resourceMenu" :model="resourceMenuItems" popup />

                    <!-- Confirmación de borrado -->
                    <Dialog
                        v-model:visible="showDeleteDialog"
                        modal
                        class="add-video-dialog md:w-4"
                        :dismissableMask="!deleting"
                        :closeOnEscape="!deleting"
                        :closable="!deleting"
                    >
                        <template #header>
                            <div class="dialog-header">
                                <h2>{{ getResourceType(deleteTarget) === 'pdf' ? '¿Estás seguro que deseas eliminar este recurso?' : '¿Estás seguro que deseas eliminar este video?' }}</h2>
                            </div>
                        </template>
                        <p><strong>{{ deleteTarget?.Titulo || 'Sin título' }}</strong></p>
                        <p class="text-color-secondary">Esta acción no se puede deshacer.</p>
                        <template #footer>
                            <div class="flex justify-content-end gap-2">
                                <Button label="Cancelar" severity="secondary" :disabled="deleting" @click="showDeleteDialog = false" />
                                <Button label="Eliminar" severity="danger" icon="pi pi-trash" :loading="deleting" @click="confirmDelete" />
                            </div>
                        </template>
                    </Dialog>
                </template>

                <!-- Contenido Principal -->
                <div class="flex flex-column xl:flex-row align-items-stretch gap-4 mb-6">
                    <!-- Card Grande de Video -->
                    <div class="flex-1">
                        <div class="maeteca-main">
                            <MaetecaPdfViewer
                                v-if="getResourceType(mainVideo) === 'pdf' && mainVideo.Archivo"
                                :url="mainVideo.Archivo"
                                :title="mainVideo.Titulo || ''"
                            />
                            <div v-else class="video-wrapper">
                                <iframe
                                    v-if="mainVideoEmbedUrl"
                                    :src="mainVideoEmbedUrl"
                                    width="560"
                                    height="315"
                                    title="YouTube video player"
                                    frameborder="0"
                                    allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                    referrerpolicy="strict-origin-when-cross-origin"
                                    allowfullscreen
                                ></iframe>
                                <div v-else class="video-placeholder" style="display:flex;align-items:center;justify-content:center;height:100%;">
                                    <p>{{ getResourceType(mainVideo) === 'pdf' ? 'Este PDF no tiene archivo.' : mainVideo?.Video ? 'El link de este video no es válido.' : 'No hay video introductorio.' }}</p>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Card de Información -->
                    <div class="w-full xl:w-25rem">
                        <div class="mae-card mae-card-info flex flex-column h-full w-full">
                            <div class="mae-card__band band--info flex-none flex align-items-center justify-content-end pr-2">
                                <Button
                                    v-if="canManageVideos && mainVideo"
                                    icon="pi pi-ellipsis-h"
                                    class="p-button-text p-button-rounded mae-card__menu-inline"
                                    aria-label="Opciones del recurso"
                                    @click="openResourceMenu($event, mainVideo)"
                                />
                            </div>
                            <div class="mae-card__body flex-1 flex flex-column">
                                <div class="flex-1">
                                    <h3 class="m-0 mb-3 mae-card__title">{{ mainVideo?.Titulo || '' }}</h3>
                                    <p class="mb-3 mae-card__description">{{ mainVideo?.Informacion || '' }}</p>
                                </div>
                                <div class="mae-card__tags">
                                    <template v-if="mainVideo && Array.isArray(mainVideo.Relacionado) && mainVideo.Relacionado.length">
                                        <Tag
                                            v-for="tag in mainVideo.Relacionado"
                                            :key="tag"
                                            :value="`#${tag}`"
                                            class="custom-tag"
                                        />
                                    </template>
                                    <template v-else>
                                        <Tag value="#maeteca" class="custom-tag"></Tag>
                                        <Tag value="#general" severity="info" class="custom-tag"></Tag>
                                    </template>
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
                            <span class="p-input-icon-left" style="width:100%;">
                                <i class="pi pi-search" />
                                <InputText v-model="searchQuery" placeholder="Buscar" class="custom-search-input" />
                            </span>
                            <Dropdown
                                v-model="typeFilter"
                                :options="typeFilterOptions"
                                optionLabel="name"
                                optionValue="code"
                                class="custom-dropdown w-full md:w-10rem"
                                aria-label="Filtrar por tipo"
                            />
                            <!-- filtros ocultos temporalmente
                            <div class="flex align-items-center gap-2 mt-3 sm:mt-0">
                                <Dropdown v-model="selectedTag" :options="tags" optionLabel="name" placeholder="Etiqueta" class="w-full md:w-10rem custom-dropdown" />
                                <Dropdown v-model="selectedCareer" :options="careers" optionLabel="name" placeholder="Carrera" class="w-full md:w-10rem custom-dropdown" />
                                <Dropdown v-model="selectedSemester" :options="semesters" optionLabel="name" placeholder="Semestre" class="w-full md:w-10rem custom-dropdown" />
                                <Dropdown v-model="selectedType" :options="types" optionLabel="name" placeholder="Tipo" class="w-full md:w-10rem custom-dropdown" />
                            </div>
                            -->
                        </div>
                    </div>

                    <!-- Cards de Selección -->
                    <div v-if="displayedVideos.length" class="mae-cards-grid">
                        <div
                            v-for="(video, index) in displayedVideos"
                            :key="video.id || index"
                            class="mae-card"
                        >
                            <div :class="['mae-card__band', bandColors[index % bandColors.length]]"></div>
                            <Button
                                v-if="canManageVideos"
                                icon="pi pi-ellipsis-h"
                                class="p-button-text p-button-rounded mae-card__menu"
                                aria-label="Opciones del recurso"
                                @click="openResourceMenu($event, video)"
                            />
                            <div class="mae-card__body">
                                <div
                                    v-if="getResourceType(video) === 'pdf'"
                                    class="mae-card__thumbnail mae-card__thumbnail--pdf"
                                    role="button"
                                    tabindex="0"
                                    @click="selectMainVideo(video)"
                                    @keyup.enter="selectMainVideo(video)"
                                    @keyup.space="selectMainVideo(video)"
                                    :aria-label="`Ver ${video.Titulo || 'PDF'}`"
                                >
                                    <span class="mae-card__pdf-icon"><i class="pi pi-file-pdf"></i></span>
                                </div>
                                <div
                                    v-else-if="getVideoThumbnail(video)"
                                    class="mae-card__thumbnail"
                                    role="button"
                                    tabindex="0"
                                    @click="selectMainVideo(video)"
                                    @keyup.enter="selectMainVideo(video)"
                                    @keyup.space="selectMainVideo(video)"
                                    :aria-label="`Reproducir ${video.Titulo || 'video'}`"
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
                                <div v-else-if="video.Video && getVideoEmbedUrl(video)" class="mae-card__actions">
                                    <Button
                                        label="Ver video"
                                        icon="pi pi-play"
                                        class="p-button-sm"
                                        @click="selectMainVideo(video)"
                                    />
                                </div>
                                <h3 class="mae-card__title">{{ video.Titulo || (getResourceType(video) === 'pdf' ? 'PDF sin título' : 'Video sin título') }}</h3>
                                <p class="mae-card__description">
                                    {{ video.Informacion || (getResourceType(video) === 'pdf' ? 'Este PDF no tiene descripción disponible.' : 'Este video no tiene descripción disponible.') }}
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
                        <p>No se encontraron recursos en la Maeteca.</p>
                    </div>
                </div>

        </div>
    </div>
</template>

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
    border: 2px solid var(--surface-border, #E0E0E0);
    background: var(--surface-card);
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
    color: var(--text-color, #3B3B3E) !important;
    text-align: center !important;
    font-family: Inter !important;
    font-size: 28px !important;
    font-style: normal !important;
    font-weight: 700 !important;
    line-height: normal !important;
    letter-spacing: -1.5px !important;
}

.mae-card__description {
    color: var(--text-color-secondary, #3B3B3E) !important;
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
    border: 2px solid var(--surface-border, #BDBDBD) !important;
    background: var(--surface-card) !important;
}

.custom-dropdown .p-dropdown {
    border-radius: 15px !important;
    border: 2px solid var(--surface-border, #BDBDBD) !important;
    background: var(--surface-card) !important;
}


/* Miniatura de PDF: sin imagen, ícono centrado */
.mae-card__thumbnail--pdf {
    background: var(--surface-ground);
}

.mae-card__pdf-icon {
    position: absolute;
    inset: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 3rem;
    color: var(--text-color-secondary);
}

/* Estilos del diálogo de confirmación de borrado */
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
    font-size: 1.25rem;
    font-weight: 700;
    color: #2d2d30;
    margin: 0;
}

@media (max-width: 640px) {
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
    border: 3px solid var(--surface-border, #C1C1C1) !important;
    background: var(--surface-card) !important;
    padding-left: 50px !important;
    color: var(--text-color-secondary, #C1C1C1);
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
    border: 3px solid var(--surface-border, #C1C1C1) !important;
    background: var(--surface-card) !important;
    fill: var(--surface-card) !important;
    stroke-width: 3px !important;
    stroke: var(--surface-border, #C1C1C1) !important;
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
