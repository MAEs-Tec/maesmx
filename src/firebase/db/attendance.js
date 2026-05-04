import * as attendanceDb from './attendance.legacy';
import { attendanceDateTag, CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';
import { invalidateCacheTags, withCache } from '../cache/cache';

function getCurrentDateFormatted() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0');
    const day = String(today.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveAttendanceTtl(dateString) {
    return dateString === getCurrentDateFormatted() ? CACHE_TTL_MS.ATTENDANCE_TODAY : CACHE_TTL_MS.ATTENDANCE_DAY;
}

async function invalidateAttendanceForDate(dateString) {
    await invalidateCacheTags([CACHE_TAGS.ATTENDANCE, attendanceDateTag(dateString)]);
}

export async function getTodaysReport(options = {}) {
    const today = getCurrentDateFormatted();

    return await withCache(
        cacheKeys.attendanceToday(today),
        {
            ttlMs: CACHE_TTL_MS.ATTENDANCE_TODAY,
            persist: false,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ATTENDANCE, attendanceDateTag(today)]
        },
        async () => await attendanceDb.getTodaysReport()
    );
}

export async function updateReport(userInfo, report) {
    const result = await attendanceDb.updateReport(userInfo, report);
    await invalidateAttendanceForDate(getCurrentDateFormatted());
    return result;
}

export async function updateReportByDate(userInfo, date, report) {
    const result = await attendanceDb.updateReportByDate(userInfo, date, report);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    await invalidateAttendanceForDate(`${year}-${month}-${day}`);
    return result;
}

export async function addRegister(userInfo, date) {
    const result = await attendanceDb.addRegister(userInfo, date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    await invalidateAttendanceForDate(`${year}-${month}-${day}`);
    return result;
}

export async function getStudentReport(uid, options = {}) {
    const today = getCurrentDateFormatted();

    return await withCache(
        cacheKeys.attendanceStudent(uid, today),
        {
            ttlMs: CACHE_TTL_MS.ATTENDANCE_TODAY,
            persist: false,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ATTENDANCE, attendanceDateTag(today)]
        },
        async () => await attendanceDb.getStudentReport(uid)
    );
}

export async function getReportByDate(dateString, options = {}) {
    return await withCache(
        cacheKeys.attendanceByDate(dateString),
        {
            ttlMs: resolveAttendanceTtl(dateString),
            persist: dateString !== getCurrentDateFormatted(),
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ATTENDANCE, attendanceDateTag(dateString)]
        },
        async () => await attendanceDb.getReportByDate(dateString)
    );
}

export async function getReportByDateRange(startDate, endDate, options = {}) {
    return await withCache(
        cacheKeys.attendanceRange(startDate, endDate),
        {
            ttlMs: CACHE_TTL_MS.ATTENDANCE_RANGE,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.ATTENDANCE]
        },
        async () => await attendanceDb.getReportByDateRange(startDate, endDate)
    );
}
