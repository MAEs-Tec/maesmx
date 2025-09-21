<template>
    <div class="grid">
        <div class="col-12">
            <div class="card">
                <!-- Título y Buscador -->
                <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-5">
                    <h1 class="text-3xl font-medium m-0">Maeteca</h1>
                    <div class="flex align-items-center mt-3 sm:mt-0">
                        <Button icon="pi pi-plus" class="p-button-rounded mr-2" />
                        <span class="p-input-icon-left">
                            <i class="pi pi-search" />
                            <InputText placeholder="Buscar" style="width: 100%" />
                        </span>
                    </div>
                </div>

                <!-- Contenido Principal -->
                <div class="grid">
                    <!-- Card Grande de Video -->
                    <div class="col-12 lg:col-8">
                        <div class="video-card">
                            <Card class="shadow-none">
                                <template #header>
                                    <!-- Video YouTube responsive -->
                                    <div class="video-wrapper">
                                        <iframe
                                            src="https://www.youtube.com/embed/EhhYnfaePb4?si=skiIAlkJcAtT52IC"
                                            title="YouTube video player"
                                            frameborder="0"
                                            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                                            referrerpolicy="strict-origin-when-cross-origin"
                                            allowfullscreen
                                        ></iframe>
                                    </div>
                                </template>
                                <template #title>¿QUÉ ES UNA BIBLIOTECA?</template>
                                <template #subtitle>Tipos de bibliotecas y características</template>
                            </Card>
                        </div>
                    </div>

                    <!-- Card de Información -->
                    <div class="col-12 lg:col-4">
                        <div class="mae-card">
                            <div class="mae-card__band band--info"></div>
                            <Button icon="pi pi-ellipsis-v" class="p-button-text p-button-rounded mae-card__menu" />
                            <div class="mae-card__body">
                                <h3 class="m-0 mb-3">¿Cómo usar la maeteca?</h3>
                                <p class="mb-3">Aprende como manejarte por medio en la nueva biblioteca digital MAE. Conoce como encontrar temas de tu interés.</p>
                                <div class="flex gap-2">
                                    <Tag value="#maeteca"></Tag>
                                    <Tag value="#general" severity="info"></Tag>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Filtros y Selección -->
                <div class="mt-5">
                    <div class="flex justify-content-between flex-column sm:flex-row align-items-start sm:align-items-center mb-4">
                        <h2 class="text-2xl font-normal m-0">Nuestra selección para ti</h2>
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
                            <Button icon="pi pi-ellipsis-v" class="p-button-text p-button-rounded mae-card__menu" />
                            <div class="mae-card__body">
                                <!-- Contenido de ejemplo -->
                                <div class="surface-200 border-round w-full h-full"></div>
                            </div>
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
/* Puedes agregar estilos personalizados si es necesario */
.p-card {
    box-shadow: none;
}

/* Wrapper responsive para iframe 16:9 */
.video-wrapper {
    position: relative;
    width: 85%;
    padding-top: 25%; /* reducir aún más la altura del iframe */
    overflow: hidden;
    border-radius: var(--border-radius);
}

.video-wrapper iframe {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    border: 0;
}

/* Contenedor de la tarjeta de video alineado al iframe */
.video-card {
    background: #FFF;
    border: 2px solid #E0E0E0;
    border-radius: 20px;
    padding: 12px; /* margen interior sutil como en las cartas */
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
    height: 20px;
    width: 100%;
}

.mae-card__menu {
    position: absolute;
    top: 10px;
    right: 10px;
    color: var(--text-color-secondary);
}

.mae-card__body {
    padding: 12px 16px 16px 16px;
    height: calc(100% - 20px); /* descontar banda superior */
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
</style>
