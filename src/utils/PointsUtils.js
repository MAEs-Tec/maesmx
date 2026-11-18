export const POINTS_RULES = {
    advisory: {
        firstTime: 10,
        recurrent: 5,
        antiFarmingWindowHours: 3,
        antiFarmingMultiplier: 0.5
    },
    groupAdvisory: 20,
    attendance: {
        A: 3,
        R: 1,
        F: 0,
        J: 0
    },
    rating: {
        multiplier: 10,
        max: 50,
        minWithRatings: 20
    }
};

export const LEADERBOARD_ROLES = ['admin', 'coordi', 'mae', 'subjectCoordi', 'publi', 'tec'];

export function roundPoints(value) {
    return Math.round((Number(value) || 0) * 100) / 100;
}

export function applyPointsDelta(currentPoints, delta) {
    return Math.max(0, roundPoints((Number(currentPoints) || 0) + (Number(delta) || 0)));
}

export function toMillis(dateValue) {
    if (!dateValue) return null;
    if (typeof dateValue.toMillis === 'function') return dateValue.toMillis();
    if (typeof dateValue.toDate === 'function') return dateValue.toDate().getTime();
    if (dateValue instanceof Date) return dateValue.getTime();
    if (typeof dateValue === 'number') return dateValue;
    if (typeof dateValue === 'string') {
        const parsed = new Date(dateValue).getTime();
        return Number.isNaN(parsed) ? null : parsed;
    }
    if (typeof dateValue.seconds === 'number') return dateValue.seconds * 1000;
    return null;
}

export function getSemesterRange(referenceDate = new Date()) {
    const year = referenceDate.getFullYear();
    const firstHalf = referenceDate.getMonth() < 6;

    return {
        start: firstHalf ? new Date(year, 0, 1) : new Date(year, 6, 1),
        end: firstHalf
            ? new Date(year, 5, 30, 23, 59, 59, 999)
            : new Date(year, 11, 31, 23, 59, 59, 999)
    };
}

export function getIndividualAdvisoryPoints({ isFirstTime, isWithinAntiFarmingWindow }) {
    const basePoints = isFirstTime
        ? POINTS_RULES.advisory.firstTime
        : POINTS_RULES.advisory.recurrent;

    return roundPoints(
        isWithinAntiFarmingWindow
            ? basePoints * POINTS_RULES.advisory.antiFarmingMultiplier
            : basePoints
    );
}

export function getAdvisoryPointsReason({ isFirstTime, isWithinAntiFarmingWindow }) {
    if (isFirstTime && isWithinAntiFarmingWindow) return 'first_time_under_3_hours';
    if (isFirstTime) return 'first_time_student';
    if (isWithinAntiFarmingWindow) return 'recurrent_under_3_hours';
    return 'recurrent_student';
}

export function getAttendancePoints(code) {
    return POINTS_RULES.attendance[code] || 0;
}

export function getAttendancePointsDelta(previousCode, nextCode) {
    return roundPoints(getAttendancePoints(nextCode) - getAttendancePoints(previousCode));
}

export function calculateRatingBonus(ratings) {
    const validRatings = ratings
        .map(Number)
        .filter(rating => Number.isFinite(rating));

    if (validRatings.length === 0) return 0;

    const average = validRatings.reduce((sum, rating) => sum + rating, 0) / validRatings.length;
    const rawBonus = average * POINTS_RULES.rating.multiplier;
    const cappedBonus = Math.min(POINTS_RULES.rating.max, rawBonus);

    return roundPoints(Math.max(POINTS_RULES.rating.minWithRatings, cappedBonus));
}
