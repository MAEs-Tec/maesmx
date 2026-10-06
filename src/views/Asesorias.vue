<script setup>
import AutoComplete from 'primevue/autocomplete';
import Button from 'primevue/button';
import Calendar from 'primevue/calendar';
import Dropdown from 'primevue/dropdown';
import ProgressSpinner from 'primevue/progressspinner';
import { ref, onMounted, computed, watch } from 'vue';
import { getCurrentUser} from '../firebase/db/users';
import { getSubjects } from '../firebase/db/subjects';
import { getAsesoriasPage } from '../firebase/db/asesorias'
import { getSubjectColor, normalize } from '@/utils/HorarioUtils';

const userInfo = ref(null);
const asesorias = ref([]);
const isLoading = ref(true); 
const subjects = ref([]);
const startDate = ref(new Date(new Date().getFullYear(), new Date().getMonth() < 6 ? 0 : 6, 1));
const endDate = ref(new Date());
const cursor = ref(null);
const loadError = ref('');
let requestId = 0;
const loadPage = async (more = false) => {
    const id = ++requestId;
    isLoading.value = true; loadError.value = '';
    try {
        const page = await getAsesoriasPage({ peerUid: userInfo.value.uid,
            startDate: date.value || startDate.value, endDate: date.value || endDate.value,
            subjectId: subjectInput.value?.id, evaluated: evalInput.value,
            cursor: more ? cursor.value : null });
        if (id !== requestId) return;
        asesorias.value = more ? [...asesorias.value, ...page.items] : page.items;
        cursor.value = page.cursor;
    } catch (error) { if (id === requestId) loadError.value = error.message; }
    finally { if (id === requestId) isLoading.value = false; }
};
const date = ref(null);
const evalInput = ref(null);

const subjectInput = ref('');
const filteredSubjects = ref([]);

const evaluacion = [
    { label: 'Cualquiera', value: null },
    { label: 'Evaluada', value: true},
    { label: 'Sin Evaluación', value: false }
];

onMounted(async () => {
    userInfo.value = await getCurrentUser();
    await loadPage();
    subjects.value = await getSubjects();
    isLoading.value = false;  
    
});

const formatDate = (timestamp) => {
    if (!timestamp?.seconds) return 'Fecha no disponible';
    const date = new Date(timestamp.seconds * 1000);
    return date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long', year: 'numeric' });
};

const filterAsesorias = computed(() => asesorias.value);
watch([date, evalInput, () => subjectInput.value?.id], () => { if (userInfo.value) loadPage(); });

const clearFilters = () => {
    subjectInput.value = '';
    date.value = null;
    evalInput.value = null;
};

const filterSubjects = () => {
    const query = normalize(subjectInput.value);

    //Conseguir las materias de las asesorías dadas
    const asesoriasSubjects = subjects.value;
    //Eliminar materias duplicadas y ordenarlas alfabéticamente
    const uniqueSubjectsMap = new Map(asesoriasSubjects.map(subject => [subject.id, subject]));
    const uniqueSubjects = Array.from(uniqueSubjectsMap.values());  
    uniqueSubjects.sort((a, b) => a.name.localeCompare(b.name));

    //Filtrar las materias por el query del input
    filteredSubjects.value = uniqueSubjects.filter(subject =>
        normalize(subject.name).includes(query)
    );
};



</script>

<template>
    <div class="flex gap-2 mb-3">
        <Calendar v-model="startDate" placeholder="Desde" />
        <Calendar v-model="endDate" placeholder="Hasta" />
        <Button label="Consultar período" :disabled="isLoading" @click="loadPage()" />
    </div>
    <p v-if="loadError" role="alert">{{ loadError }}</p>
    <Button v-if="cursor" label="Cargar 50 más" :disabled="isLoading" @click="loadPage(true)" />
    <div v-if="subjectInput || date || evalInput != null" class="flex">
        <button @click="clearFilters" class="mr-2 bg-transparent border-none">
            <i class="pi pi-arrow-left text-black" style="font-size: 1.5rem; margin-right: 0.5rem;"></i>
        </button>
        <h1 class="text-black text-6xl font-bold mb-5 text-center sm:text-left">Mis asesorías filtradas</h1>
    </div>

    <div v-else>
        <h1 class="text-black text-6xl font-bold mb-5 text-center sm:text-left">Mis asesorías </h1>
    </div>

    <div class="w-full mb-5 ">
        <div class="flex lg:flex-row  flex-column"> 
            <AutoComplete 
                class="md:w-5 w-full mr-3 mb-2"
                v-model="subjectInput" 
                :suggestions="filteredSubjects" 
                @complete="filterSubjects" 
                field="name" 
                dropdown 
                :forceSelection="false"
                placeholder="Buscar materia..." 
            />
            <Calendar v-model="date" placeholder="Fecha" dateFormat="yy-mm-dd" showIcon class="mb-2 mr-3 w-full lg:w-3  mt-2 lg:mt-0"/>
            <Dropdown 
                v-model="evalInput"
                :options="evaluacion" 
                option-label="label" 
                option-value="value"
                placeholder="Evaluación..." 
                class="mb-2 w-full md:w-3 mt-2 lg:mt-0" 
                />
            </div>
    </div>

    <div v-if="isLoading" class="text-center">
        <ProgressSpinner style="width: 60px; height: 60px; animation: spin-fast 0.5s linear infinite;" strokeWidth="6" fill="var(--surface-ground)" />
    </div>

    <div v-else-if="!filterAsesorias.length" class="text-center">
        <p class="text-lg">Sin asesorías</p>
    </div>

    <div v-else class="flex flex-wrap gap-6">
        <div 
            v-for="asesoria in filterAsesorias" 
            :key="asesoria.id" 
            class="flex flex-col md:flex-row bg-white border-round-3xl w-full md:w-5 boder-gray"
            style="height: 185px;"
        >
            <div class="flex border-round-left-3xl "  :class="getSubjectColor(asesoria.subject.area)"  style="width: 1rem; height: 100%;"></div>
            
            <div class="flex flex-column p-3 w-full ml-1 ">
                <div style="height: 50px">
                    <p class="font-bold text-lg ">
                        {{ asesoria.subject.name }}
                    </p>
                </div>
               

                <span class="flex flex-row ml-2">
                    <img src="/assets/grad.svg" class="mr-2" alt="graduation icon" style="width: 1.5rem; height: 1.5rem;" />
                    <p class="text-md">
                        {{ asesoria.userInfo.name  }}
                    </p>
                </span>

                <span class="flex flex-row mt-1 ml-2">
                    <img src="/assets/calendar.svg" class="mr-2" alt="calendar icon" style="width: 1.5rem; height: 1.5rem;" />
                    <p class="text-md">
                        {{ formatDate(asesoria.date) }}
                    </p>
                </span>

                <span class="flex flex-row mt-1 ml-2">
                    <img src="/assets/star.svg" class="mr-2" alt="star icon" style="width: 1.5rem; height: 1.5rem;" />
                    <p class="text-md">
                        {{ asesoria.rating ?  'Evaluada' : 'Sin evaluación' }}
                    </p>
                </span>
            </div>
        </div>
    </div>
</template>

<style>
.boder-gray{
    border: 2px solid var(--surface-border);
}
</style>
