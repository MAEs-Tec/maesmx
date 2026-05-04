const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export const CACHE_TTL_MS = {
    CURRENT_USER: 5 * MINUTE,
    USER: 5 * MINUTE,
    PROFILE_PICTURE: 30 * DAY,
    MAE_DIRECTORY: 10 * MINUTE,
    MAES_TODAY: 1 * MINUTE,
    ACTIVE_MAES: 30 * SECOND,
    SUBJECTS: 7 * DAY,
    MAJORS: 7 * DAY,
    CAMPUSES: 7 * DAY,
    ANNOUNCEMENTS: 5 * MINUTE,
    GROUP_ANNOUNCEMENTS: 1 * MINUTE,
    ANNOUNCEMENTS_EDIT: 1 * MINUTE,
    ATTENDANCE_TODAY: 30 * SECOND,
    ATTENDANCE_DAY: 10 * MINUTE,
    ATTENDANCE_RANGE: 10 * MINUTE,
    ASESORIAS: 5 * MINUTE,
    LEADERBOARD: 5 * MINUTE,
    VIDEOS: 1 * DAY
};

export const CACHE_TAGS = {
    USERS: 'users',
    USER_DETAILS: 'users:details',
    CURRENT_USER: 'users:current',
    MAES: 'users:maes',
    ACTIVE_MAES: 'users:active',
    PROFILE_PICTURES: 'users:photos',
    SUBJECTS: 'subjects',
    MAJORS: 'majors',
    CAMPUSES: 'campuses',
    ANNOUNCEMENTS: 'announcements',
    GROUP_ANNOUNCEMENTS: 'announcements:group',
    ATTENDANCE: 'attendance',
    ASESORIAS: 'asesorias',
    LEADERBOARD: 'leaderboard',
    VIDEOS: 'videos'
};

export const userTag = (uid) => `user:${uid}`;
export const attendanceDateTag = (dateString) => `attendance:${dateString}`;
export const profilePictureTag = (email) => `profile-picture:${email?.toLowerCase?.() ?? email}`;

export const cacheKeys = {
    currentUser: (uid) => `users:current:${uid}`,
    userById: (uid) => `users:detail:${uid}`,
    maeDirectory: () => 'users:mae-directory',
    maesToday: (day) => `users:maes-today:${day}`,
    activeMaes: (mode = 'basic') => `users:active:${mode}`,
    subjects: () => 'reference:subjects',
    majors: () => 'reference:majors',
    campuses: () => 'reference:campuses',
    announcementsVisible: () => 'announcements:visible',
    announcementsEdit: () => 'announcements:edit',
    announcementsGroup: () => 'announcements:group',
    announcementsAllGroup: () => 'announcements:group:all',
    attendanceToday: (dateString) => `attendance:today:${dateString}`,
    attendanceByDate: (dateString) => `attendance:date:${dateString}`,
    attendanceStudent: (uid, dateString) => `attendance:student:${uid}:${dateString}`,
    attendanceRange: (startDate, endDate) => `attendance:range:${startDate}:${endDate}`,
    asesoriasRange: (startDate, endDate) => `asesorias:range:${startDate ?? 'all'}:${endDate ?? 'all'}`,
    asesoriasSemesterByPeer: (uid, semesterKey) => `asesorias:semester:${uid}:${semesterKey}`,
    asesoriasPendingRating: (uidUser, uidPeer = 'all') => `asesorias:pending-rating:${uidUser}:${uidPeer}`,
    leaderboard: () => 'users:leaderboard',
    videosAll: () => 'videos:all',
    videoById: (id) => `videos:detail:${id}`,
    videosByRelated: (related) => `videos:related:${related ?? 'all'}`,
    profilePicture: (email) => `users:profile-picture:${email?.toLowerCase?.() ?? email}`
};
