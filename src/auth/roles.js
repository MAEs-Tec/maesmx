import { getAuth } from 'firebase/auth';

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

export async function getClaimsRole({ forceRefresh = true } = {}) {
    const user = getAuth().currentUser;
    if (!user) return null;

    const token = await user.getIdTokenResult(forceRefresh);
    if (token.claims.role) return token.claims.role;

    // Sin claim: devolver fallback SIN auto-reescribir el claim.
    // El claim lo setea el flujo admin / la migración, nunca el cliente.
    return ROLES.USER;
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

    return model;
}