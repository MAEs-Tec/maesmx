<script setup>
import { ref, onMounted } from 'vue';

import { getAsesorias } from '../firebase/db/asesorias';
import * as XLSX from 'xlsx';

const asesorias = ref([]);
const startDate = ref(null);
const endDate = ref(null);
const loading = ref(true);
const showDialog = ref(false);



const fetchAsesorias = async () => {
    try {
        loading.value = true;

        // Validar si las fechas son válidas antes de llamar a Firebase
        if (startDate.value && endDate.value) {
            const asesoriasData = await getAsesorias(startDate.value, endDate.value);
            asesorias.value = asesoriasData;
        } else {
            asesorias.value = await getAsesorias(); 
        }
    } catch (error) {
        console.error("Error fetching asesorias: ", error);
        asesorias.value = [];
    } finally {
        loading.value = false;
    }
};

const filterByDate = () => {
    fetchAsesorias();
};

// Función para exportar los datos a Excel
const exportToExcel = () => {
    const today = new Date();
    
    // Si no hay filtros de fecha, mostrar el diálogo de confirmación
    if (!startDate.value || !endDate.value || new Date(endDate.value) < today) {
        showDialog.value = true;
        return;
    }
    
    exportData(); // Exporta sin diálogo si ya hay filtros correctos
};

const exportData = () => {
    // Mapear las asesorías a las columnas deseadas
    const formattedData = asesorias.value.map(asesoria => {
        return {
            'ID': asesoria.id || '',
            'Fecha': asesoria.date ? new Date(asesoria.date.seconds * 1000).toLocaleDateString() : '',
            'Nombre MAE': asesoria.peerInfo?.name || '',
            'Matricula MAE': asesoria.peerInfo?.uid || '',
            'Carrera MAE': asesoria.peerInfo?.career || '',
            'Nombre Alumno': asesoria.userInfo?.name || '',
            'Matricula Alumno': asesoria.userInfo?.id || '',
            'Carrera Alumno': asesoria.userInfo?.career || '',
            'Materia': asesoria.subject?.name || '',
            'Rating': asesoria.rating || 'N/A',
            'Comentario': asesoria.comment || '',
            'Area MAE': asesoria.peerInfo?.area || '',
            'Modelo MAE': 'TEC21',
            'Campus MAE': asesoria.peerInfo?.campus || '',
            'Area Alumno': asesoria.userInfo?.area || '',
            'Modelo Alumno': 'TEC21',
            'Campus Alumno': asesoria.userInfo?.campus || '',
            'Modalidad': asesoria.modalidad || 'Presencial',
            'Tipo': asesoria.type || 'Normal',
            'Formato': asesoria.formato || 'Individual',
        };
    });

    // Crear la hoja de Excel con los datos formateados
    const worksheet = XLSX.utils.json_to_sheet(formattedData);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Asesorías");

    // Exportar el archivo Excel
    XLSX.writeFile(workbook, "asesorias.xlsx");
};

// Función que se llama cuando el usuario confirma la exportación
const confirmExportAction = () => {
    showDialog.value = false; // Oculta el diálogo
    exportData(); // Ejecuta la exportación
};

onMounted(() => {
    fetchAsesorias(); // Fetch asesorias when component mounts
});
</script>

<template>
    <div class="sm:flex sm:justify-content-between mb-2 sm:mb-5">
        <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Asesorías</h1>
    </div>
    <div>
        <div class="flex md:flex-row flex-column mb-4">
            <Calendar v-model="startDate" placeholder="Fecha de Inicio" dateFormat="yy-mm-dd" showIcon class="mb-2 mr-3 w-3 "/>
            <span class="mx-3 text-4xl text-black font-bold ">-</span>
            <Calendar v-model="endDate" placeholder="Fecha de Fin" dateFormat="yy-mm-dd" showIcon class="mb-2 mx-3 w-3 "/>
            <Button label="Filtrar" @click="filterByDate" class="mb-2 mx-3 w-2 "/>
            <Button label="Exportar a Excel" @click="exportToExcel" class="mb-2 mx-3 w-3 "/> 
        </div>

        <DataTable :value="asesorias"   paginator :rows="10" dataKey="id" :loading="loading" 
            v-model:filters="filters" filterDisplay="row" removableSort responsiveLayout="scroll" class="custom-table" >
            <template #empty>No se encontraron asesorías.</template>
            <template #loading>Cargando información. Por favor espera.</template>

            <Column header="ID" field="id" hidden>
                <template #body="{ data }">
                    <p class="text-sm ">{{ data.id }}</p>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <InputText v-model="filterModel.value" type="text" @input="filterCallback()" class="p-column-filter" placeholder="ID" />
                </template>
            </Column>
            
            <Column header="Fecha" field="date">
                <template #body="{ data }">
                    <p class="text-sm ">{{ new Date(data.date.seconds * 1000).toLocaleDateString() }}</p>
                </template>
            </Column>
            
            <Column header="Mae" field="maeInfo">
                <template #body="{ data }">
                    <div class= "flex flex-row"> 
                        <img v-if="data.peerInfo.profilePictureUrl" :src="data.peerInfo.profilePictureUrl" alt="Foto de perfil"
                            class="border-circle h-3rem w-3rem">
                            <Skeleton v-else shape="circle" size="3rem"></Skeleton>
                        <span class="flex flex-column ml-4 ">
                            <p class="text-sm font-bold">{{ data.peerInfo.name  }}  </p>
                            <p class="text-sm ">{{ data.peerInfo.uid }}</p>
                        </span>
                    </div>
                </template>           
            </Column>

            <Column header="Carrera" field="maeInfo">
                <template #body="{ data }">
                    <span>
                        <p class="text-sm ">{{ data.peerInfo.career }}  </p>
                        <p class="text-sm ">{{ data.peerInfo.area}}  </p>
                    </span>
                </template>           
            </Column>

            <Column header="Alumno" field="alumnoInfo">
                <template #body="{ data }">
                    <span>
                        <p class="text-sm  font-bold">{{ data.userInfo.name  }}  </p>
                        <p class="text-sm ">{{ data.userInfo.uid }}</p>
                    </span>
                </template>           
            </Column>
            
            <Column header="Carrera" field="alumnoInfo">
                <template #body="{ data }">
                    <span>
                        <p class="text-sm  ">{{ data.peerInfo.career }}  </p>
                        <p class="text-sm ">{{ data.peerInfo.area}}  </p>
                    </span>
                </template>           
            </Column>

            <Column header="Materias" field="subjects">
                <template #body="{ data }">
                    <p class="text-sm ">{{ data.subject.name }}</p>
                </template>
            </Column>
            
            <Column header="Materias" field="clave" hidden >
                <template #body="{ data }">
                    <p class="text-sm ">{{ data.subject.id }}</p>
                </template>
            </Column>
            
            <Column header="Comentario" field="comment" hidden>
                <template #body="{ data }">
                    <p class="text-sm ">{{ data.comment }}</p>
                </template>
            </Column>
        </DataTable>
    </div>
     <!-- Diálogo de confirmación -->
     <Dialog v-model:visible="showDialog" header="Confirmar Exportación" modal>
        <p>¿Estás seguro de que deseas exportar todas las asesorías sin aplicar filtros ya que se exportar todas?</p>
        <div class="flex justify-content-end mt-3">
            <Button label="Cancelar" icon="pi pi-times" @click="showDialog = false" class="p-button-text" />
            <Button label="Aceptar" icon="pi pi-check" @click="confirmExportAction" auto-focus />
        </div>
    </Dialog>
</template>

<style>


.custom-table .p-datatable-tbody > tr:nth-child(even) {
    background-color: #ffffff; /* Color de fondo para filas pares */
}

.custom-table .p-datatable-tbody > tr:nth-child(odd) {
    background-color: #f2f2f2 ; /* Color de fondo para filas impares */
}

.custom-table {
    border-radius: 12px; /* Bordes redondeados para la tabla */
    overflow: hidden; /* Para asegurar que los bordes redondeados funcionen bien */
    border: 1px solid #e4e7e6; /* Color del borde de la tabla */
}


.custom-table .p-datatable-tbody > tr > td span p {
    margin: 0; /* Elimina el margen por defecto */
}

.custom-table .p-datatable-tbody > tr > td {
    border-bottom: 1px solid #e4e7e6; /* Cambia el color y el grosor del borde */
    padding: 1rem 1.5rem; /* Ajusta el padding si es necesario */
    text-align: left;
}

</style>