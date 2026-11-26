<script setup>
import { getAuth, signOut } from "firebase/auth";
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useLayout } from '@/layout/composables/layout';
import { useRoute, useRouter } from 'vue-router';
import RequestNotifications from '@/components/RequestNotifications.vue';
import { useTutorial, resetTutorialSession } from '@/tutorial/useTutorial';

const { layoutConfig, onMenuToggle, toggleDarkMode, isDarkTheme } = useLayout();
const route = useRoute();
const { startMenuTour, startPageTour, hasPageTour } = useTutorial();
const tutorialMenu = ref(null);
const tutorialItems = computed(() => [
    {
        label: 'Guía de esta página',
        icon: 'pi pi-map',
        disabled: !hasPageTour(route.name),
        command: () => startPageTour(route.name)
    },
    { label: 'Recorrido del menú', icon: 'pi pi-bars', command: () => startMenuTour() }
]);
const toggleTutorialMenu = (event) => tutorialMenu.value?.toggle(event);

const outsideClickListener = ref(null);
const topbarMenuActive = ref(false);
const router = useRouter();

onMounted(() => {
    bindOutsideClickListener();
});

onBeforeUnmount(() => {
    unbindOutsideClickListener();
});

const onTopBarMenuButton = () => {
    topbarMenuActive.value = !topbarMenuActive.value;
};

const onLogOut = () => {
    const auth = getAuth();
    topbarMenuActive.value = false;
    resetTutorialSession();

    signOut(auth).then(() => {
        router.push('/');
    }).catch((error) => {
        alert('Ocurrió un error al tratar de cerrar su sesión');
        console.error(error)
    });
    
};

const topbarMenuClasses = computed(() => {
    return {
        'layout-topbar-menu-mobile-active': topbarMenuActive.value
    };
});

const bindOutsideClickListener = () => {
    if (!outsideClickListener.value) {
        outsideClickListener.value = (event) => {
            if (isOutsideClicked(event)) {
                topbarMenuActive.value = false;
            }
        };
        document.addEventListener('click', outsideClickListener.value);
    }
};
const unbindOutsideClickListener = () => {
    if (outsideClickListener.value) {
        document.removeEventListener('click', outsideClickListener);
        outsideClickListener.value = null;
    }
};
const isOutsideClicked = (event) => {
    if (!topbarMenuActive.value) return;

    const sidebarEl = document.querySelector('.layout-topbar-menu');
    const topbarEl = document.querySelector('.layout-topbar-menu-button');

    return !(sidebarEl.isSameNode(event.target) || sidebarEl.contains(event.target) || topbarEl.isSameNode(event.target) || topbarEl.contains(event.target));
};

</script>

<template>
    <div class="layout-topbar">
        <router-link to="/" class="layout-topbar-logo">
            <img :src="`/layout/images/${layoutConfig.darkTheme.value ?  'maes-dark.png' : 'logo-maes.svg'}`" alt="logo" />
            <span>Dashboard</span>
        </router-link>

        <!-- Este botón solo será visible en pantallas pequeñas -->
        <button class="p-link layout-menu-button layout-topbar-button block lg:hidden" @click="onMenuToggle()">
            <i class="pi pi-bars"></i>
        </button>

        <RequestNotifications class="ml-auto" />
        <button
            class="p-link layout-topbar-button tutorial-button"
            data-tour="tutorial-button"
            aria-label="Ayuda y tutoriales"
            aria-haspopup="true"
            v-tooltip.bottom="'Ayuda'"
            @click="toggleTutorialMenu"
        >
            <i class="pi pi-question-circle"></i>
        </button>
        <Menu ref="tutorialMenu" :model="tutorialItems" :popup="true" style="min-width: 14rem" />
        <button class="p-link layout-topbar-menu-button layout-topbar-button" @click="onTopBarMenuButton()">
            <i class="pi pi-ellipsis-v"></i>
        </button>
       
        <div class="layout-topbar-menu" :class="topbarMenuClasses">
            <button @click="toggleDarkMode()" class="p-link layout-topbar-button">
                <i :class="isDarkTheme ? 'pi pi-sun' : 'pi pi-moon'"></i>
                <span>{{ isDarkTheme ? 'Modo claro' : 'Modo oscuro' }}</span>
            </button>
            <button @click="onLogOut()" class="p-link layout-topbar-button">
                <i class="pi pi-sign-out"></i>
                <span>Log out</span>
            </button>
        </div>
    </div>
</template>

<style lang="scss" scoped>
// The bell already pushes right with ml-auto; keep the menu beside it instead of splitting the space.
@media (min-width: 992px) {
    .layout-topbar .layout-topbar-menu {
        margin-left: 0;
    }
}
@media (max-width: 991px) {
    .layout-topbar {
        padding: 0 1rem;
        gap: 0.25rem;
    }
    .layout-topbar .request-notifications {
        order: 3;
        margin-left: auto !important;
        flex-shrink: 0;
    }
    .layout-topbar .tutorial-button {
        order: 3;
        flex-shrink: 0;
    }
    .layout-topbar .layout-topbar-menu-button {
        order: 4;
        flex-shrink: 0;
    }
}
.layout-topbar .tutorial-button i {
    font-size: 1.5rem;
}
@media (max-width: 575px) {
    .layout-topbar .layout-topbar-logo span { display: none; }
    .layout-topbar .layout-topbar-logo img { margin-right: 0; }
}
</style>


