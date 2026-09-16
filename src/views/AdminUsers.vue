<script setup>
import { ref, onMounted } from 'vue';
import { FilterMatchMode } from 'primevue/api';
import { useToast } from 'primevue/usetoast';
import * as XLSX from 'xlsx';
import { getMaes } from '../firebase/db/users';
import { getAsesoriasCountForUserInCurrentSemester } from '../firebase/db/asesorias';

const loading = ref(true);
const maes = ref(null);
const tableUsers = ref([]);
const exporting = ref(false);
const activeSort = ref({ field: null, order: 1 });
const toast = useToast();

const filters = ref({
    name: { value: null, matchMode: FilterMatchMode.CONTAINS },
    uid: { value: null, matchMode: FilterMatchMode.CONTAINS },
    role: { value: null, matchMode: FilterMatchMode.IN },
});

const roles = ref(["mae", "coordi", "subjectCoordi", "admin","publi","tec"])

const hasConfiguredSchedule = (weekSchedule) => (
  weekSchedule
  && typeof weekSchedule === 'object'
  && Object.values(weekSchedule).some(day => Array.isArray(day) && day.length > 0)
);

const formatServiceTime = (totalTime = 0) => {
  const safeTotalTime = Number.isFinite(Number(totalTime)) ? Math.max(0, Number(totalTime)) : 0;
  return `${Math.floor(safeTotalTime / 60)}h ${Math.floor(safeTotalTime % 60)}min`;
};

const handleTableValueChange = (users) => {
  tableUsers.value = Array.isArray(users) ? users : [];
};

const handleTableSort = ({ sortField = null, sortOrder = 1 }) => {
  activeSort.value = { field: sortField, order: sortOrder ?? 1 };
};

const getSortedExportUsers = () => {
  const users = [...tableUsers.value];
  const { field, order } = activeSort.value;
  if (!field) return users;

  return users.sort((firstUser, secondUser) => {
    const firstValue = firstUser[field];
    const secondValue = secondUser[field];

    if (firstValue == null && secondValue == null) return 0;
    if (firstValue == null) return -1 * order;
    if (secondValue == null) return order;

    const comparison = typeof firstValue === 'string' && typeof secondValue === 'string'
      ? firstValue.localeCompare(secondValue, 'es', { numeric: true, sensitivity: 'base' })
      : Number(firstValue > secondValue) - Number(firstValue < secondValue);

    return comparison * order;
  });
};

const getLocalDateForFilename = () => {
  const today = new Date();
  const year = today.getFullYear();
  const month = String(today.getMonth() + 1).padStart(2, '0');
  const day = String(today.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const exportUsersToExcel = async () => {
  const usersToExport = getSortedExportUsers();
  if (usersToExport.length === 0 || exporting.value) return;

  exporting.value = true;

  try {
    // Permite que PrimeVue muestre el estado de carga antes del trabajo sincrono de XLSX.
    await new Promise(resolve => setTimeout(resolve, 0));

    const formattedUsers = usersToExport.map(user => ({
      'Matrícula': String(user.uid ?? '').toUpperCase(),
      'Nombre': user.name ?? '',
      'Rol': String(user.role ?? '').toUpperCase(),
      'Asesorías': Number(user.asesoriasCount ?? 0),
      'Horas': formatServiceTime(user.totalTime),
      'Horario configurado': hasConfiguredSchedule(user.weekSchedule) ? 'Sí' : 'No',
      'Materias': Array.isArray(user.subjects) ? user.subjects.length : 0
    }));

    const worksheet = XLSX.utils.json_to_sheet(formattedUsers);
    worksheet['!cols'] = [
      { wch: 14 },
      { wch: 36 },
      { wch: 18 },
      { wch: 12 },
      { wch: 16 },
      { wch: 21 },
      { wch: 12 }
    ];
    worksheet['!autofilter'] = { ref: worksheet['!ref'] };

    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, 'Usuarios');
    XLSX.writeFile(workbook, `usuarios_maes_${getLocalDateForFilename()}.xlsx`, { compression: true });

    toast.add({
      severity: 'success',
      summary: 'Excel descargado',
      detail: `Se exportaron ${formattedUsers.length} usuarios.`,
      life: 3500
    });
  } catch (error) {
    console.error('Error al exportar usuarios a Excel:', error);
    toast.add({
      severity: 'error',
      summary: 'No se pudo exportar',
      detail: 'Intenta nuevamente. Si el problema continua, contacta a un administrador.',
      life: 5000
    });
  } finally {
    exporting.value = false;
  }
};

onMounted(async () => {
  try {
    const data = await getMaes();
    const counts = await Promise.all(
      data.map(mae => getAsesoriasCountForUserInCurrentSemester(mae.uid))
    );
    data.forEach((mae, i) => {
      mae.asesoriasCount = counts[i];
    });
    maes.value = data;
    tableUsers.value = data;
    loading.value = false;
  } catch {
    maes.value = [];
    tableUsers.value = [];
    loading.value = false;
  }
});

import { getAuth } from "firebase/auth";

async function checkUserRole() {
  const auth = getAuth();
  const currentUser = auth.currentUser;

  if (!currentUser) {
    console.error("No hay usuario autenticado.");
    return;
  }

  try {
    const idTokenResult = await currentUser.getIdTokenResult();
    console.log("Custom claims en el token:", idTokenResult.claims);

    // Verifica el campo role
    if (idTokenResult.claims.role) {
      console.log("El usuario tiene el rol:", idTokenResult.claims.role);
    } else {
      console.warn("El usuario no tiene un rol asignado en el token.");
    }
  } catch (error) {
    console.error("Error obteniendo el token:", error);
  }
}

// Llama a la función en el momento adecuado
checkUserRole();
</script>


<template>
    <Toast />
    <div class="sm:flex sm:align-items-center sm:justify-content-between mb-3 sm:mb-5">
        <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Usuarios</h1>
        <Button
            label="Exportar a Excel"
            icon="pi pi-file-excel"
            class="p-button-success w-full sm:w-auto p-3 mt-3 sm:mt-0"
            :loading="exporting"
            :disabled="loading || tableUsers.length === 0"
            aria-label="Exportar la lista de usuarios a Excel"
            @click="exportUsersToExcel"
        />
    </div>
    <div class="card mb-0">

    <!-- TODO: Adjust row sizing -->
    <!-- TODO: implement responsive resizing -->
        <DataTable :value="maes" paginator :rows="50" dataKey="id" 
            :loading="loading" class="border-round-xl"
            v-model:filters="filters" filterDisplay="row" removableSort
            responsiveLayout="stack" breakpoint="640px"
            @value-change="handleTableValueChange"
            @sort="handleTableSort"
            >
            <template #empty>No se encontraron Maes. </template>
            <template #loading>Cargando información. Por favor espera.</template>
            <Column header="Matrícula" field="uid" sortable style="width: 23%">
                <template #body="{ data }">
                    <a :href="`#/mae/${data.uid}`" class="text-lg uppercase cursor-pointer font-semibold underline text-primary">{{ data.uid }}</a>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <InputText v-model="filterModel.value" type="text" @input="filterCallback()" class="p-column-filter w-full" placeholder="Matrícula" />
                </template>
            </Column>
            <Column header="Nombre" field="name" sortable style="width: 22%">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ data.name }}</p>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <InputText v-model="filterModel.value" type="text" @input="filterCallback()" class="p-column-filter w-full" placeholder="Nombre" />
                </template>
            </Column>
            <Column header="Rol" field="role" style="width: 8%">
                <template #body="{ data }">
                    <p class="text-lg font-semibold uppercase">{{ data.role }}</p>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <MultiSelect v-model="filterModel.value" @change="filterCallback()" :options="roles" placeholder="Rol" class="p-column-filter w-full" :maxSelectedLabels="1">
                        <template #option="slotProps">
                            <div class="flex align-items-center gap-2">
                                <span class="uppercase"> {{ slotProps.option }}</span>
                            </div>
                        </template>
                    </MultiSelect>
                </template>
            </Column>
            <Column header="Asesorías" field="asesoriasCount" sortable style="width: 10%">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ data.asesoriasCount ?? '...' }}</p>
                </template>
            </Column>
            <Column header="Horas" field="totalTime" sortable style="width: 13%">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ formatServiceTime(data.totalTime) }}</p>
                </template>
            </Column>
            <Column header="Horario" style="width: 7%">
              <template #body="{ data }">
                <i v-if="hasConfiguredSchedule(data.weekSchedule)" class="pi pi-check-circle text-green-500" aria-label="Horario configurado"></i>
                <i v-else class="pi pi-times-circle text-red-500" aria-label="Horario no configurado"></i>
              </template>
            </Column>
            <Column header="Materias" style="width: 7%">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ data.subjects ? data.subjects.length : 0 }}</p>
                </template>
            </Column>
        </DataTable>
    </div>
</template>
