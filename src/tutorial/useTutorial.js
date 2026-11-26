// Recorridos guiados con driver.js: el del menú (automático la primera vez) y la
// guía de cada página (botón ? de la barra superior). Los textos están en tours.js.
import { driver } from 'driver.js';
import 'driver.js/dist/driver.css';
import './tutorial.css';
import { getAuth } from 'firebase/auth';
import { getClaimsRole } from '@/auth/roles';
import { getCurrentUser, markTutorialsSeen } from '@/firebase/db/users';
import { useLayout } from '@/layout/composables/layout';
import { buildMenuSteps, buildPageSteps, hasPageTour, pendingMenuKeys, seenUpdate, TUTORIAL_VERSION } from './tours';

const MOBILE_QUERY = '(max-width: 991px)';
let activeTour = null;
let autoChecked = false;

function currentMatricula() {
    const email = getAuth().currentUser?.email ?? '';
    const at = email.indexOf('@');
    return at > 0 ? email.slice(0, at) : null;
}

// Respaldo local: evita repetir el recorrido si la escritura en Firestore falla
// o mientras el perfil en caché todavía no trae el campo tutorials.
function readLocalSeen(uid) {
    try {
        return JSON.parse(localStorage.getItem(`maes:tutorials:${uid}`) || '{}') || {};
    } catch {
        return {};
    }
}

function writeLocalSeen(uid, keys) {
    try {
        const record = readLocalSeen(uid);
        for (const key of keys) record[key] = TUTORIAL_VERSION;
        localStorage.setItem(`maes:tutorials:${uid}`, JSON.stringify(record));
    } catch {
        // Sin almacenamiento local (modo privado estricto): se confía en Firestore.
    }
}

function isVisible(selector) {
    const el = document.querySelector(selector);
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitForElement(selector, timeoutMs = 4000) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        if (document.querySelector(selector)) return true;
        await wait(100);
    }
    return false;
}

function runTour(steps, onDone) {
    const usable = steps.filter((step) => !step.element || isVisible(step.element));
    // Solo el saludo o solo el paso final no es un recorrido útil.
    if (usable.filter((step) => step.element).length === 0) return false;

    activeTour?.destroy();
    activeTour = driver({
        steps: usable,
        showProgress: true,
        progressText: '{{current}} de {{total}}',
        nextBtnText: 'Siguiente',
        prevBtnText: 'Anterior',
        doneBtnText: 'Listo',
        allowClose: true,
        overlayOpacity: 0.45,
        stagePadding: 4,
        stageRadius: 8,
        popoverClass: 'maes-tour',
        // "Saltar tutorial" en todos los pasos menos el último (ahí ya está "Listo").
        // Saltar cuenta como visto, igual que cerrarlo con la X o Escape.
        onPopoverRender: (popover, { state }) => {
            if (state.activeIndex === usable.length - 1) return;
            const skip = document.createElement('button');
            skip.type = 'button';
            skip.className = 'maes-tour-skip';
            skip.textContent = 'Saltar tutorial';
            skip.addEventListener('click', () => activeTour?.destroy());
            popover.footerButtons.prepend(skip);
        },
        onDestroyed: () => {
            activeTour = null;
            onDone?.();
        }
    });
    activeTour.drive();
    return true;
}

export function useTutorial() {
    const { layoutState } = useLayout();

    // En celular el menú lateral está oculto: se abre durante el recorrido y se cierra al final.
    async function withMenuOpen(start) {
        // Si el recorrido se abrió con un clic, ese clic todavía llega al document y el
        // layout cerraría el menú por "clic afuera": se espera a que termine.
        await wait(0);
        const mobile = window.matchMedia(MOBILE_QUERY).matches;
        const wasHidden = mobile ? !layoutState.staticMenuMobileActive.value : layoutState.staticMenuDesktopInactive.value;
        if (wasHidden) {
            if (mobile) layoutState.staticMenuMobileActive.value = true;
            else layoutState.staticMenuDesktopInactive.value = false;
            await wait(350); // animación del menú
        }
        const restore = () => {
            if (!wasHidden) return;
            if (mobile) layoutState.staticMenuMobileActive.value = false;
            else layoutState.staticMenuDesktopInactive.value = true;
        };
        const started = start(restore);
        if (!started) restore();
        return started;
    }

    async function startMenuTour({ keys = null, onDone } = {}) {
        const [role, profile] = await Promise.all([getClaimsRole(), getCurrentUser().catch(() => null)]);
        const steps = buildMenuSteps(role, { keys, firstName: profile?.firstname });
        if (!steps.length) return false;
        await waitForElement('[data-tour^="menu:"]');
        return withMenuOpen((restore) =>
            runTour(steps, () => {
                restore();
                onDone?.();
            })
        );
    }

    async function startPageTour(routeName) {
        if (!hasPageTour(routeName)) return startMenuTour();
        const role = await getClaimsRole();
        const started = runTour(buildPageSteps(routeName, role));
        return started || startMenuTour();
    }

    // Se llama una vez por sesión al montar el layout: si hay secciones del menú que
    // el usuario no ha visto (usuario nuevo o rol nuevo), arranca el recorrido.
    async function maybeStartMenuTour() {
        if (autoChecked) return;
        autoChecked = true;
        const uid = currentMatricula();
        if (!uid) return;
        const [role, profile] = await Promise.all([getClaimsRole(), getCurrentUser().catch(() => null)]);
        if (!profile) return; // perfil incompleto: primero se registra
        const seen = { ...(profile.tutorials ?? {}), ...readLocalSeen(uid) };
        const keys = pendingMenuKeys(role, seen);
        if (!keys.length) return;

        await startMenuTour({
            keys,
            onDone: () => {
                // Se marca como visto aunque lo cierre antes de terminar, para no insistir.
                writeLocalSeen(uid, keys);
                markTutorialsSeen(uid, seenUpdate(keys)).catch((error) => console.warn('No se pudo guardar el tutorial visto:', error));
            }
        });
    }

    return { startMenuTour, startPageTour, maybeStartMenuTour, hasPageTour };
}

// Al cerrar sesión se puede volver a revisar en el siguiente login.
export function resetTutorialSession() {
    autoChecked = false;
    activeTour?.destroy();
}
