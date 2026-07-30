<script setup>
import { ref, onMounted } from 'vue';
import { FilterMatchMode } from 'primevue/api';
import { getSubjects, addSubject, deleteSubject, upsertSubjects } from '../firebase/db/subjects';
import { getMaes } from '../firebase/db/users';
import { topOptions, areaOptions } from '@/utils/PerfilUtils';
import * as XLSX from 'xlsx';

const loading = ref(true);
const subjects = ref([]);
const showAddDialog = ref(false);
const editing = ref(false);
const importInput = ref(null);
const importing = ref(false);
const importMessage = ref('');
const importError = ref(false);

const roles = ref(["mae", "coordi", "subjectCoordi", "admin", "publi", "tec"]);

const subjectTableFilter = ref({
  global: { value: null, matchMode: FilterMatchMode.CONTAINS },
  semester: { value: null, matchMode: FilterMatchMode.EQUALS },
  area: { value: null, matchMode: FilterMatchMode.EQUALS },
  maes: { value: null, matchMode: FilterMatchMode.EQUALS },
  top: { value: null, matchMode: FilterMatchMode.EQUALS }
});

const newSubject = ref({
  id: '',
  name: '',
  area: '',
  semester: 0,
  intensiva: false,
  top: false
});

const openEditDialog = (subject) => {
  newSubject.value = { ...subject };
  editing.value = true;
  showAddDialog.value = true;
};

const openAddDialog = () => {
  newSubject.value = {
    id: '',
    name: '',
    area: '',
    semester: 0,
    intensiva: false,
    top: false
  };
  editing.value = false;
  showAddDialog.value = true;
};

const saveNewSubject = async () => {
  if (!newSubject.value.id || !newSubject.value.name) {
    alert('Faltan campos obligatorios');
    return;
  }
  
  if (!editing.value) {
    const existing = subjects.value.find(s => s.id === newSubject.value.id);
    if (existing) {
      alert('Ya existe una materia con ese ID');
      return;
    }
  }

  await addSubject(newSubject.value);

  showAddDialog.value = false;
  editing.value = false;

  subjects.value = await getSubjects();
  await countMaesPerSubject();
};

const removeSubject = async (subjectId) => {
  if (confirm('¿Estás seguro de eliminar esta materia?')) {
    await deleteSubject(subjectId);
    subjects.value = await getSubjects();
    await countMaesPerSubject();
  }
};

const countMaesPerSubject = async () => {
  const maes = await getMaes();

  const validMaes = maes.filter(mae => roles.value.includes(mae.role));

  for (let subject of subjects.value) {
    let count = 0;

    for (let mae of validMaes) {
      const teachesSubject = mae.subjects?.some(sub => sub.id === subject.id);
      if (teachesSubject) count++;
    }

    subject.maes = count;
  }
};

const getAbreviacion = (abreviacion) => {
  switch (abreviacion) {
    case 'ING': return 'bg-cyan-600';
    case 'NEG': return 'bg-blue-600';
    case 'SLD': return 'bg-teal-600';
    case 'CIS': return 'bg-red-600';
    case 'AMC': return 'bg-green-600';
    case 'ART': return 'bg-purple-600';
    default: return 'bg-blue-600';
  }
};

const parseBoolean = (value) => typeof value === 'boolean' ? value : Number(value) === 1;

const normalizeHeader = (header) => String(header ?? '').replace(/^\uFEFF/, '').trim()
  .normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

const importSubjects = async (event) => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  importing.value = true;
  importMessage.value = '';
  importError.value = false;

  try {
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: '' });
    const expectedHeaders = ['area', 'clave', 'nombre', 'semestre', 'top', 'intensiva'];
    const actualHeaders = Object.keys(rows[0] || {}).map(normalizeHeader);
    const missingHeaders = expectedHeaders.filter((header) => !actualHeaders.includes(header));
    if (missingHeaders.length) throw new Error(`Faltan las columnas: ${missingHeaders.join(', ')}`);

    const existingIds = new Set((subjects.value || []).map((subject) => String(subject.id).trim().toUpperCase()));
    const importedById = new Map();
    let invalidRows = 0;

    rows.forEach((rawRow) => {
      const row = Object.fromEntries(Object.entries(rawRow).map(([key, value]) => [normalizeHeader(key), value]));
      const id = String(row.clave ?? '').trim().toUpperCase();
      const name = String(row.nombre ?? '').trim();
      const area = String(row.area ?? '').trim().toUpperCase();
      const semester = Number(row.semestre);
      const validFlags = [row.top, row.intensiva].every((value) => typeof value === 'boolean' || [0, 1].includes(Number(value)));

      if (!id || !name || !area || !Number.isFinite(semester) || !validFlags) {
        invalidRows++;
        return;
      }

      importedById.set(id, { id, name, area, semester, top: parseBoolean(row.top), intensiva: parseBoolean(row.intensiva) });
    });

    const importedSubjects = [...importedById.values()];
    if (!importedSubjects.length) throw new Error('El archivo no contiene materias válidas. Usa 0 o 1 para Top e Intensiva.');
    const updated = importedSubjects.filter((subject) => existingIds.has(subject.id)).length;
    const created = importedSubjects.length - updated;
    await upsertSubjects(importedSubjects);
    subjects.value = await getSubjects() || [];
    await countMaesPerSubject();
    importMessage.value = `Importación terminada: ${created} creadas, ${updated} actualizadas${invalidRows ? ` y ${invalidRows} filas omitidas` : ''}.`;
  } catch (error) {
    console.error('Error al importar materias:', error);
    importError.value = true;
    importMessage.value = error.message || 'No se pudo importar el archivo.';
  } finally {
    importing.value = false;
  }
};


onMounted(async () => {
  subjects.value = await getSubjects();
  await countMaesPerSubject();
  loading.value = false;
});

</script>


<template>

    <div class="sm:flex sm:justify-content-between mb-2 sm:mb-5">
        <h1 class="text-black text-6xl font-bold text-center m-0 sm:text-left">Materias</h1>
        <div class="flex gap-2 justify-content-center mt-3 sm:mt-0">
          <input ref="importInput" type="file" accept=".csv,.xls,.xlsx" class="hidden" @change="importSubjects" />
          <Button label="Subir CSV o Excel" icon="pi pi-upload" severity="secondary" size="large" :loading="importing" @click="importInput && importInput.click()" />
          <Button label="Agregar Materia" icon="pi pi-plus-circle" severity="info" size="large" class="bg-0D294C" @click="openAddDialog" />
        </div>
    </div>

    <div class="card mb-0">
        <Message v-if="importMessage" :severity="importError ? 'error' : 'success'" :closable="true" @close="importMessage = ''" class="mb-3">
          {{ importMessage }}
        </Message>
        <div class="flex flex-col gap-2 my-4">
            <InputText v-model="subjectTableFilter['global'].value" placeholder="Buscar materia por nombre o código" class="w-full" />
            <InputText v-model="subjectTableFilter['semester'].value"  placeholder="Semestre" class="" />
            <Dropdown :options="areaOptions" option-label="label" option-value="value" v-model="subjectTableFilter['area'].value" placeholder="Área" class="" />
            <Dropdown :options="topOptions" option-label="label" option-value="value" v-model="subjectTableFilter['top'].value" placeholder="Top" class="" />
        </div>
        <DataTable :value="subjects" paginator :rows="10" :rowsPerPageOptions="[10, 25, 50, 100]"
            v-model:filters="subjectTableFilter" :globalFilterFields="['id', 'name', 'semester', 'area', 'top']">
            <template #empty>No se encontraron resultados.</template>
            <Column header="Materia">
              <template #body="slotProps">
                <div class="flex">
                  <i v-if="slotProps.data.top" class="pi pi-star-fill mr-3" style="color: gold;"></i>
                  <div style="display: flex; flex-direction: column;">
                    <span class="text-base font-medium text-gray-900 mr-1">{{ slotProps.data.name }}</span>
                    <span class="text-sm text-gray-500">{{ slotProps.data.id }}</span>
                  </div>
                </div>
              </template>
            </Column>
            <Column field="maes" header="Maes"></Column>
            <Column field="semester" header="Semestre"></Column>
            <Column header="Área">
              <template #body="slotProps">
                <span class="text-white text-sm font-semibold py-1 px-3 !rounded-full" :class="getAbreviacion(slotProps.data.area)">
                  {{ slotProps.data.area }}
                </span>
              </template>
            </Column>
            <Column header="Acciones" style="min-width: 10rem">
                <template #body="slotProps">
                    <Button icon="pi pi-pencil" class="p-button-text p-button-sm" @click="openEditDialog(slotProps.data)" />
                    <Button icon="pi pi-trash" class="p-button-text p-button-sm p-button-danger" @click="removeSubject(slotProps.data.id)" />
                </template>
            </Column>
        </DataTable>
    </div>

    <Dialog v-model:visible="showAddDialog" modal :header="editing ? 'Editar Materia' : 'Agregar Materia'" :style="{ width: '500px' }">
        <div class="p-fluid w-full">
            <div class="flex gap-2">
                <div class="field w-full">
                    <label for="id">Clave</label>
                    <InputText id="id" v-model="newSubject.id" placeholder="F1001B" required :disabled="editing" />
                </div>
                <div class="field w-full">
                    <label for="name">Nombre</label>
                    <InputText id="name" v-model="newSubject.name" placeholder="Modelación de la Fisica" required />
                </div>
            </div>
            <div class="flex gap-2 w-full">
                <div class="field w-full">
                    <label for="area">Área</label>
                    <Dropdown :options="areaOptions" option-label="label" option-value="value" v-model="newSubject.area" placeholder="Selecciona un área" required />
                </div>
                <div class="field w-full">
                    <label for="semester">Semestre</label>
                    <InputNumber id="semester" v-model="newSubject.semester" :min="0" :max="8" required />
                </div>
            </div>
            <div class="flex gap-2 w-full">
                <div class="field w-full">
                    <label for="intensiva">Intensiva</label>
                    <ToggleButton v-model="newSubject.intensiva" onLabel="Intensiva" offLabel="No" onIcon="pi pi-check" offIcon="pi pi-times" class="w-full" />
                </div>
                <div class="field w-full">
                    <label for="top">Top</label>
                    <ToggleButton v-model="newSubject.top" onLabel="Top" offLabel="No" onIcon="pi pi-star-fill" offIcon="pi pi-star" class="w-full" />
                </div>
            </div>
        </div>

        <template #footer>
            <Button label="Guardar" icon="pi pi-check" @click="saveNewSubject" />
        </template>
        </Dialog>

    
</template>
