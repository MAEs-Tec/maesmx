<template>
    <div class="grid">
        <div class="col-12">
            
                <!-- Título y Buscador -->
                <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-5 header-container">
                    <h1 class="text-black text-6xl font-bold mb-2 text-center sm:text-left">Maeteca</h1>
                    <div class="flex align-items-center mt-3 sm:mt-0">
                        <Button icon="pi pi-plus" class="p-button-rounded mr-2 custom-add-button cruz p-button-lg" style="font-size: 2rem;" />
                        <span class="p-input-icon-left">
                            <i class="pi pi-search" />
                            <InputText placeholder="Buscar" class="custom-search-input" />
                        </span>
                    </div>
                </div>

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
                            <Dropdown v-model="selectedTag" :options="tags" optionLabel="name" placeholder="Etiqueta" class="w-full md:w-14rem" />
                            <Dropdown v-model="selectedCareer" :options="careers" optionLabel="name" placeholder="Carrera" class="w-full md:w-14rem" />
                            <Dropdown v-model="selectedSemester" :options="semesters" optionLabel="name" placeholder="Semestre" class="w-full md:w-14rem" />
                            <Dropdown v-model="selectedType" :options="types" optionLabel="name" placeholder="Tipo" class="w-full md:w-14rem" />
                        </div>
                    </div>

                    <!-- Cards de Selección -->
                    <div class="mae-cards-grid">
                        <div v-for="n in 3" :key="n" class="mae-card">
                            <div :class="['mae-card__band', bandColors[(n - 1) % bandColors.length]]"></div>
                            <Button icon="pi pi-ellipsis-h" class="p-button-text p-button-rounded mae-card__menu" />
                            <div class="mae-card__body">
                                <!-- Contenido de ejemplo -->
                                <div class="surface-200 border-round w-full h-full"></div>
                            </div>
                        </div>
                    </div>
                </div>
            
        </div>
    </div>
</template>

<script setup>
import { ref } from 'vue';

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
    max-width: 443px;
    aspect-ratio: 443 / 291; /* mantiene proporción */
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
    height: calc(100% - 20px); 
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

/* Variantes de color para las bandas */
.band--red { background: linear-gradient(90deg, #B85954 0%, #D29787 100%); }
.band--purple { background: linear-gradient(90deg, #6D5BD0 0%, #B490FF 100%); }
.band--green { background: linear-gradient(90deg, #4CAF50 0%, #9BE7A5 100%); }
.band--info { background: linear-gradient(90deg, #4466A7 0%, #51A3AC 100%); }

/* Grid con separación de 25px entre tarjetas */
.mae-cards-grid {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 25px; /* separa columnas y filas */
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
