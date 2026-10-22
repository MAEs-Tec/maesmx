import { getAuth, onAuthStateChanged } from 'firebase/auth';

export const ROLES = {
    ADMIN: 'admin',
    TEC: 'tec',
    COORDI: 'coordi',
    SUBJECT_COORDI: 'subjectCoordi',
    MAE: 'mae',
    PUBLI: 'publi',
    USER: 'user',
    EXMAE: 'exmae'
};

export const ROLE_GROUPS = {
    admin: [ROLES.ADMIN],
    techAdmin: [ROLES.ADMIN, ROLES.TEC],
    coordi: [ROLES.ADMIN, ROLES.TEC, ROLES.COORDI],
    mae: [ROLES.ADMIN, ROLES.TEC, ROLES.COORDI, ROLES.SUBJECT_COORDI, ROLES.MAE, ROLES.PUBLI]
};

// Cache en memoria del rol para toda la sesión. Se refresca UNA vez al
// detectar el login (onAuthStateChanged). Las navegaciones posteriores usan
// el valor cacheado -> sin petición de token en cada cambio de página.
let cachedRole = null;
let cachedUid = null;
let listenerAttached = false;

function attachListener() {
    if (listenerAttached) return;
    listenerAttached = true;

    const auth = getAuth();
    onAuthStateChanged(auth, async (user) => {
        if (!user) {
            cachedRole = null;
            cachedUid = null;
            return;
        }
        // El login acaba de ocurrir (usuario distinto al cacheado): refrescar
        // el token UNA sola vez para traer el custom claim fresco.
        if (user.uid !== cachedUid) {
            cachedUid = user.uid;
            cachedRole = null;
            try {
                const token = await user.getIdTokenResult(true);
                cachedRole = token.claims.role || ROLES.USER;
            } catch (error) {
                console.warn('Unable to refresh role claim:', error);
                cachedRole = ROLES.USER;
            }
        }
    });
}

export async function getClaimsRole() {
    const user = getAuth().currentUser;
    if (!user) return null;

    // Asegurar que el listener esté activo (una sola vez).
    attachListener();

    // Si ya hay rol cacheado para este usuario, devolverlo sin refrescar.
    if (cachedUid === user.uid && cachedRole) {
        return cachedRole;
    }

    // Primer acceso (listener aún no resolvió): refrescar una vez.
    try {
        const token = await user.getIdTokenResult(true);
        cachedUid = user.uid;
        cachedRole = token.claims.role || ROLES.USER;
        return cachedRole;
    } catch (error) {
        console.warn('Unable to refresh role claim:', error);
        return ROLES.USER;
    }
}

export function canAccessRoute(route, role) {
    const matchedRoles = route.matched
        .map((record) => record.meta?.roles)
        .filter(Boolean);
    const allowedRoles = matchedRoles.length ? matchedRoles[matchedRoles.length - 1] : route.meta?.roles;

    return !allowedRoles || allowedRoles.includes(role);
}

export function buildMenuForRole(role, uid) {
    const model = [
        {
            label: 'Estudiante',
            items: [
                { label: 'Inicio', icon: 'pi pi-fw pi-home', to: '/inicio' },
                { label: 'Maes activos', icon: 'pi pi-fw pi-globe', to: '/maesactivos' },
                { label: 'Horarios', icon: 'pi pi-fw pi-clock', to: '/horarios' },
                { label: 'Asesorías grupales', icon: 'pi pi-fw pi-calendar', to: '/asesoriasGrupales' },
                { label: 'Maeteca', icon: 'pi pi-fw pi-desktop', to: '/maeteca' }
            ]
        }
    ];

    if (ROLE_GROUPS.techAdmin.includes(role)) {
        const adminItems = [
            { label: 'Usuarios', icon: 'pi pi-fw pi-users', to: '/admin/usuarios' },
            { label: 'Materias', icon: 'pi pi-fw pi-pencil', to: '/admin/materias' }
        ];

        if (role === ROLES.ADMIN) {
            adminItems.push(
                { label: 'Asesorías', icon: 'pi pi-fw pi-list', to: '/admin/asesorias' },
                { label: 'Funciones', icon: 'pi pi-fw pi-key', to: '/admin/funciones' },
                { label: 'Dashboard', icon: 'pi pi-fw pi-chart-bar', to: '/admin/dashboard' },
                { label: 'Historial asistencia', icon: 'pi pi-fw pi-history', to: '/admin/historialAsistencia' }
            );
        }

        model.push({ label: 'Administrador', items: adminItems });
    }

    if (ROLE_GROUPS.mae.includes(role)) {
        model.push({
            label: 'MAE',
            items: [
                { label: 'Mi perfil', icon: 'pi pi-fw pi-user-edit', to: `/mae/${uid}` },
                { label: 'Leaderboard', icon: 'pi pi-fw pi-star', to: '/leaderboard' },
                { label: 'Mis asesorías', icon: 'pi pi-fw pi-book', to: '/misasesorias' },
                { label: 'Mis evaluaciones', icon: 'pi pi-fw pi-heart', to: '/misevaluaciones' },
                { label: 'Asistencia grupales', icon: 'pi pi-fw pi-th-large', to: '/asistenciaGrupales' }
            ]
        });
    }

    if ([ROLES.ADMIN, ROLES.TEC, ROLES.COORDI, ROLES.SUBJECT_COORDI].includes(role)) {
        model.push({
            label: 'Coordi',
            items: [
                { label: 'Asistencia', icon: 'pi pi-fw pi-check-square', to: '/coordi' },
                { label: 'Gestión de anuncios', icon: 'pi pi-fw pi-cog', to: '/gestionAnuncios' }
            ]
        });
    }

    if (role === ROLES.PUBLI) {
        model.push({
            label: 'Publicidad',
            items: [
                { label: 'Gestión de anuncios', icon: 'pi pi-fw pi-pencil', to: '/gestionAnuncios' }
            ]
        });
    }

    return model;
}