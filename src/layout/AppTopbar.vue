<script setup>
import { getAuth, signOut } from "firebase/auth";
import { ref, computed, onMounted, onBeforeUnmount } from 'vue';
import { useLayout } from '@/layout/composables/layout';
import { useRouter } from 'vue-router';
import RequestNotifications from '@/components/RequestNotifications.vue';

const { layoutConfig, onMenuToggle, toggleDarkMode, isDarkTheme } = useLayout();

const outsideClickListener = ref(null);
const topbarMenuActive = ref(false);
const router = useRouter();

onMounted(() => {
    bindOutsideClickListener();
});

onBeforeUnmount(() => {
    unbindOutsideClickListener();
});

const logoUrl = computed(() => {
    return `layout/images/${layoutConfig.darkTheme.value ? 'logo-white' : 'logo-dark'}.svg`;
});

const onTopBarMenuButton = () => {
    topbarMenuActive.value = !topbarMenuActive.value;
};

const onSettingsClick = () => {
    topbarMenuActive.value = false;
    router.push('/documentation');
};

const onLogOut = () => {
    const auth = getAuth();
    topbarMenuActive.value = false;

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
    .layout-topbar .layout-topbar-menu-button {
        order: 4;
        flex-shrink: 0;
    }
}
@media (max-width: 575px) {
    .layout-topbar .layout-topbar-logo span { display: none; }
    .layout-topbar .layout-topbar-logo img { margin-right: 0; }
}
</style>


