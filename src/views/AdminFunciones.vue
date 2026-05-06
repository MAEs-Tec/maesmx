<script setup>
import { ref } from 'vue';
import { useToast } from 'primevue/usetoast';
import { useConfirm } from 'primevue/useconfirm';
import Dialog from 'primevue/dialog';
import Button from 'primevue/button';
import Dropdown from 'primevue/dropdown';
import ConfirmDialog from 'primevue/confirmdialog';
import { 
    clearAllUsersWeekSchedule, 
    checkAndUpdateUserRole,  
    updateUserToMae,
    updatePoints,
    clearUsersData,
    resetAllUsersTotalTimeAndPoints,
    resetAllUsersLeaderboardPoints
} from '../firebase/db/users';
import { deleteOldAsesorias, borrarTodasEvaluaciones } from '../firebase/db/asesorias.js'
import { revelarEvaluaciones, borrarEvaluaciones } from '../firebase/db/settings'

const toast = useToast();
const confirm = useConfirm();
const displayUploadDialog = ref(false);
const displayAddUserDialog = ref(false);
const displayUpdatePointsDialog = ref(false);
const selectedFile = ref(null);

const newMatricula = ref('');
const newRole = ref(null);
const newStatus = ref(null);

const roles = [
    { label: 'MAE', value: 'mae' },
    { label: 'Coordi', value: 'coordi' },
    { label: 'Publi', value: 'publi' },
    { label: 'Tecnología', value: 'tec' },
    { label: 'Usuario', value: 'user' }
];
const statuses = [
    { label: 'Becario', value: 'becario' },
    { label: 'Voluntario', value: 'voluntario' },
    { label: 'Estudiante', value: 'estudiante' }
];

const confirmDelete = () => {
    confirm.require({
        message: '¿Estás seguro de que deseas eliminar el contenido de los horarios para todos los maes?',
        header: 'Confirmación de Eliminación',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, eliminar',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-danger',
        accept: async () => {
            try {
                await clearAllUsersWeekSchedule();
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Se ha limpiado el horario de todos los maes.', life: 3000 });
            } catch (error) {
                console.error("Error al limpiar weekSchedule:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al intentar limpiar los horarios de los maes.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
        }
    });
};


const restartMaes = () => {
    confirm.require({
        message: '¿Estás seguro de restablecer los datos de los maes?',
        header: 'Confirmación ',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, restablecer',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-danger',
        accept: async () => {
            try {
                await clearUsersData();
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Se han restablecido los valores de los maes.', life: 3000 });
            } catch (error) {
                console.error("Error al restablecer valores:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al restablecer los valores de los maes.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
        }
    });
};

const confirmRevealEvaluaciones = () => {
    confirm.require({
        message: '¿Estás seguro de revelar todas las evaluaciones pendientes a los MAEs? Las evaluaciones creadas después de este momento permanecerán ocultas hasta la próxima revelación.',
        header: 'Revelar evaluaciones',
        icon: 'pi pi-eye',
        acceptLabel: 'Sí, revelar',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-success',
        accept: async () => {
            try {
                await revelarEvaluaciones();
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Las evaluaciones han sido reveladas a los MAEs.', life: 3000 });
            } catch (error) {
                console.error("Error al revelar evaluaciones:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al revelar las evaluaciones.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
        }
    });
};

const confirmDeleteAllEvaluaciones = () => {
    confirm.require({
        message: 'Vas a borrar TODAS las evaluaciones (rating y comentario) de la base de datos. Las asesorías en sí se mantienen. Esta acción no se puede deshacer. ¿Continuar?',
        header: 'Borrar todas las evaluaciones',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, borrar evaluaciones',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-danger',
        accept: async () => {
            let dbRes = { cleared: 0, failed: 0, sampleErrors: [] };
            let dbError = null;
            try {
                dbRes = await borrarTodasEvaluaciones();
            } catch (error) {
                dbError = error;
                console.error("Error al borrar evaluaciones en DB:", error);
            }

            // Seguro extra: marcar timestamp para que la UI oculte evaluaciones
            // previas aunque algunas hayan fallado por reglas.
            try {
                await borrarEvaluaciones();
            } catch (error) {
                console.error("Error al marcar evaluaciones como borradas:", error);
            }

            if (dbError) {
                toast.add({ severity: 'error', summary: 'Error', detail: `Error: ${dbError.message || dbError}`, life: 7000 });
            } else if (dbRes.failed > 0) {
                const firstErr = dbRes.sampleErrors?.[0]?.reason || 'desconocido';
                toast.add({
                    severity: 'warn',
                    summary: 'Parcial',
                    detail: `Borradas en DB: ${dbRes.cleared}. Fallidas: ${dbRes.failed} (${firstErr}). El UI se ocultó igualmente.`,
                    life: 8000
                });
            } else {
                toast.add({ severity: 'success', summary: 'Éxito', detail: `Se borraron ${dbRes.cleared} evaluaciones de la base de datos.`, life: 4000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
        }
    });
};

const confirmDeleteAsesorias = () => {
    confirm.require({
        message: '¿Estás seguro eliminar todas las asesorías deñ año pasado?',
        header: 'Confirmación de Eliminación',
        icon: 'pi pi-exclamation-triangle',
        acceptLabel: 'Sí, eliminar',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-danger',
        accept: async () => {
            try {
                await deleteOldAsesorias();
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Se ha limpiado correctamente las asesorías pasadas.', life: 3000 });
            } catch (error) {
                console.error("Error al limpiar weekSchedule:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al intentar limpiar las asesorías pasadas.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
        }
    });
};

const confirmResetTimeAndPoints = () => {
  confirm.require({
    message: '¿Estás seguro de restablecer las horas de servicio y puntos a 0 para TODOS los usuarios? Esto no se puede deshacer.',
    header: 'Confirmación de Restablecimiento',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Sí, restablecer',
    rejectLabel: 'Cancelar',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await resetAllUsersTotalTimeAndPoints({ dryRun: false });
        toast.add({ severity: 'success', summary: 'Éxito', detail: `Restablecimiento completado: ${res.updated} usuarios.`, life: 4000 });
      } catch (error) {
        console.error("Error al restablecer totalTime/points:", error);
        toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al restablecer totalTime/points.', life: 4000 });
      }
    },
    reject: () => {
      toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
    }
  });
};

const confirmResetLeaderboardPoints = () => {
  confirm.require({
    message: '¿Estás seguro de reiniciar SOLO los puntos del leaderboard a 0? Las horas, asesorías y evaluaciones se conservarán.',
    header: 'Reiniciar puntos del leaderboard',
    icon: 'pi pi-exclamation-triangle',
    acceptLabel: 'Sí, reiniciar puntos',
    rejectLabel: 'Cancelar',
    acceptClass: 'p-button-danger',
    accept: async () => {
      try {
        const res = await resetAllUsersLeaderboardPoints({ dryRun: false });
        toast.add({ severity: 'success', summary: 'Éxito', detail: `Puntos del leaderboard reiniciados: ${res.updated} usuarios.`, life: 4000 });
      } catch (error) {
        console.error("Error al reiniciar puntos del leaderboard:", error);
        toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al reiniciar los puntos del leaderboard.', life: 4000 });
      }
    },
    reject: () => {
      toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
    }
  });
};


const openUploadDialog = () => {
    displayUploadDialog.value = true;
};

const handleFileUpload = () => {
    confirm.require({
        message: '¿Estás seguro de que deseas cambiar el rol a "ex mae" para los usuarios elegibles usando el archivo Excel?',
        header: 'Confirmación de Actualización de Rol',
        icon: 'pi pi-exclamation-circle',
        acceptLabel: 'Sí, actualizar roles',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-warning',
        accept: async () => {
            try {
                if (selectedFile.value) {
                    await checkAndUpdateUserRole(selectedFile.value); 
                } else {
                    await checkAndUpdateUserRole(null);
                }
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Se han actualzado los maes inactivos a exmaes.', life: 3000 });
                displayUploadDialog.value = false; 
            } catch (error) {
                console.error("Error al actualizar roles:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al intentar actualizar los maes inactivos.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
            displayUploadDialog.value = false; 
        }
    });
};

const onFileChange = (event) => {
    selectedFile.value = event.target.files[0];
};

const closeDialog = () => {
    toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
    displayUploadDialog.value = false;
    displayAddUserDialog.value = false;
    displayUpdatePointsDialog.value = false;
};

const openAddUserDialog = () => {
    displayAddUserDialog.value = true;
};

const handleAddUser = async () => {
    if (!newMatricula.value || !newRole.value || !newStatus.value) {
        toast.add({ severity: 'warn', summary: 'Advertencia', detail: 'Todos los campos son obligatorios.', life: 3000 });
        return;
    }

    confirm.require({
        message: '¿Estás seguro de que deseas agregar mae o editar el rol del usuario con esta matrícula ?',
        header: 'Confirmación de agregar mae o editar rol',
        icon: 'pi pi-exclamation-circle',
        acceptLabel: 'Sí, agregar mae o editar rol',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-success',
        accept: async () => {
            try {
                await updateUserToMae({
                    matricula: newMatricula.value,
                    role: newRole.value,
                    status: newStatus.value
                });
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Mae agregado exitosamente.', life: 3000 });
                displayAddUserDialog.value = false; 
                newMatricula.value = '';
                newRole.value = null;
                newStatus.value = null;
            } catch (error) {
                console.error("Error al agregar mae o editar rol:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al intentar agregar mae o editar el rol.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
            displayAddUserDialog.value = false; 
        }
    });
};


const userId = ref('');
const newPoints = ref(null)

const openUpdatePointsDialog = () => {
    displayUpdatePointsDialog.value = true;
};

const handleUpdatePoints = async () => {
    if (!userId.value || newPoints.value === null) {
        toast.add({ severity: 'warn', summary: 'Advertencia', detail: 'Todos los campos son obligatorios.', life: 3000 });
        return;
    }

    confirm.require({
        message: `¿Estás seguro de que deseas actualizar los puntos de este usuario a ${newPoints.value}?`,
        header: 'Confirmación de Actualización de Puntos',
        icon: 'pi pi-exclamation-circle',
        acceptLabel: 'Sí, actualizar puntos',
        rejectLabel: 'Cancelar',
        acceptClass: 'p-button-success',
        accept: async () => {
            try {
                await updatePoints(userId.value, parseInt(newPoints.value)); 
                toast.add({ severity: 'success', summary: 'Éxito', detail: 'Puntos actualizados exitosamente.', life: 3000 });
                displayUpdatePointsDialog.value = false; 
                userId.value = '';
                newPoints.value = null; 
            } catch (error) {
                console.error("Error al actualizar puntos:", error);
                toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al intentar actualizar los puntos.', life: 3000 });
            }
        },
        reject: () => {
            toast.add({ severity: 'info', summary: 'Cancelado', detail: 'No se han realizado cambios.', life: 3000 });
            displayUpdatePointsDialog.value = false; 
        }
    });
};

</script>

<template>
    <div class="flex flex-column align-items-center gap-4 p-6 surface-ground">
        <h1 class="text-4xl font-bold text-center text-primary mb-5">Funciones especiales</h1>

        <div class="flex justify-content-center w-full">
            <Button 
                label="Eliminar horarios de los maes" 
                icon="pi pi-trash" 
                class="p-button-danger p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmDelete" 
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button 
                label="Actualizar roles de 'mae' a 'ex mae'" 
                icon="pi pi-user-edit" 
                class="p-button-warning p-button-rounded p-button-lg w-full md:w-6"
                @click="openUploadDialog" 
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button 
                label="Agregar Mae/Editar Rol" 
                icon="pi pi-user-plus" 
                class="p-button-success p-button-rounded p-button-lg w-full md:w-6"
                @click="openAddUserDialog" 
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button 
                label="Actualizar Puntos" 
                icon="pi pi-user-edit" 
                class="p-button-experience p-button-rounded p-button-lg w-full md:w-6"
                @click="openUpdatePointsDialog" 
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button
                label="Revelar evaluaciones a MAEs"
                icon="pi pi-eye"
                class="p-button-success p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmRevealEvaluaciones"
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button
                label="Borrar TODAS las evaluaciones"
                icon="pi pi-eye-slash"
                class="p-button-danger p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmDeleteAllEvaluaciones"
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button
                label="Eliminar las asesorías del semestre pasado"
                icon="pi pi-trash"
                class="p-button-danger p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmDeleteAsesorias" 
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button
                label="Reiniciar puntos del leaderboard"
                icon="pi pi-refresh"
                class="p-button-danger p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmResetLeaderboardPoints"
            />
        </div>

        <div class="flex justify-content-center w-full mt-4">
            <Button
                label="Eliminar horas y puntos de todos los usuarios" 
                icon="pi pi-refresh" 
                class="p-button-warning p-button-rounded p-button-lg w-full md:w-6"
                @click="confirmResetTimeAndPoints" 
            />
        </div>


        <!--
        <div class="flex justify-content-center w-full mt-4">
            <Button 
                label="Restablecer maes" 
                icon="pi pi-user-edit" 
               class="p-button-info p-button-rounded p-button-lg w-full md:w-6"
                @click="restartMaes" 
            />
        </div>
        -->

        <!-- Diálogo para carga de archivo -->
        <Dialog 
            v-model:visible="displayUploadDialog" 
            header="¿Estas seguro de actualizar los mae a exmae?" 
            modal 
            :style="{ width: '50vw' }" 
            :closable="true" 
            :dismissable-mask="true"
        >
            <div class="flex flex-column align-items-center gap-4">
                <input 
                    type="file" 
                    accept=".xlsx, .xls" 
                    @change="onFileChange"
                />
                <small >Este archivo es opcional. Si no se selecciona, se actualizarán los roles sin el archivo.</small>
                <Button 
                    label="Actualizar roles" 
                    icon="pi pi-check" 
                    class="p-button-success p-button-rounded"
                    @click="handleFileUpload"
                />
                <Button 
                    label="Cancelar" 
                    icon="pi pi-times" 
                    class="p-button-secondary p-button-rounded"
                    @click="closeDialog"
                />
            </div>
        </Dialog>

        <!-- Diálogo para agregar mae -->
        <Dialog 
            v-model:visible="displayAddUserDialog" 
            header="Agregar Mae o Editar Rol" 
            modal 
            :style="{ width: '50vw' }" 
            :closable="true" 
            :dismissable-mask="true"
        >
            <div class="flex flex-column align-items-center gap-4">
                <InputText 
                    v-model="newMatricula" 
                    placeholder="Ingrese matrícula"
                    class="w-full"
                />
                <Dropdown 
                    v-model="newRole" 
                    :options="roles" 
                    optionLabel="label" 
                    placeholder="Selecciona rol"
                    class="w-full"
                />
                <Dropdown 
                    v-model="newStatus" 
                    :options="statuses" 
                    optionLabel="label" 
                    placeholder="Selecciona estatus"
                    class="w-full"
                />

                <Button 
                    label="Agregar Mae o Editar Rol" 
                    icon="pi pi-check" 
                    class="p-button-success p-button-rounded"
                    @click="handleAddUser"
                />

                <Button 
                    label="Cancelar" 
                    icon="pi pi-times" 
                    class="p-button-secondary p-button-rounded"
                    @click="closeDialog"
                />
            </div>
        </Dialog>

        <!-- Diálogo para actualizar puntos -->
        <Dialog 
            v-model:visible="displayUpdatePointsDialog" 
            header="Actualizar Puntos del Usuario" 
            modal 
            :style="{ width: '50vw' }" 
            :closable="true" 
            :dismissable-mask="true"
        >
            <div class="flex flex-column align-items-center gap-4">
                <InputText 
                    v-model="userId" 
                    placeholder="Ingrese matricula del mae"
                    class="w-full"
                />
                <InputText 
                    v-model="newPoints" 
                    placeholder="Ingrese nuevos puntos"
                    class="w-full"
                />
                <Button 
                    label="Actualizar Puntos" 
                    icon="pi pi-check" 
                    class="p-button-success p-button-rounded"
                    @click="handleUpdatePoints"
                />
                <Button 
                    label="Cancelar" 
                    icon="pi pi-times" 
                    class="p-button-secondary p-button-rounded"
                    @click="closeDialog"
                />
            </div>
        </Dialog>

        <ConfirmDialog />
    </div>
</template>

<style scoped>
.surface-ground {
    background-color: var(--surface-ground, #f9fafb);
    min-height: 100vh;
}

h1 {
    color: var(--primary-color, #007bff);
}

.p-button-danger {
    background-color: #dc3545;
    border-color: #dc3545;
}

.p-button-warning {
    background-color: #ffc107;
    border-color: #ffc107;
}

.p-button-success {
    background-color: #28a745;
    border-color: #28a745;
}

.p-button-experience {
    background-color: #6f42c1; 
    border-color: #6f42c1; 
}

.p-inputtext, .p-dropdown {
    width: 100%;
    max-width: 300px;
}
</style>
