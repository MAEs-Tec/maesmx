const VALID_ROLES = new Set(['user', 'mae', 'coordi', 'subjectCoordi', 'publi', 'tec', 'admin', 'exmae']);

function createRoleSynchronizer({ db, auth, logger = console }) {
    return async (change, context) => {
        const beforeRole = change.before.exists ? change.before.data().role : undefined;
        const afterRole = change.after.exists ? change.after.data().role : undefined;
        if (change.before.exists === change.after.exists && beforeRole === afterRole) return;

        // Use the immutable document ID, never the email field editable by users.
        const userId = context.params.userId;
        if (!/^[a-z0-9._-]+$/i.test(userId)) throw new Error('Invalid user document ID');
        const email = `${userId.toLowerCase()}@tec.mx`;
        const ref = db.collection('users').doc(userId);

        for (let attempt = 0; attempt < 3; attempt++) {
            // Events can arrive late or be retried. Always use the current role.
            const current = await ref.get();
            const role = current.exists ? current.data().role : 'user';
            if (!VALID_ROLES.has(role)) {
                logger.error('Cannot synchronize an unsupported role', { userId, role });
                return;
            }

            let account;
            try {
                account = await auth.getUserByEmail(email);
            } catch (error) {
                if (error.code !== 'auth/user-not-found') throw error;
                logger.warn('No authentication account for user document', { userId });
                return;
            }

            if (account.customClaims?.role !== role) {
                await auth.setCustomUserClaims(account.uid, { ...account.customClaims, role });
            }
            const latest = await ref.get();
            const latestRole = latest.exists ? latest.data().role : 'user';
            if (latestRole === role) {
                logger.info('User role claim synchronized', { userId, role });
                return;
            }
        }
        // Retry transient failures and overlapping administrative changes.
        throw new Error('Role changed repeatedly during synchronization');
    };
}

// Rol que corresponde a una cuenta según su perfil. Solo se confía en el correo si ya está verificado:
// una cuenta con contraseña sin verificar podría haberse creado con el correo de otra persona.
async function profileRole(db, email, emailVerified) {
    const normalized = String(email || '').trim().toLowerCase();
    const match = /^([a-z0-9._-]+)@tec\.mx$/.exec(normalized);
    if (!emailVerified || !match) return 'user';
    const profile = await db.collection('users').doc(match[1]).get();
    const role = profile.exists ? profile.data().role : 'user';
    return VALID_ROLES.has(role) ? role : 'user';
}

// Al crear la cuenta se respeta el rol de un perfil dado de alta antes (p.ej. una coordi).
function createRoleInitializer({ db, auth }) {
    return async user => {
        const role = await profileRole(db, user.email, user.emailVerified);
        await auth.setCustomUserClaims(user.uid, { ...user.customClaims, role });
    };
}

// Las cuentas con contraseña nacen sin verificar; al iniciar sesión ya verificadas piden su rol del perfil.
function createOwnRoleClaimSync({ db, auth, HttpsError }) {
    return async (data, context) => {
        if (!context.auth) throw new HttpsError('unauthenticated', 'Inicia sesión.');
        const role = await profileRole(db, context.auth.token.email, context.auth.token.email_verified === true);
        if (context.auth.token.role === role) return { role, changed: false };
        const account = await auth.getUser(context.auth.uid);
        await auth.setCustomUserClaims(account.uid, { ...account.customClaims, role });
        return { role, changed: true };
    };
}

module.exports = { createRoleSynchronizer, createRoleInitializer, createOwnRoleClaimSync, VALID_ROLES };
