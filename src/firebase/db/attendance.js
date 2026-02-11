import { firestoreDB } from "../../main";
import {
    doc,
    getDoc,
    getDocs,
    setDoc,
    collection,
} from 'firebase/firestore';

function getCurrentDateFormatted() {
    const today = new Date();
    const year = today.getFullYear();
    const month = String(today.getMonth() + 1).padStart(2, '0'); // Months are zero-based
    const day = String(today.getDate()).padStart(2, '0');

    return `${year}-${month}-${day}`;
}

export async function getTodaysReport() {
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

// Update the MAE attendance report w corresponding value 
export async function updateReport(userInfo, report) {
    try {
        // Defensive checks + unwrap reactive proxy
        const uid = userInfo?.uid ?? userInfo?.id ?? userInfo?.value?.uid;
        const name = userInfo?.name ?? userInfo?.value?.name ?? '';
        const totalTime = userInfo?.totalTime ?? userInfo?.value?.totalTime ?? 0;

        console.log(uid, report, "Updating report")
        const reportRef = doc(firestoreDB, "attendance", getCurrentDateFormatted(), "report", userInfo.uid); // Final de semestre, quitar report de aca y luego when accessing data para que sean menos datos

        // Stores less data for attendance
        const dataUpload = {
            id: userInfo.uid, // Student id
            email: userInfo.email, // Student email, helps search data within firebase
            name: userInfo.name, 
            totalTime: userInfo.totalTime, 
            report: report, // (A, R, F, J)
        }

        console.log('Writing to Firestore path:', reportRef.path, 'payload:', dataUpload);
        
        return await setDoc(reportRef, dataUpload, { merge : true }); // Use merge so that it can keep otehr fields if write more data
    } catch (error) {
        console.error("Error updating the report: ", error);
        return [];
    }
}

// To get date info
export async function addRegister(userInfo, date) {
    try {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const dateString = `${year}-${month}-${day}`;

        // Root date doc is created w dummy field
        const dateDocRef = doc(firestoreDB, "attendance", dateString);
        await setDoc(dateDocRef, { initialized: true }, { merge: true });

        const reportRef = doc(firestoreDB, "attendance", dateString, "report", userInfo.uid);
        await setDoc(reportRef, {
            ...userInfo,
            report: 'RR'
        });

    } catch (error) {
        console.error("Error updating the report: ", error);
    }
}

export async function getStudentReport(uid) {
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
export async function getReportByDate (dateString) {
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
export async function getReportByDateRange(startDate, endDate) {
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