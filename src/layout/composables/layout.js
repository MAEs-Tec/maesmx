import { toRefs, reactive, computed } from 'vue';

const savedDark = localStorage.getItem('darkTheme') === 'true';

// Apply dark class to html+body on init (for portaled overlays like Dialog, Dropdown)
if (savedDark) {
    document.documentElement.classList.add('app-dark');
    document.body.classList.add('app-dark');
}

const layoutConfig = reactive({
    ripple: true,
    darkTheme: savedDark,
    inputStyle: 'outlined',
    menuMode: 'static',
    theme: savedDark ? 'tailwind-dark' : 'tailwind-light',
    scale: 14,
    activeMenuItem: null
});

const layoutState = reactive({
    staticMenuDesktopInactive: false,
    overlayMenuActive: false,
    profileSidebarVisible: false,
    configSidebarVisible: false,
    staticMenuMobileActive: false,
    menuHoverActive: false
});

export function useLayout() {
    const changeThemeSettings = (theme, darkTheme) => {
        layoutConfig.darkTheme = darkTheme;
        layoutConfig.theme = theme;
    };

    const toggleDarkMode = () => {
        const newDark = !layoutConfig.darkTheme;
        const newTheme = newDark ? 'tailwind-dark' : 'tailwind-light';

        const themeLink = document.getElementById('theme-css');
        const newHref = `/themes/${newTheme}/theme.css`;

        const cloneLinkElement = themeLink.cloneNode(true);
        cloneLinkElement.setAttribute('href', newHref);
        cloneLinkElement.addEventListener('load', () => {
            themeLink.remove();
        });
        themeLink.parentNode.insertBefore(cloneLinkElement, themeLink.nextSibling);

        layoutConfig.darkTheme = newDark;
        layoutConfig.theme = newTheme;
        localStorage.setItem('darkTheme', newDark.toString());

        // Toggle class on html+body for portaled overlays (Dialog, Dropdown, etc.)
        if (newDark) {
            document.documentElement.classList.add('app-dark');
            document.body.classList.add('app-dark');
        } else {
            document.documentElement.classList.remove('app-dark');
            document.body.classList.remove('app-dark');
        }
    };

    const setScale = (scale) => {
        layoutConfig.scale = scale;
    };

    const setActiveMenuItem = (item) => {
        layoutConfig.activeMenuItem = item.value || item;
    };

    const onMenuToggle = () => {
        if (layoutConfig.menuMode === 'overlay') {
            layoutState.overlayMenuActive = !layoutState.overlayMenuActive;
        }

        if (window.innerWidth > 991) {
            layoutState.staticMenuDesktopInactive = !layoutState.staticMenuDesktopInactive;
        } else {
            layoutState.staticMenuMobileActive = !layoutState.staticMenuMobileActive;
        }
    };

    const isSidebarActive = computed(() => layoutState.overlayMenuActive || layoutState.staticMenuMobileActive);

    const isDarkTheme = computed(() => layoutConfig.darkTheme);

    return { layoutConfig: toRefs(layoutConfig), layoutState: toRefs(layoutState), changeThemeSettings, toggleDarkMode, setScale, onMenuToggle, isSidebarActive, isDarkTheme, setActiveMenuItem };
}
