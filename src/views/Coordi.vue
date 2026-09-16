<script setup>
import { getSubjectColor } from '@/utils/CoordiUtils';
import { ref, onMounted, watch } from 'vue';
import { useToast } from 'primevue/usetoast';
import { getTodaysMae, getUser, incrementTotalTime, getCurrentUser } from '@/firebase/db/users';
import { addRegister, getTodaysReport, updateReport, updateReportByDate, getReportByDate } from '../firebase/db/attendance';
import { getUsersWithActiveSession, updatePoints } from '@/firebase/db/users';
import { nextTick } from 'vue';
import { getAttendancePointsDelta } from '@/utils/PointsUtils';

const toast = useToast();
const loading = ref(true);
const maes = ref(null);
const report = ref(null);
const userInfo = ref(null);
const ubicacion = ref(true);

const currentDay = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];
const options = ref([
    { name: 'Asistencia', code: 'A' },
    { name: 'Falta', code: 'F' },
    { name: 'Retraso', code: 'R' },
    { name: 'Justificado', code: 'J' },
]);

// Calcula la distancia entre dos puntos geográficos usando la fórmula de Haversine
const toRadians = (degree) => degree * (Math.PI / 180);

const calculateDistance = (lat1, lon1, lat2, lon2) => {
    const R = 6371000; // Radio de la Tierra en metros
    const φ1 = toRadians(lat1);
    const φ2 = toRadians(lat2);
    const Δφ = toRadians(lat2 - lat1);
    const Δλ = toRadians(lon2 - lon1);

    const a = Math.sin(Δφ / 2) * Math.sin(Δφ / 2) +
              Math.cos(φ1) * Math.cos(φ2) *
              Math.sin(Δλ / 2) * Math.sin(Δλ / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
};

const checkLocationAndAttendance = () => {
  const fixedLat = 25.650472; 
  const fixedLon = -100.289667;

  return new Promise((resolve, reject) => {
    if (userInfo.value.role == 'admin' || userInfo.value.role == 'coordi' ) {
      if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition((position) => {
          const userLat = position.coords.latitude;
          const userLon = position.coords.longitude;

          const distance = calculateDistance(userLat, userLon, fixedLat, fixedLon);
            
          if (distance <= 15) {
            console.log('El usuario está dentro del rango de 15 metros. Puede registrar asistencia.');
            console.log(distance)
            ubicacion.value = true;
            resolve(true);
          } else {
            console.log('El usuario está fuera del rango de 15 metros. No puede registrar asistencia.');
            console.log(distance)
            // toast.add({ 
            //     severity: 'error', 
            //     summary: 'Error', 
            //     detail: 'No se puede poner asistencia estas fuera de rango ', 
            //     life: 5000 
            // });
            ubicacion.value = true;
            resolve(true);
          }
        }, (error) => {
          // No se bloquea el registro: solo se avisa en consola y se continua
          console.warn("Error al obtener la ubicación: ", error);
          ubicacion.value = true;
          resolve(true);
        }, { timeout: 10000, maximumAge: 60000 }); // sin timeout la promesa se puede quedar colgada
      } else {
        console.warn("La geolocalización no está disponible en este navegador.");
        ubicacion.value = true;
        resolve(true);
      }
    } else {
      console.log('El usuario es admin y no requiere comprobación de ubicación.');
      ubicacion.value = true;
      console.log(ubicacion.value, "ubicacion")
      resolve(true);
    }
  });
};

const handlePointsUpdate = async (uid, previousAttendance, newAttendance, showToast = true) => {
    const pointsDelta = getAttendancePointsDelta(previousAttendance, newAttendance);
    if (pointsDelta !== 0) {
        await updatePoints(uid, pointsDelta);
    }
    if (showToast) {
        toast.add({ severity: 'success', summary: 'Se ha actualizado su asistencia ', detail: 'Se ha actualizo de forma correcta', life: 3000 });
    }
};

const showDialogRegister = ref(false);
const showDialogReponer = ref(false);
const maeId = ref('');
const hours = ref(0);
const date = ref(new Date());
const maeInfo = ref(null);
const activeMAEs = ref([]);
const initialReport = ref(null);

// Se guarda por fila con el MAE que disparo el cambio, en vez de un watch profundo
// que dependia de selectedId (se perdian cambios al marcar varios MAEs seguidos)
const handleAttendanceChange = async (mae, newAttendanceValue) => {
    if (!mae || !newAttendanceValue || !initialReport.value) {
        return;
    }

    const previousAttendance = initialReport.value[mae.uid];
    if (previousAttendance === newAttendanceValue) {
        return;
    }

    if (!userInfo.value) {
        console.error('userInfo is undefined');
        report.value[mae.uid] = previousAttendance ?? null;
        return;
    }

    if (mae.uid === userInfo.value.uid && mae.role === "coordi") {
        toast.add({
            severity: 'error',
            summary: 'Error',
            detail: 'No te puedes poner autoasistencia',
            life: 5000
        });
        report.value[mae.uid] = previousAttendance ?? null;
        return;
    }

    try {
        await updateReport(mae, newAttendanceValue);
        initialReport.value[mae.uid] = newAttendanceValue;
    } catch (error) {
        console.error('Error al guardar la asistencia: ', error);
        // Se revierte para que la tabla no muestre una asistencia que no quedo guardada
        report.value[mae.uid] = previousAttendance ?? null;
        toast.add({
            severity: 'error',
            summary: 'No se guardó la asistencia',
            detail: error?.code === 'permission-denied'
                ? `Tu cuenta no tiene permiso para registrar la asistencia de ${mae.name}. Avisa al equipo técnico.`
                : `No se pudo guardar la asistencia de ${mae.name}. Intenta de nuevo.`,
            life: 6000
        });
        return;
    }

    // Los puntos van aparte: si fallan, la asistencia ya quedo guardada y no se revierte
    try {
        await handlePointsUpdate(mae.uid, previousAttendance, newAttendanceValue);
    } catch (error) {
        console.error('Error al actualizar puntos: ', error);
        toast.add({
            severity: 'warn',
            summary: 'Asistencia guardada',
            detail: 'La asistencia se guardó, pero no se pudieron actualizar los puntos.',
            life: 5000
        });
    }
};

const reponerMaeId = ref('');
const reponerMaeInfo = ref(null);
const reponerDate = ref(null);
const reponerAttendance = ref(null);
const reponerCurrentReport = ref(null);
const reponerOptions = ref([
    { name: 'Asistencia', code: 'A' },
    { name: 'Falta', code: 'F' },
    { name: 'Retraso', code: 'R' },
    { name: 'Justificado', code: 'J' },
]);

watch(maeId, async (newValue) => {
    if (newValue.length === 9) {
        maeInfo.value = await getUser(maeId.value.toLowerCase().trim());
    }
});

watch(reponerMaeId, async (newValue) => {
    if (newValue.length === 9) {
        reponerMaeInfo.value = await getUser(reponerMaeId.value.toLowerCase().trim());
    } else {
        reponerMaeInfo.value = null;
    }
    reponerCurrentReport.value = null;
});

watch([reponerDate, reponerMaeInfo], async ([date, mae]) => {
    if (date && mae) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        const dateString = `${y}-${m}-${d}`;
        const dayReport = await getReportByDate(dateString);
        const record = dayReport[mae.uid];
        reponerCurrentReport.value = record ? record.report : null;
    } else {
        reponerCurrentReport.value = null;
    }
});

const reponerAsistencia = async () => {
    try {
        await updateReportByDate(reponerMaeInfo.value, reponerDate.value, reponerAttendance.value);
        await handlePointsUpdate(reponerMaeInfo.value.uid, reponerCurrentReport.value, reponerAttendance.value, false);
        toast.add({ severity: 'success', summary: 'Asistencia repuesta', detail: `Se marcó ${reponerAttendance.value === 'A' ? 'Asistencia' : reponerAttendance.value === 'R' ? 'Retraso' : 'Justificado'} para ${reponerMaeInfo.value.name}`, life: 3000 });
        reponerMaeId.value = '';
        reponerMaeInfo.value = null;
        reponerDate.value = null;
        reponerAttendance.value = null;
        reponerCurrentReport.value = null;
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al reponer la asistencia', life: 5000 });
    }
    showDialogReponer.value = false;
};

const addTime = async () => {
    try {
        await incrementTotalTime(maeId.value.toLowerCase().trim(), hours.value);
        toast.add({ severity: 'success', summary: 'Guardado exitoso', detail: 'Se agregó el tiempo al MAE seleccionado', life: 3000 });
        maeInfo.value = null;
        maeId.value = '';
        hours.value = 0;
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al tratar de guardar los cambios', life: 5000 });
    }

    showDialogRegister.value = false;
};

const addReport = async () => {
    try {
        await addRegister(maeInfo.value, date.value);
        toast.add({ severity: 'success', summary: 'Guardado exitoso', detail: 'Se generó el registro del MAE seleccionado', life: 3000 });
    } catch (error) {
        toast.add({ severity: 'error', summary: 'Error', detail: 'Ocurrió un error al tratar de guardar los cambios', life: 5000 });
    }
    showDialogRegister.value = false;
};

onMounted(async () => {
    try {
        userInfo.value = await getCurrentUser();
        activeMAEs.value = await getUsersWithActiveSession(); 
        maes.value = await getTodaysMae(); 
        report.value = await getTodaysReport(); 
        initialReport.value = JSON.parse(JSON.stringify(report.value)); 
        await checkLocationAndAttendance();
        maes.value.forEach(mae => {
            const scheduleToday = mae.weekSchedule[currentDay];
            if (scheduleToday) {        
                scheduleToday.forEach(({ start, end }) => {
                    handleAutoMarkAbsence(start, end, mae.uid).catch((error) => console.error('Error en marca automática: ', error));
                });
            }
        });
    } catch (error) {
        console.error('Error al cargar datos:', error);
    } finally {
        loading.value = false;
    }
});

// Marca automatica; si el guardado falla se revierte para no mostrar algo que no quedo en Firebase
const applyAutoAttendance = async (uid, newValue) => {
    const maeInfo = maes.value.find(mae => mae.uid === uid);
    if (!maeInfo) {
        return;
    }

    const previousAttendance = report.value[uid];
    report.value[uid] = newValue;

    try {
        await updateReport(maeInfo, newValue);
        initialReport.value[uid] = newValue;
    } catch (error) {
        console.error('Error al marcar asistencia automática: ', error);
        report.value[uid] = previousAttendance ?? null;
        return;
    }

    try {
        await handlePointsUpdate(uid, previousAttendance, newValue, false);
    } catch (error) {
        console.error('Error al actualizar puntos en marca automática: ', error);
    }

    await nextTick();
};

const handleAutoMarkAbsence = async (startTime, endTime, uid) => {
    const now = new Date();
    const [startHour, startMinute] = startTime.split(':').map(Number);
    const [endHour, endMinute] = endTime.split(':').map(Number);
    const startDateTime = new Date();
    const endDateTime = new Date();
    startDateTime.setHours(startHour, startMinute, 0, 0);
    endDateTime.setHours(endHour, endMinute, 0, 0);
    const diffInMinutes = (now - startDateTime) / 60000;
    const activo = activeMAEs.value.some(mae => mae.uid === uid);

    if (activo && diffInMinutes > 45 && now < endDateTime && report.value[uid] === 'F') {
        await applyAutoAttendance(uid, 'R');
    }
    if (activo && diffInMinutes > 20 && diffInMinutes < 40 && report.value[uid] !== 'A' &&
        report.value[uid] !== 'J' &&
        report.value[uid] !== 'R' &&
        report.value[uid] !== 'F') {
        await applyAutoAttendance(uid, 'A');
    }
    if (
        diffInMinutes > 40 &&
        report.value[uid] !== 'A' &&
        report.value[uid] !== 'J' &&
        report.value[uid] !== 'R' &&
        report.value[uid] !== 'F'
        &&
        report.value[uid] !== 'C'
      ) {
        await applyAutoAttendance(uid, 'F');
      }

};

</script>

<template>
    <div class="sm:flex sm:justify-content-between mb-2 sm:mb-5">
        <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Asistencia</h1>
        <div class="flex gap-2">
            <Button @click="showDialogReponer = true" label="Reponer asistencia" icon="pi pi-calendar-plus" size="large" class="max-h-full w-full sm:w-fit" />
            <Button @click="showDialogRegister = true" label="Agregar horas" icon="pi pi-pencil" size="large" class="max-h-full w-full sm:w-fit" />
        </div>
    </div>
    <div class="card mb-0">

        <DataTable :value="maes" paginator :rows="50" dataKey="id" 
            :loading="loading" class="border-round-xl"
            responsiveLayout="stack" breakpoint="640px"
            >
            <template #empty>No se encontraron Maes.</template>
            <template #loading>Cargando información. Por favor espera.</template>

            <Column header="Matricula" field="uid" style="min-width: 8rem">
                <template #body="{ data }">
                    <a :href="`#/mae/${data.uid}`" class="text-lg uppercase cursor-pointer font-semibold underline text-primary">{{ data.uid }}</a>
                </template>
            </Column>

            <Column header="Nombre" field="name" style="min-width: 10rem">
                <template #body="{ data }">
                    <p class="text-lg font-semibold">{{ data.name }}</p>
                </template>
            </Column>

            <Column header="Carrera" field="name" style="min-width: 5rem">
                <template #body="{ data }">
                    <div :class="`flex border-round-3xl px-2 ${getSubjectColor(data.area)}`">
                        <p class="text-lg p-1 mx-auto text-white md:text-md text-xs text-center w-full md:w-fi ">
                            {{ data.career }}
                        </p>
                    </div>
                </template>
            </Column>

            <Column header="Horario" style="min-width: 6rem">
                <template #body="{ data }">
                    <div class="flex flex-wrap justify-content-evenly column-gap-2 row-gap-2">
                        <Tag v-for="(value, key) in data.weekSchedule[currentDay]" class="text-md mx-auto py-2 "
                            :value="`${value.start} - ${value.end} `"
                            rounded style="min-width: 6rem"/>
                    </div>
                </template>
            </Column>

            <Column header="Estado" style="min-width: 6rem; text-align: center;">
                <template #body="{ data }">            
                    <span :class="{'status-dot': true, 
                    'active': activeMAEs.some(mae => mae.uid === data.uid),
                     'inactive': !activeMAEs.some(mae => mae.uid === data.uid) }"></span>                   
                </template>
            </Column>

            <Column header="Asistencia" style="min-width:8rem">
                <template #body="{ data }">
                    <Dropdown 
                        @change="handleAttendanceChange(data, $event.value)"
                        v-if="report" 
                        v-model="report[data.uid]" 
                        :options="options" 
                        optionLabel="name" 
                        optionValue="code" 
                        placeholder="Selecciona asistencia" 
                        class="md:w-full max-w-1"
                        :class="{
                            'attendance-green': report[data.uid] === 'A',
                            'attendance-red': report[data.uid] === 'F',
                            'attendance-yellow': report[data.uid] === 'R',
                            'attendance-blue': report[data.uid] === 'J'
                        }"
                        :disabled="!ubicacion " 
                        
                    />

                </template>
            </Column>
        </DataTable>
    </div>
    <!-- Agregar horas al MAE -->
    <Dialog v-model:visible="showDialogRegister" modal header="Crear registro" class="md:w-4">
        
        <p class="font-bold text-lg">Matricula del MAE</p>
        <InputText class="w-full" placeholder="A01234567" v-model="maeId"/>
        <Message  v-if="maeInfo">MAE: {{ maeInfo.name }} - {{ maeInfo.email }}</Message>

        <p class="font-bold text-lg mt-4">Agregar horas</p>
        <p>Selecciona un MAE para agregar horas a su registro si se le olvidó cerrar su sesión</p>
        <InputNumber class="w-full mb-2" v-model="hours" inputId="integeronly" suffix=" hrs" />
        <div class="flex justify-content-end">
            <Button @click="addTime" type="button" label="Agregar horas" :disabled="maeInfo == null || !hours"></Button>
        </div>

        <p class="font-bold">Registrar sesión</p>
        <p>Agrega un registro adicional a la asistencia si hay un MAE reponiendo horas</p>
        <Calendar class="w-full mb-2" v-model="date" />
        <div class="flex justify-content-end mb-2">
            <Button @click="addReport" type="button" label="Registrar sesión" :disabled="maeInfo == null || !date"></Button>
        </div>

        <div class="flex justify-content-end">
            <Button type="button" label="Cerrar" severity="secondary" @click="showDialogRegister = false"></Button>
        </div>
    </Dialog>

    <!-- Reponer asistencia -->
    <Dialog v-model:visible="showDialogReponer" modal header="Reponer asistencia" class="md:w-4">
        <p class="font-bold text-lg">Matrícula del MAE</p>
        <InputText class="w-full" placeholder="A01234567" v-model="reponerMaeId"/>
        <Message v-if="reponerMaeInfo">MAE: {{ reponerMaeInfo.name }} - {{ reponerMaeInfo.email }}</Message>

        <p class="font-bold text-lg mt-4">Fecha a reponer</p>
        <Calendar class="w-full mb-2" v-model="reponerDate" dateFormat="dd/mm/yy" :maxDate="new Date()" placeholder="Selecciona una fecha" />
        <small v-if="reponerCurrentReport && reponerMaeInfo" class="text-500">
            Registro actual: <span class="font-semibold" :class="{
                'text-green-600': reponerCurrentReport === 'A',
                'text-red-600': reponerCurrentReport === 'F',
                'text-yellow-600': reponerCurrentReport === 'R',
                'text-blue-600': reponerCurrentReport === 'J'
            }">{{ reponerCurrentReport === 'A' ? 'Asistencia' : reponerCurrentReport === 'F' ? 'Falta' : reponerCurrentReport === 'R' ? 'Retraso' : reponerCurrentReport === 'J' ? 'Justificado' : reponerCurrentReport }}</span>
        </small>
        <small v-else-if="reponerDate && reponerMaeInfo && reponerCurrentReport === null" class="text-500">
            Sin registro para esta fecha
        </small>

        <p class="font-bold text-lg mt-2">Tipo de asistencia</p>
        <Dropdown class="w-full mb-4" v-model="reponerAttendance" :options="reponerOptions" optionLabel="name" optionValue="code" placeholder="Selecciona tipo" />

        <div class="flex justify-content-end gap-2">
            <Button type="button" label="Cerrar" severity="secondary" @click="showDialogReponer = false" />
            <Button @click="reponerAsistencia" type="button" label="Reponer asistencia" :disabled="!reponerMaeInfo || !reponerDate || !reponerAttendance" />
        </div>
    </Dialog>
</template>

<style>
.attendance-green {
    background-color: #d4edda;
    color: #155724;
}

.attendance-red {
    background-color: #f8d7da;
    color: #721c24;
}

.attendance-yellow {
    background-color: #fff3cd;
    color: #856404;
}

.attendance-blue {
    background-color: #cce5ff;
    color: #004085;
}

.status-dot {
    display: inline-block;
    width: 12px;
    height: 12px;
    border-radius: 50%;
}

.active {
    background-color: #28a745;
}

.inactive {
    background-color: #6c757d; 
}
</style>
