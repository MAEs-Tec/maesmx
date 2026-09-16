import { firestoreDB } from "../../main";
import {
    doc,
    getDoc,
    getDocs,
    setDoc,
    collection,
} from 'firebase/firestore';
import { attendanceDateTag, CACHE_TAGS, CACHE_TTL_MS, cacheKeys } from '../cache/config';
import { invalidateCacheTags, withCache } from '../cache/cache';

function getCurrentDateFormatted() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

function formatDateString(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function resolveAttendanceTtl(dateString) {
    return dateString === getCurrentDateFormatted() ? CACHE_TTL_MS.ATTENDANCE_TODAY : CACHE_TTL_MS.ATTENDANCE_DAY;
}

async function invalidateAttendanceForDate(dateString) {
    await invalidateCacheTags([CACHE_TAGS.ATTENDANCE, attendanceDateTag(dateString)]);
}

async function fetchTodaysReportFresh() {
    try {
        const reportRef = collection(firestoreDB, "attendance", getCurrentDateFormatted(), "report");
        // const reportRef = collection(firestoreDB, "attendance", "2024-05-16", "report");
        const reportSnapshot = await getDocs(reportRef);

        let report = {}

        reportSnapshot.forEach((doc) => {
            const docData = doc.data();
            report[doc.id] = docData.report;
        });

        return report;
    } catch (error) {
        console.error("Error fetching filtered users: ", error);
        return [];
    }
}

// Quita los campos undefined: Firestore rechaza el documento completo si recibe uno
function buildAttendancePayload(userInfo, report) {
    const uid = userInfo?.uid ?? userInfo?.id;

    if (!uid) {
        throw new Error('No se pudo identificar al MAE (uid faltante)');
    }

    const payload = { id: uid, report };

    if (userInfo.email !== undefined) payload.email = userInfo.email;
    if (userInfo.name !== undefined) payload.name = userInfo.name;
    if (userInfo.totalTime !== undefined) payload.totalTime = userInfo.totalTime;

    return { uid, payload };
}

async function writeAttendance(userInfo, dateString, report) {
    const { uid, payload } = buildAttendancePayload(userInfo, report);

    // El doc raiz de la fecha debe existir para que la fecha aparezca en los listados
    const dateDocRef = doc(firestoreDB, "attendance", dateString);
    await setDoc(dateDocRef, { initialized: true }, { merge: true });

    const reportRef = doc(firestoreDB, "attendance", dateString, "report", uid);
    await setDoc(reportRef, payload, { merge: true }); // merge para conservar otros campos

    await invalidateAttendanceForDate(dateString);
}

// Update the MAE attendance report w corresponding value
export async function updateReport(userInfo, report) {
    try {
        await writeAttendance(userInfo, getCurrentDateFormatted(), report);
    } catch (error) {
        console.error("Error updating the report: ", error);
        throw error; // Se propaga para que la vista avise y no de por guardado algo que fallo
    }
}

// Update attendance report for a specific date (used for makeup attendance)
export async function updateReportByDate(userInfo, date, report) {
    try {
        await writeAttendance(userInfo, formatDateString(date), report);
    } catch (error) {
        console.error("Error updating report by date: ", error);
        throw error;
    }
}

// To get date info
export async function addRegister(userInfo, date) {
    try {
        await writeAttendance(userInfo, formatDateString(date), 'RR');
    } catch (error) {
        console.error("Error updating the report: ", error);
        throw error;
    }
}

async function fetchStudentReportFresh(uid) {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  const date = `${y}-${m}-${day}`;
  const reportRef = doc(firestoreDB, "attendance", date, "report", uid);
  const snap = await getDoc(reportRef);

  if (snap.exists()) {
    return snap.data().report; // 'A', 'J', 'R', 'F'
  } else {
    return null;
  }
}


// Para obtener los datos de asistencia de una fecha 
async function fetchReportByDateFresh(dateString) {
    try {
        // Reference with root de attendance, document es dateString del input parameter, y luego report subcollection 
        const reportRef = collection(firestoreDB, "attendance", dateString, "report");
        const reportSnapshot = await getDocs(reportRef); // Arreglo del reporte

        let report = {}; // Objeto vacío para llenarlo de datos

        // For each reportSnapshot in array, extracts the data using document id as key (so matricula) 
        reportSnapshot.forEach((doc) => {
            const docData = doc.data();
            report[doc.id] = docData; // or docData.report if needed
        });

        return report;
    // Error debug
    } catch (error) {
        console.error("Error fetching report: ", error);
        return {};
    }
}

// Helper funct, gets dates between specified start and end date 
function getDateStringsBetween(startDate, endDate) {
    // Handle start and end differently because of time zones, shift to make them back because default at GMT-0600 so 6 hrs ahead -_-
    const start = new Date(startDate + 'T12:00:00'); // Set to noon instead 
    const end = new Date(endDate + 'T12:00:00');
    const dateList = [];

    const currDate = new Date(start); // Sets start as current 

    // Fetch all days in between the range 
    while (currDate <= end) {
        const year = currDate.getFullYear();
        const month = String(currDate.getMonth() + 1).padStart(2, '0'); // Gets month, adds 0 if just one digit
        const day = String(currDate.getDate()).padStart(2, '0'); // Gets date and adds 0 if just one digit 

        //console.log(`   Current date: ${currDate}, End date: ${end}`);
        //console.log(`   Comparison result: ${currDate <= end}`);

        // Save and upgrade for next iteration
        dateList.push(`${year}-${month}-${day}`); // Adds formatted date to list for firebase use 
        currDate.setDate(currDate.getDate() + 1); // Moves to check next date

        //console.log(`   After increment: ${currDate}`);

        
    }
    return dateList;
}

// Gets the attendance reports for every day
async function fetchReportByDateRangeFresh(startDate, endDate) {
    const dateStrings = getDateStringsBetween(startDate, endDate);
    const report = [];

    // Checks each document date w the reports
    for (const date of dateStrings) {
        const reportRef = collection(firestoreDB, "attendance", date, "report");
        try {
            const reportSnap = await getDocs(reportRef);
            // Makes sure not empty date w no attendance
            if (!reportSnap.empty) {
                //console.log(`Found ${reportSnap.size} reports for ${date}`);
                reportSnap.forEach((doc) => {
                    /*report.push({
                        id: doc.id,
                        ...doc.data(),
                        date,
                    });*/
                    const data = doc.data(); 
                    // Only keeps id and report, modify if want other fields (like name or email)
                    report.push({
                        id: doc.id, // Student matricula
                        report: data.report, // (A, R, F, J)
                    });
                });
            } else {
                console.log(`No reports ${date}`);
            }
        } catch (error) {
            console.warn(`Skipping ${date}:`, error.message);
        }
    }

    return report;
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
        fetchTodaysReportFresh
    );
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
        async () => await fetchStudentReportFresh(uid)
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
        async () => await fetchReportByDateFresh(dateString)
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
        async () => await fetchReportByDateRangeFresh(startDate, endDate)
    );
}
