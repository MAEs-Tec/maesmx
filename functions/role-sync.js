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

module.exports = { createRoleSynchronizer };
