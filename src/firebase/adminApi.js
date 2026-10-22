import { getFunctions, httpsCallable } from 'firebase/functions';
import { firebaseApp } from '../main';

const functions = getFunctions(firebaseApp);

async function callFunction(name, payload = {}) {
    const fn = httpsCallable(functions, name);
    const result = await fn(payload);
    return result.data;
}

// Sincroniza el custom claim `role` de UN usuario desde Firestore.
// Requiere rol admin (la Cloud Function hace assertRole(['admin'])).
export function syncRoleClaimAdmin(email) {
    return callFunction('syncRoleClaim', { email });
}

// Convierte un estudiante (por matricula -> @tec.mx) a un rol MAE/coordi/tec/etc.
// Actualiza el doc de Firestore Y el custom claim de forma sincronizada.
export function setUserMaeRoleAdmin({ matricula, role, status }) {
    return callFunction('setUserMaeRole', {
        matricula,
        role: role?.value || role,
        status: status?.value || status
    });
}

// Da de baja/reactiva MAEs según lista de emails (Excel) o por inactividad.
export function updateInactiveMaeRolesAdmin(file = null) {
    return callFunction('updateInactiveMaeRoles', { emails: file || null });
}