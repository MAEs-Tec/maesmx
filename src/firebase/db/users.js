import { firestoreDB } from "../../main";
import { getAuth } from 'firebase/auth';
import {
    doc,
    collection,
    query,
    where,
    setDoc,
    getDoc,
    getDocs,
    updateDoc,
    serverTimestamp,
    deleteField,
    increment,
    getFirestore,
} from 'firebase/firestore';
import { getUserProfilePicture } from "../img/users";
import * as XLSX from 'xlsx';
import { writeBatch } from "firebase/firestore";
import { invalidateCacheTags, withCache } from "../cache/cache";
import { CACHE_TAGS, CACHE_TTL_MS, cacheKeys, userTag } from "../cache/config";

const db = getFirestore();
const MAE_DIRECTORY_ROLES = ['mae', 'coordi', 'admin', 'subjectCoordi', 'publi', 'tec'];


function getEmailUsername(email) {
    var atIndex = email.indexOf('@');
    if (atIndex !== -1) {
        return email.slice(0, atIndex);
    }
    return null;
}

function getCurrentDayKey() {
    return ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"][new Date().getDay()];
}

function sortUsersByClosestSchedule(data) {
    const today = new Date().getDay();

    data.sort((a, b) => {
        const { day: dayA, startTime: startTimeA } = getClosestDayAndStartTime(a.weekSchedule);
        const { day: dayB, startTime: startTimeB } = getClosestDayAndStartTime(b.weekSchedule);

        const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];
        const daysOrdered = [...daysOfWeek.slice(today), ...daysOfWeek.slice(0, today)];

        const dayIndexA = daysOrdered.indexOf(dayA);
        const dayIndexB = daysOrdered.indexOf(dayB);
        const dayComparison = (dayIndexA === -1 ? 1 : (dayIndexB === -1 ? -1 : dayIndexA - dayIndexB));
        if (dayComparison !== 0) return dayComparison;

        const startTimeComparison = (startTimeA === null ? 1 : (startTimeB === null ? -1 : startTimeA.localeCompare(startTimeB)));
        if (startTimeComparison !== 0) return startTimeComparison;

        return a.name.localeCompare(b.name);
    });

    return data;
}

async function fetchMaeDirectoryFresh() {
    const usersRef = collection(firestoreDB, "users");
    const q = query(usersRef, where('role', 'in', MAE_DIRECTORY_ROLES));
    const querySnapshot = await getDocs(q);

    if (!querySnapshot) {
        return null;
    }

    let data = querySnapshot.docs.map(doc => doc.data()).filter(item => item.name);

    data = await Promise.all(data.map(async (item) => {
        const profilePictureUrl = await getUserProfilePicture(item.email);
        return { ...item, profilePictureUrl };
    }));

    return sortUsersByClosestSchedule(data);
}

async function getMaeDirectory(options = {}) {
    return await withCache(
        cacheKeys.maeDirectory(),
        {
            ttlMs: CACHE_TTL_MS.MAE_DIRECTORY,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.USERS, CACHE_TAGS.MAES]
        },
        fetchMaeDirectoryFresh
    );
}

async function invalidateUserCaches(userId, { includeActive = false, includeLeaderboard = false } = {}) {
    const tags = [CACHE_TAGS.USERS, CACHE_TAGS.USER_DETAILS, CACHE_TAGS.CURRENT_USER, CACHE_TAGS.MAES];

    if (userId) {
        tags.push(userTag(userId));
    }
    if (includeActive) {
        tags.push(CACHE_TAGS.ACTIVE_MAES);
    }
    if (includeLeaderboard) {
        tags.push(CACHE_TAGS.LEADERBOARD);
    }

    await invalidateCacheTags(tags);
}

export async function createUser(userInfo) {

    userInfo.id = getEmailUsername(userInfo.email);
    userInfo.uid = getEmailUsername(userInfo.email);

    userInfo.career = userInfo.major.id
    userInfo.area = userInfo.major.school

    userInfo.name = userInfo.firstname.trim() + ' ' + userInfo.lastname.trim();

    const userRef = doc(firestoreDB, "users", userInfo.uid);
    const result = await setDoc(userRef, userInfo);
    await invalidateUserCaches(userInfo.uid);
    return result;
}

export async function getUser(uid, options = {}) {
    return await withCache(
        cacheKeys.userById(uid),
        {
            ttlMs: CACHE_TTL_MS.USER,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.USERS, CACHE_TAGS.USER_DETAILS, userTag(uid)]
        },
        async () => {
            const userRef = doc(firestoreDB, "users", uid);
            const docSnap = await getDoc(userRef);

            if (docSnap.exists()) {
                const data = docSnap.data();
                const profilePictureUrl = await getUserProfilePicture(data.email);
                return { ...data, profilePictureUrl };
            }

            return null;
        }
    );
}

export async function getCurrentUser(options = {}) {
    const auth = getAuth();
    if (auth.currentUser) {
        const uid = getEmailUsername(auth.currentUser.email);
        return await withCache(
            cacheKeys.currentUser(uid),
            {
                ttlMs: CACHE_TTL_MS.CURRENT_USER,
                persist: true,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.USERS, CACHE_TAGS.CURRENT_USER, userTag(uid)]
            },
            async () => await getUser(uid, options)
        );
    }
    return null;
}

// Función para obtener el día más cercano en la semana y la hora de inicio más temprana
export const getClosestDayAndStartTime = (schedules) => {
    if (typeof schedules !== 'object' || schedules === null || Array.isArray(schedules)) {
        console.error('Expected a map of schedules, but received:', schedules);
        return { day: null, startTime: null };
    }

    const today = new Date().getDay(); // Día actual (0-6) donde 0 es domingo
    const daysOfWeek = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

    // Crear dos arrays, uno para los días futuros y otro para los pasados
    const futureDays = daysOfWeek.slice(today);
    const pastDays = daysOfWeek.slice(0, today);

    let closestDay = null;
    let earliestStartTime = null;

    // Buscar primero entre los días futuros (desde hoy hasta el final de la semana)
    futureDays.forEach(day => {
        if (Array.isArray(schedules[day])) {
            schedules[day].forEach(schedule => {
                if (schedule.start) {
                    if (closestDay === null || (earliestStartTime === null || schedule.start < earliestStartTime)) {
                        closestDay = day;
                        earliestStartTime = schedule.start;
                    }
                }
            });
        }
    });

    // Si no se encontró ningún día en el futuro, buscar en los días pasados (inicio de semana hasta hoy)
    if (closestDay === null) {
        pastDays.forEach(day => {
            if (Array.isArray(schedules[day])) {
                schedules[day].forEach(schedule => {
                    if (schedule.start) {
                        if (closestDay === null || (earliestStartTime === null || schedule.start < earliestStartTime)) {
                            closestDay = day;
                            earliestStartTime = schedule.start;
                        }
                    }
                });
            }
        });
    }

    return { day: closestDay, startTime: earliestStartTime };
};


export async function getMaes(options = {}) {
    return await getMaeDirectory(options);
}

export async function getMaesNames(options = {}) {
    return await getMaeDirectory(options);
}


export async function getUsersWithActiveSession(getProfilePicture = false, options = {}) {
    try {
        return await withCache(
            cacheKeys.activeMaes(getProfilePicture ? 'with-photo' : 'basic'),
            {
                ttlMs: CACHE_TTL_MS.ACTIVE_MAES,
                persist: false,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.USERS, CACHE_TAGS.ACTIVE_MAES]
            },
            async () => {
                const usersRef = collection(firestoreDB, "users");
                const q = query(usersRef, where('activeSession', '!=', null));
                const querySnapshot = await getDocs(q);

                if (!querySnapshot) {
                    return null;
                }

                const fiveHoursAgoTimestampSeconds = Math.floor(Date.now() / 1000) - 18000;
                const filteredDocs = querySnapshot.docs.filter((doc) => {
                    const data = doc.data();
                    return data.activeSession?.startTime?.seconds > fiveHoursAgoTimestampSeconds;
                });

                return await Promise.all(filteredDocs.map(async (doc) => {
                    const data = doc.data();
                    const profilePictureUrl = getProfilePicture ? await getUserProfilePicture(data.email) : null;
                    return { ...data, ...(profilePictureUrl ? { profilePictureUrl } : {}) };
                }));
            }
        );
    } catch (error) {
        console.error('Error retrieving users:', error);
    }
};

export async function updateUserInfo(userId, userInfo) {
    userInfo['name'] = userInfo['firstname'].trim() + ' ' + userInfo['lastname'].trim()
    const userRef = doc(firestoreDB, "users", userId);
    const result = await updateDoc(userRef, userInfo);
    await invalidateUserCaches(userId);
    return result;
}

export async function updateUserSubjects(userId, newSubjects) {
    const userRef = doc(firestoreDB, "users", userId);
    const result = await updateDoc(userRef, {
        subjects: newSubjects
    });
    await invalidateUserCaches(userId);
    return result;
}

export async function updateUserSchedule(userId, newSchedule) {
    const userRef = doc(firestoreDB, "users", userId);
    // Iterate over object keys
    for (const day in newSchedule) {
        // Check if the value is an empty array
        if (Array.isArray(newSchedule[day]) && newSchedule[day].length === 0) {
            // Delete the key with an empty array value
            delete newSchedule[day];
        }
    }
    const result = await updateDoc(userRef, {
        weekSchedule: newSchedule
    });
    await invalidateUserCaches(userId);
    return result;
}

export async function getTodaysMae(options = {}) {
    try {
        return await withCache(
            cacheKeys.maesToday(getCurrentDayKey()),
            {
                ttlMs: CACHE_TTL_MS.MAE_DIRECTORY,
                persist: true,
                forceRefresh: options.forceRefresh ?? false,
                tags: [CACHE_TAGS.USERS, CACHE_TAGS.MAES]
            },
            async () => {
                const users = await getMaeDirectory(options);
                const currentDay = getCurrentDayKey();

                return (users ?? [])
                    .filter((user) => user.weekSchedule && user.weekSchedule[currentDay])
                    .sort((a, b) => {
                        const aStartTime = a.weekSchedule[currentDay][0]?.start;
                        const bStartTime = b.weekSchedule[currentDay][0]?.start;
                        const aTime = aStartTime ? new Date(`1970-01-01T${aStartTime}:00Z`) : new Date();
                        const bTime = bStartTime ? new Date(`1970-01-01T${bStartTime}:00Z`) : new Date();
                        return aTime - bTime;
                    });
            }
        );
    } catch (error) {
        console.error("Error fetching filtered users: ", error);
        return [];
    }
}

export async function startActiveSession(userId, userInfo, location) {
    try {
        const userRef = doc(firestoreDB, "users", userId);
        const result = await updateDoc(userRef, {
            activeSession: {
                peerInfo: userInfo,
                location,
                status: 'PENDING',
                startTime: serverTimestamp(),
            }
        });
        await invalidateUserCaches(userId, { includeActive: true });
        return result;
    } catch (error) {
        console.error("Error fetching filtered users: ", error);
        return [];
    }
}

export async function stopActiveSession(userId) {
    try {
        const userRef = doc(firestoreDB, "users", userId);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            throw new Error("User not found");
        }

        // Gets start time from current Active Session
        const userData = userDoc.data();
        const startTime = userData.activeSession?.startTime?.toDate();

        if (!startTime) {
            throw new Error("Active session start time not found");
        }

        // Calculates and adds the duration of the current session to the total time
        const currentTime = new Date();
        const differenceInMinutes = Math.floor((currentTime - startTime) / (1000 * 60));

        if (differenceInMinutes > 310) {
            await updateDoc(userRef, {
                activeSession: deleteField()
            });
            await invalidateUserCaches(userId, { includeActive: true });
            return { timeLimitExceded: true, activeSessionDeleted: false, differenceInMinutes }
        }

        const totalTime = (userData.totalTime || 0) + differenceInMinutes;

        // Updates the total time and stops current session
        await updateDoc(userRef, {
            totalTime: totalTime,
            activeSession: deleteField()
        });
        await invalidateUserCaches(userId, { includeActive: true, includeLeaderboard: true });

        return { totalTime, differenceInMinutes, activeSessionDeleted: true };
    } catch (error) {
        return { activeSessionDeleted: false };
    }
}

export async function incrementTotalTime(userId, time) {
    const userRef = doc(firestoreDB, "users", userId);

    await updateDoc(userRef, {
        totalTime: increment(time*60)
    });
    await invalidateUserCaches(userId, { includeLeaderboard: true });
}


export async function updateUserProfilePicture(userId, photoURL) {
    try {
        const userRef = doc(firestoreDB, 'users', userId);
  
        await updateDoc(userRef, {
            photoURL: photoURL
        });
        await invalidateUserCaches(userId);
        
    } catch (error) {
        console.error('Error updating user profile picture: ', error);
        throw error;
    }
}

/**
 * Clears the content of the weekSchedule field for users with specific roles (admin, coordi, mae),
 * but keeps the field as an empty object.
 *
 * @returns {Promise<void>} - A promise that resolves when all eligible weekSchedules are cleared.
 */
export async function clearAllUsersWeekSchedule() {
    try {

        const usersRef = collection(firestoreDB, "users");

        const querySnapshot = await getDocs(usersRef);


        const eligibleRoles = ['admin', 'coordi', 'mae','tec','publi'];

        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref; 
            const userData = doc.data(); 

    
            if (eligibleRoles.includes(userData.role)) {
                return updateDoc(userRef, {
                    weekSchedule: {} 
                });
            } else {
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });

        console.log("Week schedule content has been successfully cleared for eligible users.");
    } catch (error) {
        console.error("Error clearing weekSchedule content for eligible users: ", error);
        throw error;
    }
}

export async function checkAndUpdateUserRole(file = null) {
    try {
        const usersRef = collection(firestoreDB, "users");
        const querySnapshot = await getDocs(usersRef);
        if (file) {
            // Leer y procesar el archivo Excel acuerdate que empieza a contar desde 0
            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const data = new Uint8Array(event.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    const sheet = workbook.Sheets[workbook.SheetNames[0]];
                    // console.log(sheet)
                    const excelData = XLSX.utils.sheet_to_json(sheet, { header: 0 });
                    console.log(excelData)
                    // Convertimos las matrículas del Excel a correos en formato lowercase@tec.mx
                    const emailsFromExcel = excelData
                        .map(row => row["Matrícula"]?.toLowerCase() + "@tec.mx")

                    console.log(emailsFromExcel);
     
                    const promises = querySnapshot.docs.map(async (doc) => {
                        const userRef = doc.ref;
                        const userData = doc.data();
                        const eligibleRoles = ['mae', 'coordi', 'publi', 'tec', 'admin'];
            
                        const userEmail = userData.email?.toLowerCase();
                        const userMatricula = userData.matricula?.toLowerCase();
            
                        if (eligibleRoles.includes(userData.role)) {
                            if (!emailsFromExcel.includes(userEmail)) {
                                return updateDoc(userRef, { role: "exmae" });
                            }
                        } else {
                            // Si el usuario no tiene un rol elegible, se le asigna "mae" con estado "becario"
                            if (emailsFromExcel.includes(userEmail)) {
                                return updateUserToMae({
                                    matricula: userMatricula,
                                    role: "mae",
                                    status: "becario",
                                    point: 0,
                                    useCoins: 0,
                                });
                            }
                        }
            
                        return Promise.resolve();
                    });
            
                    await Promise.all(promises);
                    await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
                    //console.log("Roles actualizados con base en el archivo Excel.");
                } catch (error) {
                    console.error("Error al procesar el archivo Excel:", error);
                    throw error;
                }
            };

            reader.readAsArrayBuffer(file);
        } else {
            // Si no hay archivo, ejecutamos la lógica normal
            const eligibleRoles = ['mae', 'coordi', 'publi','tec'];

            const promises = querySnapshot.docs.map(async (doc) => {
                const userRef = doc.ref;
                const userData = doc.data();
                if (eligibleRoles.includes(userData.role)) {
                    const isWeekScheduleEmpty = Object.values(userData.weekSchedule).every(day => day.length === 0);
                    const isTotalTimeEquals0 = userData.totalTime == 0;
                    const hasNoSubjects = !userData.subjects || userData.subjects.length === 0;
                    if (isWeekScheduleEmpty && isTotalTimeEquals0 && hasNoSubjects) {
                        return updateDoc(userRef, { role: "exmae" });
                    }
                }

                return Promise.resolve();
            });

            await Promise.all(promises);
            await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
            console.log("Roles actualizados con base en weekSchedule, totalTime, y subjects.");
        }
    } catch (error) {
        console.error("Error actualizando roles de los usuarios: ", error);
        throw error;
    }
}

export async function updateUserToMae(data) {
    const { role, matricula, status } = data;
    const badges = [
        { "id": "1", "name": "Mi primera asesoría", "description": "Da tu primera asesoría", "image_url": "/assets/badges/1.svg", "achieved": false },
        { "id": "2", "name": "MAE aprendiz", "description": "Da 10 asesorías", "image_url": "/assets/badges/2.svg", "achieved": false },
        { "id": "3", "name": "MAE en ascenso", "description": "Da 30 asesorías", "image_url": "/assets/badges/3.svg", "achieved": false },
        { "id": "4", "name": "MAE destacado", "description": "Da 50 asesorías", "image_url": "/assets/badges/4.svg", "achieved": false },
        { "id": "5", "name": "Super MAE", "description": "Da 100 asesorías", "image_url": "/assets/badges/5.svg", "achieved": false },
        { "id": "6", "name": "Leyenda MAE", "description": "Da 200 asesorías", "image_url": "/assets/badges/6.svg", "achieved": false },
        { "id": "7", "name": "MAE de MAEs", "description": "Da 500 asesorías", "image_url": "/assets/badges/7.svg", "achieved": false },
        { "id": "8", "name": "Cambio de look", "description": "Añade una foto de perfil", "image_url": "/assets/badges/8.svg", "achieved": false },
        { "id": "9", "name": "Trabajo bien hecho", "description": "Completa 80 horas", "image_url": "/assets/badges/9.svg", "achieved": false },
        { "id": "10", "name": "Siempre a tiempo", "description": "Obtén asistencia perfecta durante 1 periodo", "image_url": "/assets/badges/10.svg", "achieved": false },
        { "id": "11", "name": "Top MAE", "description": "Se #1 en el leaderboard", "image_url": "/assets/badges/11.svg", "achieved": false },
        { "id": "12", "name": "MAE", "description": "Obtén el rol de MAE", "image_url": "/assets/badges/12.svg", "achieved": false },
        { "id": "13", "name": "Coordi", "description": "Obtén el rol de coordi", "image_url": "/assets/badges/13.svg", "achieved": false },
        { "id": "14", "name": "Tecnológico", "description": "Obtén el rol de tecnología", "image_url": "/assets/badges/14.svg", "achieved": false },
        { "id": "15", "name": "Publicista", "description": "Obtén el rol de publicidad", "image_url": "/assets/badges/15.svg", "achieved": false },
        { "id": "16", "name": "Especialista", "description": "Mete 3 materias top", "image_url": "/assets/badges/16.svg", "achieved": false },
        { "id": "17", "name": "Trabajo de campo", "description": "Da 5 asesorías de materias top", "image_url": "/assets/badges/17.svg", "achieved": false },
        { "id": "18", "name": "Ups...", "description": "Pierde puntos de experiencia una vez", "image_url": "/assets/badges/18.svg", "achieved": false }
    ];


    
    const background = [
        { "id": "1", "image_url": "/assets/back/1.svg", "bought": true, "price": 0 },
        { "id": "2", "image_url": "/assets/back/2.svg", "bought": false, "price": 25 },
        { "id": "3", "image_url": "/assets/back/3.svg", "bought": false, "price": 25},
        { "id": "4", "image_url": "/assets/back/4.svg", "bought": false, "price": 25 },
        { "id": "5", "image_url": "/assets/back/5.svg", "bought": false, "price": 50 },
        { "id": "6", "image_url": "/assets/back/6.svg", "bought": false, "price": 50 },
        { "id": "7", "image_url": "/assets/back/7.svg", "bought": false, "price": 75 },
        { "id": "8", "image_url": "/assets/back/8.svg", "bought": false, "price": 100 },
    ];

    if (!role || !matricula || !status) {
        throw new Error("role, matricula, and status are required fields.");
    }

    try {
        const usersRef = collection(firestoreDB, "users");
        const userQuery = query(usersRef, where("email", "==", `${matricula.toLowerCase()}@tec.mx`));
        const querySnapshot = await getDocs(userQuery);
    
        if (querySnapshot.empty) {
            console.log("No user found with the given matricula.");
            return;
        }

        // Procesar cada usuario encontrado
        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const userData = doc.data();

            if (userData.role === 'user' || userData.status === 'estudiante') {
                return updateDoc(userRef, {
                    role: role.value,
                    status: status.value,
                    weekSchedule: {}, 
                    subjects: [],
                    totalTime: 0,
                    badges: badges,
                    points: 0,
                     useCoins: 0,
                     background: background,
                });
            } else {
            
                return updateDoc(userRef, {
                    role: role.value,
                    status: status.value
                });
            }
        });

        await Promise.all(promises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
        console.log("Usuarios actualizados exitosamente.");
    } catch (error) {
        console.error("Error al actualizar los usuarios: ", error);
    }
}

export const saveScheduleSubjectsExperience = async () => {
    try {
        const usersRef = collection(db, 'users');
        const usersSnap = await getDocs(usersRef);

        if (usersSnap.empty) {
            console.error("No se encontraron usuarios en la tabla 'users'.");
            return;
        }

        const rolesPermitidos = ['admin', 'publi', 'mae', 'coordi', 'tec'];

        const updatePromises = []; 
        usersSnap.forEach(async (userDoc) => {
            const user = userDoc.data();

            if (!rolesPermitidos.includes(user.role)) {
                return;
            }

            let puntos = 0;

            if (user.subjects && user.subjects.length > 0) {
                puntos += 15;
            } else {
                puntos -= 30;
                await  updateUserAchievementBadge(user.uid, "18");
            }

            if (user.weekSchedule && Object.keys(user.weekSchedule).length > 0) {
                puntos += 100;
            } else {
                puntos -= 500;
                await updateUserAchievementBadge(user.uid, "18");
            }

            const userRef = doc(db, 'users', userDoc.id); 
            updatePromises.push(
                updateDoc(userRef, {
                    points: (user.points || 0) + puntos
                })
            );
        });

        await Promise.all(updatePromises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
    } catch (error) {
        console.error("Error al guardar la experiencia:", error);
    }
};


export async function updatePoints(uid, newPoints) {
    const userRef = doc(db, 'users', uid);
    const userSnap = await getDoc(userRef);

    if (!userSnap.exists()) {
        console.log(`Usuario con uid ${uid} no encontrado.`);
        return [];
    }

    const user = userSnap.data();
    const updatedPoints = (user.points || 0) + newPoints;

    await updateDoc(userRef, { points: updatedPoints });
    if (newPoints < 0) {
        await updateUserAchievementBadge(uid, "18");
    }

    await invalidateUserCaches(uid, { includeLeaderboard: true });
    return [{ id: uid, ...user, points: updatedPoints }];
}

export async function getExperience(options = {}) {
    return await withCache(
        cacheKeys.leaderboard(),
        {
            ttlMs: CACHE_TTL_MS.LEADERBOARD,
            persist: true,
            forceRefresh: options.forceRefresh ?? false,
            tags: [CACHE_TAGS.USERS, CACHE_TAGS.LEADERBOARD]
        },
        async () => {
            const data = await getMaeDirectory(options);
            return (data ?? []).slice().sort((a, b) => (b.points || 0) - (a.points || 0));
        }
    );
}

// Funcion especial si mas adelante quieren agregar logros
export async function addBadgesToEligibleUsers() {
    try {
        const usersRef = collection(firestoreDB, "users");
        const querySnapshot = await getDocs(usersRef);

        const eligibleRoles = ['admin', 'coordi', 'mae', 'tec', 'publi'];

        const badges = [
            { "id": "1", "name": "Mi primera asesoría", "description": "Da tu primera asesoría", "image_url": "/assets/badges/1.svg", "achieved": false },
            { "id": "2", "name": "MAE aprendiz", "description": "Da 10 asesorías", "image_url": "/assets/badges/2.svg", "achieved": false },
            { "id": "3", "name": "MAE en ascenso", "description": "Da 30 asesorías", "image_url": "/assets/badges/3.svg", "achieved": false },
            { "id": "4", "name": "MAE destacado", "description": "Da 50 asesorías", "image_url": "/assets/badges/4.svg", "achieved": false },
            { "id": "5", "name": "Super MAE", "description": "Da 100 asesorías", "image_url": "/assets/badges/5.svg", "achieved": false },
            { "id": "6", "name": "Leyenda MAE", "description": "Da 200 asesorías", "image_url": "/assets/badges/6.svg", "achieved": false },
            { "id": "7", "name": "MAE de MAEs", "description": "Da 500 asesorías", "image_url": "/assets/badges/7.svg", "achieved": false },
            { "id": "8", "name": "Cambio de look", "description": "Añade una foto de perfil", "image_url": "/assets/badges/8.svg", "achieved": false },
            { "id": "9", "name": "Trabajo bien hecho", "description": "Completa 80 horas", "image_url": "/assets/badges/9.svg", "achieved": false },
            { "id": "10", "name": "Siempre a tiempo", "description": "Obtén asistencia perfecta durante 1 periodo", "image_url": "/assets/badges/10.svg", "achieved": false },
            { "id": "11", "name": "Top MAE", "description": "Se #1 en el leaderboard", "image_url": "/assets/badges/11.svg", "achieved": false },
            { "id": "12", "name": "MAE", "description": "Obtén el rol de MAE", "image_url": "/assets/badges/12.svg", "achieved": false },
            { "id": "13", "name": "Coordi", "description": "Obtén el rol de coordi", "image_url": "/assets/badges/13.svg", "achieved": false },
            { "id": "14", "name": "Tecnológico", "description": "Obtén el rol de tecnología", "image_url": "/assets/badges/14.svg", "achieved": false },
            { "id": "15", "name": "Publicista", "description": "Obtén el rol de publicidad", "image_url": "/assets/badges/15.svg", "achieved": false },
            { "id": "16", "name": "Especialista", "description": "Mete 3 materias top", "image_url": "/assets/badges/16.svg", "achieved": false },
            { "id": "17", "name": "Trabajo de campo", "description": "Da 5 asesorías de materias top", "image_url": "/assets/badges/17.svg", "achieved": false },
            { "id": "18", "name": "Ups...", "description": "Pierde puntos de experiencia una vez", "image_url": "/assets/badges/18.svg", "achieved": false }
        ];

        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const userData = doc.data();

            if (eligibleRoles.includes(userData.role)) {
                return updateDoc(userRef, {
                    badges: badges
                });
            } else {
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });

        console.log("Badges have been successfully added to eligible users.");
    } catch (error) {
        console.error("Error adding badges to eligible users: ", error);
        throw error;
    }
}


// actualizar le achieved del usuario 
export async function updateUserAchievementBadge(uid, badgeId) {
    try {

        const userRef = doc(firestoreDB, "users", uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            console.error("Usuario no encontrado");
            return;
        }

        const userData = userDoc.data();
        const badges = userData.badges || [];

        const updatedBadges = badges.map((badge) => {
            if (badge.id === badgeId) {
                return { ...badge, achieved: true };
            }
            return badge;
        });

        await updateDoc(userRef, {
            badges: updatedBadges
        });
        await invalidateUserCaches(uid, { includeLeaderboard: true });

       // console.log(`El logro con id ${badgeId} se ha actualizado correctamente para el usuario ${uid}.`);
    } catch (error) {
        console.error("Error al actualizar el logro del usuario:", error);
        throw error;
    }
}


// Contador de badges
export async function countAchievedBadges(uid) {
    try {
        const user = await getUser(uid);

        if (!user) {
            console.error("Usuario no encontrado");
            return 0;
        }

        const badges = user.badges || [];
        return badges.reduce((count, badge) => count + (badge.achieved ? 1 : 0), 0);
    } catch (error) {
        console.error("Error al contar los logros alcanzados:", error);
        throw error;
    }
}

// A??adir nuevos backgrounds a los usuarios sin borrar los existentes
export async function addBackgroundUsers() {
    try {
        const usersRef = collection(firestoreDB, "users");
        const querySnapshot = await getDocs(usersRef);

        const eligibleRoles = ['admin', 'coordi', 'mae', 'tec', 'publi'];

        const newBackgrounds = [
            { id: '8', image_url: '/assets/back/8.svg', bought: false, price: 100 },
            // Aquí puedes agregar más fondos nuevos...
        ];

        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const userData = doc.data();

            if (eligibleRoles.includes(userData.role)) {
                const currentBackgrounds = userData.background || [];
                
                // Crear un mapa de fondos existentes (para evitar duplicados)
                const backgroundMap = new Map(currentBackgrounds.map(bg => [bg.id, bg]));

                // Añadir los nuevos fondos solo si no existen ya
                newBackgrounds.forEach(bg => {
                    if (!backgroundMap.has(bg.id)) {
                        backgroundMap.set(bg.id, bg);
                    }
                });

                const mergedBackgrounds = Array.from(backgroundMap.values());

                return updateDoc(userRef, {
                    background: mergedBackgrounds,
                    myBackground: userData.myBackground || "/assets/back/1.svg", // conservar el que ya tiene
                    useCoins: userData.useCoins || 0, // conservar las monedas que ya tiene
                });
            } else {
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });

        console.log("Backgrounds have been merged successfully for eligible users.");
    } catch (error) {
        console.error("Error merging backgrounds for eligible users: ", error);
        throw error;
}
}



// actualizar le achieved del usuario 
export async function updateUserBackground(uid, backId, coins, userCoins) {
    try {
        const userRef = doc(firestoreDB, "users", uid);
        const userDoc = await getDoc(userRef);

        if (!userDoc.exists()) {
            console.error("Usuario no encontrado");
            return;
        }

        const userData = userDoc.data();
        const background = userData.background || [];

        const updatedBackground = background.map((back) => {
            if (back.id === backId) {
                return { ...back, bought: true };
            }
            return back;
        });
       
        await updateDoc(userRef, {
            background: updatedBackground,  
            useCoins: userCoins + coins
        });
        await invalidateUserCaches(uid, { includeLeaderboard: true });

        console.log(`El fondo con id ${backId} se ha actualizado correctamente para el usuario ${uid}.`);
    } catch (error) {
        console.error("Error al actualizar el fondo del usuario:", error);
        throw error;
    }
}

// Actualizar fondo
export async function updateUserBackgroundImage(uid, backgroundUrl) {
    try {
        const userRef = doc(firestoreDB, "users", uid);
        await updateDoc(userRef, {
            myBackground: backgroundUrl
        });
        await invalidateUserCaches(uid);
        console.log(`El fondo se ha actualizado a ${backgroundUrl} para el usuario ${uid}.`);
    } catch (error) {
        console.error("Error al actualizar el fondo del usuario:", error);
        throw error;
    }
}


export async function getTotalMaes(options = {}) {
    try {
        const maes = await getMaeDirectory(options);
        return (maes ?? []).filter((user) => user.uid !== 'jackpot').length;
    } catch (error) {
        console.error("Error al obtener el total de MAEs: ", error);
        throw error;
    }
}



// Añadir nuevas variables
export async function addExtraVariables() {
    try {
        const usersRef = collection(firestoreDB, "users");
        const querySnapshot = await getDocs(usersRef);

        const eligibleRoles = ['admin', 'coordi', 'mae', 'tec', 'publi'];

        const promises = querySnapshot.docs.map(async (doc) => {
            const userRef = doc.ref;
            const userData = doc.data();

            if (eligibleRoles.includes(userData.role)) {
                return updateDoc(userRef, {
                    asesoriasGrupales: 0,
                });
            } else {
                return Promise.resolve();
            }
        });

        await Promise.all(promises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });

        console.log("Background have been successfully added to eligible users.");
    } catch (error) {
        console.error("Error adding background to eligible users: ", error);
        throw error;
    }
}



export async function clearUsersData() {
    try {
        const querySnapshot = await getDocs(collection(firestoreDB, "users"));
        const rolesToUpdate = ["admin", "coordi", "mae", "tec", "publi"];
        
        const updatePromises = [];
        
        querySnapshot.forEach(docSnapshot => {
            const userData = docSnapshot.data();
            if (rolesToUpdate.includes(userData.role)) {
                const userRef = doc(firestoreDB, "users", docSnapshot.id);
                updatePromises.push(updateDoc(userRef, {
                    useCoins: userData.useCoins - userData.points,
                    subjects: [],
                    totalTime: 0,
                    points: 0
                }));
            }
        });
        
        await Promise.all(updatePromises);
        await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
        console.log("Usuarios actualizados correctamente.");
    } catch (error) {
        console.error("Error al actualizar usuarios: ", error);
        throw error;
    }
}


export async function resetAllUsersTotalTimeAndPoints({ dryRun = false, batchSize = 450 } = {}) {
  const usersSnap = await getDocs(collection(firestoreDB, "users"));
  if (usersSnap.empty) return { scanned: 0, updated: 0 };

  const docs = usersSnap.docs;
  let updated = 0;

  if (dryRun) {
    return { scanned: docs.length, updated: 0 };
  }

  for (let i = 0; i < docs.length; i += batchSize) {
    const chunk = docs.slice(i, i + batchSize);
    const batch = writeBatch(firestoreDB);

    chunk.forEach((d) => {
      batch.update(d.ref, { totalTime: 0, points: 0 });
    });

    await batch.commit();
    updated += chunk.length;
    console.log(`✅ Restablecimiento en progreso: ${updated}/${docs.length}`);
  }

  await invalidateUserCaches(null, { includeActive: true, includeLeaderboard: true });
  console.log(`Reset complete. Se restablecieron totalTime y points para ${updated} usuarios.`);
  return { scanned: docs.length, updated };
}
