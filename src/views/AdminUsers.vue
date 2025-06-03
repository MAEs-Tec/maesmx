<script setup>
import { ref, onMounted } from 'vue';
import { FilterMatchMode, FilterService } from 'primevue/api';
import { useToast } from 'primevue/usetoast';
import { getMaes, updateUserInfo } from '../firebase/db/users';

const toast = useToast();

const loading = ref(true);
const maes = ref(null);

const editDialog = ref(false);
const deleteDialog = ref(false);
const selectedUser = ref(null);

const filters = ref({
  searchKey: { value: null, matchMode: 'customSearch' },
  role: { value: null, matchMode: FilterMatchMode.IN },
});

const roles = ref(["mae", "coordi", "subjectCoordi", "admin","publi","tec"])
const editRoles = ref(["admin", "coordi", "mae"]);

onMounted(() => {
  getMaes()
    .then((data) => {
      maes.value = data.map((user) => {
        const name = `${user.firstname ?? ''} ${user.lastname ?? ''}`.trim();
        return {
          ...user,
          name,
          searchKey: `${name} ${user.uid}`.toLowerCase()
        };
      });
      loading.value = false;
    })
    .catch(() => {
      maes.value = [];
      loading.value = false;
    });
});

FilterService.register('customSearch', (value, filter) => {
  if (!filter) return true;
  return value?.toLowerCase().includes(filter.toLowerCase());
});

const openEditDialog = (user) => {
  selectedUser.value = { ...user };
  editDialog.value = true;
};

const openDeleteDialog = (user) => {
  selectedUser.value = { ...user };
  deleteDialog.value = true;
};

const updateRole = async () => {
  try {
    loading.value = true;
    await updateUserInfo(selectedUser.value.uid, { 
        role: selectedUser.value.role,
        firstname: selectedUser.value.firstname,
        lastname: selectedUser.value.lastname
    });
    
    // Actualizar datos locales
    const index = maes.value.findIndex(m => m.uid === selectedUser.value.uid);
    if (index !== -1) {
      maes.value[index].role = selectedUser.value.role;
    }
    
    toast.add({ severity: 'success', summary: 'Éxito', detail: 'Rol actualizado correctamente', life: 3000 });
    editDialog.value = false;
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Error al actualizar el rol', life: 3000 });
    console.error('Error updating role:', error);
  } finally {
    loading.value = false;
  }
};

const deleteUser = async () => {
  try {
    loading.value = true;
    await updateUserInfo(selectedUser.value.uid, { role: "exmae" });
    
    // Quitar usuario de la tabla
    maes.value = maes.value.filter(m => m.uid !== selectedUser.value.uid);
    
    toast.add({ severity: 'success', summary: 'Éxito', detail: 'Usuario marcado como exmae correctamente', life: 3000 });
    deleteDialog.value = false;
  } catch (error) {
    toast.add({ severity: 'error', summary: 'Error', detail: 'Error al marcar el usuario como exmae', life: 3000 });
    console.error('Error deleting user:', error);
  } finally {
    loading.value = false;
  }
};
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
            <Column header="Nombre / Matrícula" field="searchKey" :sortable="false">
                <template #body="{ data }" >
                    <div class="flex items-center gap-4">
                        <img :src="data.photoURL || 'https://ui-avatars.com/api/?name='+data.name" alt="Foto" class="border-circle h-4rem w-4rem"/>
                        <div>
                            <p class="text-lg font-semibold"> {{ data.name }} </p>
                            <a :href="`#/mae/${data.uid}`" class="text-lg uppercase cursor-pointer font-semibold underline text-primary">{{ data.uid }}</a>
                        </div>
                    </div>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <InputText v-model="filterModel.value" type="text" @input="filterCallback()" class="p-column-filter" placeholder="Buscar por nombre o matrícula" />
                </template>
            </Column>
            <Column header="Rol" field="role">
                <template #body="{ data }">
                    <p class="text-lg font-semibold uppercase">{{ data.role }}</p>
                </template>
                <template #filter="{ filterModel, filterCallback }">
                    <MultiSelect v-model="filterModel.value" @change="filterCallback()" :options="roles" placeholder="Cualquiera" class="p-column-filter" style="min-width: 14rem" :maxSelectedLabels="1">
                        <template #option="slotProps">
                            <div class="flex align-items-center gap-2">
                                <span class="uppercase"> {{ slotProps.option }}</span>
                            </div>
                        </template>
                    </MultiSelect>
                </template>
            </Column>
            <Column header="Asesorías" field="asesorias" sortable>
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ Math.floor(Math.random() * 21) + 10 }}</p>
                </template>
            </Column>
            <Column header="Horas" field="totalTime" sortable>
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ Math.round(((data.totalTime ?? 0) / 60) * 100) / 100 }}</p>
                </template>
            </Column>
            <Column header="Horario" field="totalTime">
              <template #body="{ data }">
                <i v-if="data.weekSchedule && typeof data.weekSchedule === 'object' && Object.keys(data.weekSchedule).length > 0" class="pi pi-check-circle text-green-500"></i>
                <i v-else class="pi pi-times-circle text-red-500"></i>
              </template>
            </Column>
            <Column header="Materias" field="totalTime">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ data.subjects ? data.subjects.length : 0 }}</p>
                </template>
            </Column>
            <Column header="Acciones" :exportable="false" style="min-width:8rem">
                <template #body="{ data }">
                    <div class="flex gap-2">
                        <Button icon="pi pi-pencil" outlined rounded severity="info" @click="openEditDialog(data)" />
                        <Button icon="pi pi-trash" outlined rounded severity="danger" @click="openDeleteDialog(data)" />
                    </div>
                </template>
            </Column>
        </DataTable>
    </div>

    <!-- Dialogo de editar -->
    <Dialog v-model:visible="editDialog" modal header="Editar Usuario" :style="{ width: '30rem' }" :closable="false">
        <div class="flex flex-column gap-4">
            <div>
                <label for="name" class="block text-lg font-medium mb-2">Nombre</label>
                <InputText id="name" v-model="selectedUser.name" disabled class="w-full" />
            </div>
            <div>
                <label for="role" class="block text-lg font-medium mb-2">Rol</label>
                <Dropdown id="role" v-model="selectedUser.role" :options="editRoles" class="w-full" optionLabel="" placeholder="Selecciona un rol" />
            </div>
        </div>
        <template #footer>
            <Button label="Cancelar" icon="pi pi-times" class="p-button-text" @click="editDialog = false" :disabled="loading" />
            <Button label="Guardar" icon="pi pi-check" @click="updateRole" :loading="loading" />
        </template>
    </Dialog>

    <!-- Dialogo de borrar -->
    <Dialog v-model:visible="deleteDialog" modal header="Confirmar Eliminación" :style="{ width: '30rem' }" :closable="false">
        <div class="flex flex-column gap-4">
            <p class="m-0">¿Estás seguro que deseas eliminar este usuario? El usuario no será eliminado completamente, solo cambiará su rol a "exmae" y dejará de aparecer en las listas.</p>
            <p class="m-0 font-medium">Usuario: {{ selectedUser?.name }}</p>
        </div>
        <template #footer>
            <Button label="No" icon="pi pi-times" class="p-button-text" @click="deleteDialog = false" :disabled="loading" />
            <Button label="Sí" icon="pi pi-check" severity="danger" @click="deleteUser" :loading="loading" />
        </template>
    </Dialog>
</template>
