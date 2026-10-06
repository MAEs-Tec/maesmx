// Older accounts can lack fields added after registration. Defaults are for
// display only; reading a profile must not overwrite the stored account.
export function normalizeProfile(user) {
    if (!user) return null;

    const weekSchedule = {};
    for (const day of ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']) {
        const slots = user.weekSchedule?.[day];
        if (Array.isArray(slots)) {
            weekSchedule[day] = slots.filter(slot => slot && typeof slot.start === 'string' && typeof slot.end === 'string')
                .map(slot => ({ ...slot }));
        }
    }

    return {
        ...user,
        weekSchedule,
        subjects: Array.isArray(user.subjects) ? user.subjects.filter(Boolean) : [],
        badges: Array.isArray(user.badges) ? user.badges : [],
        background: Array.isArray(user.background) ? user.background.filter(Boolean) : [],
        career: typeof user.career === 'string' ? user.career : '',
        totalTime: user.totalTime ?? 0,
        points: user.points ?? 0,
        useCoins: user.useCoins ?? 0
    };
}
