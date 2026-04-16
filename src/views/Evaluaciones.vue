<script setup>
import { ref, onMounted } from 'vue';
import { getCurrentUser } from '../firebase/db/users';
import { getEvaluacionesRecibidas } from '../firebase/db/asesorias';
import { getEvaluationsRevealedAt } from '../firebase/db/settings';
import { getSubjectColor } from '@/utils/HorarioUtils';

const userInfo = ref(null);
const asesorias = ref([]);
const isLoading = ref(true);
const revealedAt = ref(null);

const emojiList = [
  "Astonished Face.svg",
  "Beaming Face with Smiling Eyes.svg",
  "Cowboy Hat Face.svg",
  "Face Savoring Food.svg",
  "Face with Tongue-1.svg",
  "Face with Tongue.svg",
  "Grinning Face with Big Eyes.svg",
  "Grinning Face with Smiling Eyes.svg",
  "Grinning Face.svg",
  "Grinning Squinting Face.svg",
  "Nerd Face.svg",
  "Relieved Face.svg",
  "Slightly Smiling Face.svg",
  "Smiling Face with Halo.svg",
  "Smiling Face with Heart-Eyes.svg",
  "Smiling Face with Hearts.svg",
  "Smiling Face with Smiling Eyes-1.svg",
  "Smiling Face with Smiling Eyes.svg",
  "Smiling Face with Sunglasses.svg",
  "Star-Struck.svg",
  "Winking Face with Tongue.svg"
];

const getEmoji = (id) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = ((hash << 5) - hash) + id.charCodeAt(i);
    hash |= 0;
  }
  return `/assets/emojis/${emojiList[Math.abs(hash) % emojiList.length]}`;
};

const recargar = async () => {
  asesorias.value = await getEvaluacionesRecibidas(userInfo.value.uid, revealedAt.value);
};

onMounted(async () => {
  userInfo.value = await getCurrentUser();
  revealedAt.value = await getEvaluationsRevealedAt();
  await recargar();
  isLoading.value = false;
});
</script>

<template>
  <div>
    <div class="mb-5">
      <h1 class="text-6xl font-bold text-center sm:text-left m-0">Mis evaluaciones</h1>
    </div>

    <div v-if="isLoading" class="text-center">
      <ProgressSpinner style="width: 60px; height: 60px;" strokeWidth="6" fill="var(--surface-ground)" />
    </div>

    <div v-else-if="!asesorias.length" class="text-center mt-6">
      <i class="pi pi-inbox text-6xl text-color-secondary mb-3" style="display: block;"></i>
      <p class="text-lg text-color-secondary">Aún no tienes evaluaciones</p>
      <p class="text-sm text-color-secondary">Cuando un admin revele las evaluaciones, aparecerán aquí</p>
    </div>

    <div v-else class="flex flex-wrap gap-4">
      <div
        v-for="asesoria in asesorias"
        :key="asesoria.id"
        class="flex border-round-3xl w-full md:w-5 eval-card overflow-hidden"
      >
        <div class="border-color-bar" :class="getSubjectColor(asesoria.subject?.area)"></div>

        <div class="flex flex-column w-full p-3 gap-2">
          <div class="flex align-items-center gap-3">
            <img
              :src="getEmoji(asesoria.id)"
              alt="emoji"
              style="width: 3rem; height: 3rem;"
            />

            <div class="flex-1">
              <p class="font-bold m-0">Estudiante anónimo</p>
              <p class="text-sm text-color-secondary m-0">
                {{ asesoria.subject?.id || '' }}
                <span v-if="asesoria.subject?.name"> · {{ asesoria.subject.name }}</span>
              </p>
            </div>
          </div>

          <div class="flex align-items-center gap-2">
            <Rating :modelValue="asesoria.rating" :readonly="true" :cancel="false" />
          </div>

          <p v-if="asesoria.comment?.trim()" class="m-0 text-color-secondary font-italic comentario">
            "{{ asesoria.comment }}"
          </p>
        </div>
      </div>
    </div>

  </div>
</template>

<style scoped>
.eval-card {
  border: 1px solid var(--surface-border, #e5e7eb);
  background: var(--surface-card, #ffffff);
  transition: box-shadow 0.2s;
}
.eval-card:hover {
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.08);
}
.border-color-bar {
  width: 0.75rem;
  min-height: 100%;
  flex-shrink: 0;
}
.comentario {
  max-height: 80px;
  overflow-y: auto;
  padding-right: 0.5rem;
  line-height: 1.4;
}
</style>
