<script setup>
import { ref, onMounted } from 'vue';
import { getExperience,updateUserAchievementBadge } from '@/firebase/db/users';
import { getAsesoriasCountForUserInCurrentSemester } from '@/firebase/db/asesorias';

const users = ref([]);
const userGold = ref(null);
const asesoriasCountMap = ref({});

onMounted(async () => {
    const fetchedUsers = await getExperience();
    users.value = assignRanks(fetchedUsers);
    userGold.value = users.value[0]; // Usar .value para reasignar
    await updateUserAchievementBadge(users.value[0].uid, "11");

    // Cargar conteo de asesorías de cada usuario en paralelo
    const counts = await Promise.all(
        users.value.map(u => getAsesoriasCountForUserInCurrentSemester(u.uid))
    );
    const map = {};
    users.value.forEach((u, i) => { map[u.uid] = counts[i]; });
    asesoriasCountMap.value = map;
});

const formatHours = (totalMinutes) => {
    if (!totalMinutes) return '0h';
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return m > 0 ? `${h}h ${m}min` : `${h}h`;
};

const assignRanks = (fetchedUsers) => {
    const sortedUsers = fetchedUsers.sort((a, b) => b.points - a.points);
    
    let rankedUsers = [];
    let lastPoints = null;
    let rank = 0;

    for (const user of sortedUsers) {
        if (user.points !== lastPoints) {
            rank++;
            lastPoints = user.points;
        }
        rankedUsers.push({ ...user, rank });
    }
    
    return rankedUsers;
};

const formatName = (name) => {
  if (!name) return '';
  const words = name.split(' ');
  return words.slice(0, 2).join(' '); // Limita a dos palabras
};
</script>

<template>
    <div class="flex md:flex-row flex-column  md:mb-2">
        <div class="flex flex-column align-items-start">
            <h1 class="text-black text-5xl font-bold text-center m-0 sm:text-left mb-3">Leaderboard</h1>
            <div class="bg-white border-round-3xl p-2 px-4 flex flex-row justify-content-center">
                <img src="/assets/mundo.svg" class="mr-3 mt-1" alt="world icon" style="width: 1.5rem; height: 1.5rem;" />
                <p class="text-xl">División general</p>
            </div>
        </div>


        <div class="flex justify-content-center align-items-center	mt-6 md:mt-0 lg:flex-row gap-8 mb-6 md:mb-0  podium-container">
            <!-- <div class="podium-background"></div> -->

            <!-- Segundo lugar (Izquierda) -->
            <div v-if="users[1]" class="flex flex-column align-items-center" style="transform: translateY(20%);">
                <div class="relative">
                <img v-if="users[1].photoURL"
                    :src="users[1].photoURL"
                    alt="Foto perfil"
                    class="border-circle h-5rem w-5rem border-silver" />
                <img v-else
                    src="/assets/lego.jpg"
                    alt="default profile"
                    class="border-circle h-5rem w-5rem border-silver" />
                <div class="circle-number border-silver bg-silver ">
                    2
                </div>
                </div>
                <span class="font-bold mt-3 text-center">{{ formatName(users[1].name) }}</span>
                <span class="podium-exp">{{ users[1].points }} EXP</span>
                <div class="podium-stats">
                    <span class="stat-item">
                        <img src="/assets/grad.svg" alt="asesorías" class="stat-icon" />
                        {{ asesoriasCountMap[users[1].uid] ?? '...' }}
                    </span>
                    <span class="stat-item">
                        <img src="/assets/clock.svg" alt="horas" class="stat-icon" />
                        {{ formatHours(users[1].totalTime) }}
                    </span>
                </div>
            </div>

            <!-- Primer lugar (Centro) -->
            <div v-if="userGold" class="flex flex-column align-items-center relative" >
                <div class="relative">
                <img src="/assets/crown.svg"
                    alt="crown icon"
                    class="absolute crown-icon"
                    style="width: 2.5rem; height: 2.5rem; top: -20px;" />
                <img v-if="userGold.photoURL"
                    :src="userGold.photoURL"
                    alt="Foto perfil"
                    class="border-circle h-6rem w-6rem border-gold" />
                <img v-else
                    src="/assets/lego.jpg"
                    alt="default profile"
                    class="border-circle h-6rem w-6rem border-gold" />
                <div class="circle-numberCenter border-gold bg-gold">
                    1
                </div>
                </div>
                <span class="font-bold mt-3 text-center">{{ formatName(userGold.name) }}</span>
                <span class="podium-exp">{{ userGold.points }} EXP</span>
                <div class="podium-stats">
                    <span class="stat-item">
                        <img src="/assets/grad.svg" alt="asesorías" class="stat-icon" />
                        {{ asesoriasCountMap[userGold.uid] ?? '...' }}
                    </span>
                    <span class="stat-item">
                        <img src="/assets/clock.svg" alt="horas" class="stat-icon" />
                        {{ formatHours(userGold.totalTime) }}
                    </span>
                </div>
            </div>

            <!-- Tercer lugar (Derecha) -->
            <div v-if="users[2]" class="flex flex-column align-items-center" style="transform: translateY(20%);">
                <div class="relative">
                <img v-if="users[2].photoURL"
                    :src="users[2].photoURL"
                    alt="Foto perfil"
                    class="border-circle h-5rem w-5rem border-bronze" />
                <img v-else
                    src="/assets/lego.jpg"
                    alt="default profile"
                    class="border-circle h-5rem w-5rem border-bronze" />
                <div class="circle-number border-bronze bg-bronze">
                    3
                </div>
                </div>
                <span class="font-bold mt-3 text-center">{{ formatName(users[2].name) }}</span>
                <span class="podium-exp">{{ users[2].points }} EXP</span>
                <div class="podium-stats">
                    <span class="stat-item">
                        <img src="/assets/grad.svg" alt="asesorías" class="stat-icon" />
                        {{ asesoriasCountMap[users[2].uid] ?? '...' }}
                    </span>
                    <span class="stat-item">
                        <img src="/assets/clock.svg" alt="horas" class="stat-icon" />
                        {{ formatHours(users[2].totalTime) }}
                    </span>
                </div>
            </div>
            </div>
        </div>
<!-- Desde el 4 en adelante se supondría que es lo mejor -->
    <div class="bg-white border-round-3xl p-3">
        <ul class="list-none p-0">
            <li 
                v-for="(user, index) in users.slice(3)" 
                :key="user.uid" 
                :class="[ 
                    'flex justify-between items-center p-2 py-4',  
                    'bg-white m-1 rounded-3xl' 
                ]"
            >
                <div class="flex justify-content-center align-items-center">
                    <span class="font-semibold mr-4 ml-5" >
                        {{ user.rank }}. 
                    </span>
                    <img v-if="user.photoURL" 
                         :src="user.photoURL" 
                         alt="Foto de perfil"
                         :class="['border-circle h-4rem w-4rem']">
                    <img v-else src="/assets/lego.jpg" :class="['border-circle h-4rem w-4rem']" alt="default profile" 
                    style="width: 4rem; height: 4rem;" />
                    <div class="flex flex-column ml-3">
                        <span class="font-bold">{{ user.name }} </span>
                        <span>{{ user.career }} </span>
                    </div>
                </div>
                <div class="flex align-items-center ml-auto mr-3 stats-row">
                    <span class="stat-item">
                        <img src="/assets/grad.svg" alt="asesorías" class="stat-icon" />
                        {{ asesoriasCountMap[user.uid] ?? '...' }}
                    </span>
                    <span class="stat-item">
                        <img src="/assets/clock.svg" alt="horas" class="stat-icon" />
                        {{ formatHours(user.totalTime) }}
                    </span>
                    <span class="stat-exp">{{ user.points }} EXP</span>
                </div>
            </li>
        </ul>
    </div>
</template>

<style scoped>
/* Stats unificados (lista y podio) */
.stats-row {
    gap: 1.75rem;
    font-size: 1rem;
    font-weight: 500;
}
.stat-item {
    display: inline-flex;
    align-items: center;
    color: var(--text-color-secondary, #6b7280);
    font-size: 1rem;
    font-weight: 500;
    min-width: 3rem;
}
.stat-icon {
    width: 1.15rem;
    height: 1.15rem;
    margin-right: 0.4rem;
    opacity: 0.85;
}
.stat-exp {
    font-size: 1rem;
    font-weight: 700;
    color: var(--text-color, inherit);
    min-width: 5rem;
    text-align: right;
}
.podium-exp {
    font-size: 0.95rem;
    font-weight: 600;
    color: var(--text-color-secondary, #6b7280);
    text-align: center;
}
.podium-stats {
    display: flex;
    gap: 0.9rem;
    margin-top: 0.35rem;
    justify-content: center;
}
.podium-stats .stat-item {
    font-size: 0.85rem;
    min-width: 0;
}
.podium-stats .stat-icon {
    width: 0.95rem;
    height: 0.95rem;
    margin-right: 0.3rem;
}

.border-yellow-500 {
    border-color: #FFD700;
}
.bg-gold{
    background-color: #FFD700;
}
.border-gold {
    border: 3px solid #FFD700;
}
.border-silver {
    border: 3px solid silver; 
}
.border-photo {
    border: 1px solid #c8c8c8; 
}
.border-bronze {
    border: 3px solid #cd7f32;    
}
.circle-number {
  border-radius: 50%; 
  width: 2rem; 
  height: 2rem; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  font-size: 1rem; 
  font-weight: bold; 
  color: var(--text-color-leaderboard);
  position: absolute;
  bottom: -10px;
  left: 20px; 
}

.circle-numberCenter {
  border-radius: 50%; 
  width: 2rem; 
  height: 2rem; 
  display: flex; 
  align-items: center; 
  justify-content: center; 
  font-size: 1rem; 
  font-weight: bold; 
  color: var(--text-color-leaderboard);
  position: absolute;
  bottom: -10px;
  left: 26px; 
}

.bg-silver {
  background-color: #C0C0C0; 
}

.bg-bronze {
  background-color: #CD7F32; 
}

.podium-background {
  background-image: url('/assets/Podium.svg'); 
  mix-blend-mode: screen; 
  background-position: bottom center; 
  background-repeat: no-repeat; 
  background-size: contain; 
  position: absolute;
  inset: 0;
  z-index: -1;

}

.podium-container {
    padding-top: 38px;
  padding-bottom: 38px;
  position: relative; 
  margin-left: 0%;
}

@media (min-width: 768px) {
  .podium-container {
    margin-left: 5%;
  }
}

</style>

