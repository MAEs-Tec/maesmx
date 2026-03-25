<script setup>
import { ref, onMounted } from 'vue';
import { FilterMatchMode } from 'primevue/api';
import { useToast } from 'primevue/usetoast';
import { getMaes } from '../firebase/db/users';
import { getAsesoriasCountForUserInCurrentSemester } from '../firebase/db/asesorias';

const toast = useToast();

const loading = ref(true);
const maes = ref(null);

const filters = ref({
    name: { value: null, matchMode: FilterMatchMode.CONTAINS },
    uid: { value: null, matchMode: FilterMatchMode.CONTAINS },
    role: { value: null, matchMode: FilterMatchMode.IN },
});

const roles = ref(["mae", "coordi", "subjectCoordi", "admin","publi","tec"])

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
    loading.value = false;
  } catch {
    maes.value = [];
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
    <div class="sm:flex sm:justify-content-between mb-2 sm:mb-5">
        <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Usuarios</h1>
        <!-- <Button @click="showDialogRegister = true" label="Crear registro" icon="pi pi-pencil" size="large" class="max-h-full w-full sm:w-fit" /> -->
    </div>
    <div class="card mb-0">

    <!-- TODO: Adjust row sizing -->
    <!-- TODO: implement responsive resizing -->
        <DataTable :value="maes" paginator :rows="50" dataKey="id" 
            :loading="loading" class="border-round-xl"
            v-model:filters="filters" filterDisplay="row" removableSort
            responsiveLayout="stack" breakpoint="640px"
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
                    <p class="text-lg font-semibold">{{ Math.floor((data.totalTime ?? 0) / 60) }}h {{ (data.totalTime ?? 0) % 60 }}min</p>
                </template>
            </Column>
            <Column header="Horario" style="width: 7%">
              <template #body="{ data }">
                <i v-if="data.weekSchedule && typeof data.weekSchedule === 'object' && Object.keys(data.weekSchedule).length > 0" class="pi pi-check-circle text-green-500"></i>
                <i v-else class="pi pi-times-circle text-red-500"></i>
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
