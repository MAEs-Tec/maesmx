<script setup>
import { useToast } from 'primevue/usetoast';
import { computed, onMounted, ref } from 'vue';
import { getAuth, createUserWithEmailAndPassword, sendEmailVerification, signOut } from 'firebase/auth';
import router from '../../../router';
import { getCampuses } from '../../../firebase/db/campuses';
import { getMajors } from '../../../firebase/db/majors';
import { createUser, getCurrentUser } from '../../../firebase/db/users';
import { useRoute } from 'vue-router';

const toast = useToast();
const route = useRoute();
const campuses = ref([]);
const majors = ref([]);

const newUserInfo = ref({
    firstname: null,
    lastname: null,
    name: null,
    campus: null,
    major: null,
    career: null,
    area: null,
    subjects: [],
    weekSchedule: {},
    totalTime: 0,
    status: 'estudiante',
    role: 'user',
    email: null,
    id: null,
    uid: null
});

const password1 = ref('');
const password2 = ref('');
const errorMsg = ref('');
const isGoogleRegistration = ref(false);
const isSaving = ref(false);

const normalizeEmail = (value) => (value || '').trim().toLowerCase();

onMounted(async () => {
    try {
        [campuses.value, majors.value] = await Promise.all([getCampuses(), getMajors()]);

        const auth = getAuth();
        const currentUser = auth.currentUser;
        const signedInWithGoogle = currentUser?.providerData.some(({ providerId }) => providerId === 'google.com');

        if (route.query.provider !== 'google' || !signedInWithGoogle) {
            return;
        }

        const googleEmail = normalizeEmail(currentUser.email);
        if (!isValidTecMxEmail(googleEmail) || !currentUser.emailVerified) {
            await signOut(auth);
            errorMsg.value = 'La sesión de Google no corresponde a una cuenta institucional válida.';
            return;
        }

        const existingProfile = await getCurrentUser({ forceRefresh: true });
        if (existingProfile) {
            await navigateAfterRegistration();
            return;
        }

        isGoogleRegistration.value = true;
        newUserInfo.value.email = googleEmail;

        const displayName = (currentUser.displayName || '').trim();
        const nameParts = displayName.split(/\s+/).filter(Boolean);
        if (nameParts.length > 0) {
            newUserInfo.value.firstname = nameParts.shift();
            newUserInfo.value.lastname = nameParts.join(' ');
        }
    } catch (error) {
        console.error(error);
        errorMsg.value = 'No pudimos cargar el formulario de registro. Recarga la página e inténtalo nuevamente.';
    }
});

// Helper function to check if any required field is empty
const isAnyFieldEmpty = () => {
    return !newUserInfo.value.email || !newUserInfo.value.firstname || !newUserInfo.value.lastname || !newUserInfo.value.campus || !newUserInfo.value.major || (!isGoogleRegistration.value && (!password1.value || !password2.value));
};

function isValidTecMxEmail(email) {
    // Regular expression to match the pattern of (string of characters)@tec.mx
    const regex = /^[a-zA-Z0-9._%+-]+@tec\.mx$/;
    return regex.test(email);
}

const checkPassword = (password) => {
    return password.length >= 8 && /[A-Z]/.test(password) && /[a-z]/.test(password) && /\d/.test(password) && /[^a-zA-Z0-9\s]/.test(password);
};

const canSubmit = computed(() => !isAnyFieldEmpty());

const onSignUp = async () => {
    const auth = getAuth();
    errorMsg.value = '';
    newUserInfo.value.email = normalizeEmail(newUserInfo.value.email);

    if (!isFormValid()) {
        return;
    }

    isSaving.value = true;
    try {
        if (isGoogleRegistration.value) {
            const isSameGoogleUser = auth.currentUser?.providerData.some(({ providerId }) => providerId === 'google.com') && normalizeEmail(auth.currentUser.email) === newUserInfo.value.email && auth.currentUser.emailVerified;

            if (!isSameGoogleUser) {
                errorMsg.value = 'Tu sesión de Google terminó. Regresa al inicio e inicia sesión nuevamente.';
                return;
            }

            await createUser(newUserInfo.value);
            toast.add({ severity: 'success', summary: 'Perfil creado', detail: 'Tu cuenta institucional quedó lista.', life: 4000 });
            await navigateAfterRegistration();
            return;
        }

        const userCredential = await createUserWithEmailAndPassword(auth, newUserInfo.value.email, password1.value);
        await sendEmailVerification(userCredential.user);
        await createUser(newUserInfo.value);
        await signOut(auth);
        await router.push(loginTarget());
        toast.add({
            severity: 'info',
            summary: 'Cuenta creada correctamente',
            detail: 'Verifica tu correo antes de iniciar sesión. Revisa también spam.',
            life: 5000
        });
    } catch (error) {
        console.error(error);
        switch (error.code) {
            case 'auth/email-already-in-use':
                errorMsg.value = 'Ese correo ya tiene una cuenta. Inicia sesión o restablece tu contraseña.';
                break;
            case 'auth/network-request-failed':
                errorMsg.value = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
                break;
            case 'auth/too-many-requests':
                errorMsg.value = 'Hubo demasiados intentos. Espera unos minutos e inténtalo de nuevo.';
                break;
            default:
                errorMsg.value = 'No pudimos crear la cuenta. Inténtalo nuevamente o contacta al administrador.';
                break;
        }
    } finally {
        isSaving.value = false;
    }
};

// Function to validate the entire form
const isFormValid = () => {
    // Check if the email is a valid TecMx email
    if (!isValidTecMxEmail(newUserInfo.value.email)) {
        errorMsg.value = 'Por favor inicia sesión con un correo válido (@tec.mx)';
        return false;
    }

    if (!isGoogleRegistration.value && password1.value !== password2.value) {
        errorMsg.value = 'Por favor asegurate de que las contraseñas coincidan';
        return false;
    }

    if (!isGoogleRegistration.value && !checkPassword(password1.value)) {
        errorMsg.value = 'Por favor asegurate de la contraseña cumpla con los requisitos (8 caracteres, mayusculas y minusculas, números y caracteres especiales)';
        return false;
    }

    // Check if any required field is empty
    if (isAnyFieldEmpty()) {
        errorMsg.value = 'Por favor ingresa todos los campos';
        return false;
    }

    // If all checks pass, return true
    return true;
};

const loginTarget = () => {
    const asesoriaId = route.query.asesoriaId || '';
    return {
        path: '/auth/login',
        query: {
            ...(asesoriaId ? { asesoriaId } : {}),
            ...(newUserInfo.value.email ? { email: newUserInfo.value.email } : {})
        }
    };
};

const navigateAfterRegistration = async () => {
    const asesoriaId = route.query.asesoriaId || '';
    if (asesoriaId) {
        await router.push({
            path: '/asesoriasGrupales',
            query: { asesoriaId }
        });
        return;
    }
    await router.push('/inicio');
};

async function handleLoginClick() {
    if (isGoogleRegistration.value) {
        await signOut(getAuth());
    }
    await router.push(loginTarget());
}
</script>

<template>
    <div class="surface-ground flex align-items-center justify-content-center min-h-screen min-w-screen overflow-hidden">
        <div class="flex flex-column align-items-center justify-content-center">
            <img src="../../../../public/layout/images/logo-maes.svg" alt="Sakai logo" class="mb-5 w-16rem flex-shrink-0" />
            <div style="border-radius: 56px; padding: 0.3rem; background: linear-gradient(180deg, var(--primary-color) 10%, rgba(33, 150, 243, 0) 30%)">
                <div class="w-full surface-card py-8 px-5 sm:px-8" style="border-radius: 53px">
                    <div class="text-center mb-5">
                        <div class="text-900 text-3xl font-medium mb-3">
                            {{ isGoogleRegistration ? 'Completa tu perfil' : 'Crea tu cuenta de MAE' }}
                        </div>
                        <span class="text-600 font-medium">
                            {{ isGoogleRegistration ? 'Solo necesitamos algunos datos del Tec para continuar' : 'Regístrate para continuar' }}
                        </span>
                    </div>

                    <form @submit.prevent="onSignUp">
                        <Message v-if="isGoogleRegistration" severity="info" class="mb-4"> Iniciaste sesión con Google. No necesitas crear otra contraseña. </Message>

                        <label for="email" class="block text-900 text-xl font-medium mb-2">Correo institucional</label>
                        <InputText id="email" type="email" placeholder="usuario@tec.mx" class="w-full mb-5" v-model="newUserInfo.email" autocomplete="email" inputmode="email" :disabled="isGoogleRegistration || isSaving" />

                        <label for="firstname" class="block text-900 text-xl font-medium mb-2">Nombre</label>
                        <InputText id="firstname" v-model="newUserInfo.firstname" placeholder="Nombre" class="w-full mb-4" autocomplete="given-name" :disabled="isSaving" />

                        <label for="lastname" class="block text-900 text-xl font-medium mb-2">Apellido</label>
                        <InputText id="lastname" v-model="newUserInfo.lastname" placeholder="Apellido" class="w-full mb-4" autocomplete="family-name" :disabled="isSaving" />

                        <label for="career" class="block text-900 text-xl font-medium mb-2">Carrera</label>
                        <Dropdown inputId="career" v-model="newUserInfo.major" :options="majors" filter optionLabel="name" placeholder="Carrera" checkmark :highlightOnSelect="false" class="w-12 mb-4" :disabled="isSaving" />

                        <label for="campus" class="block text-900 text-xl font-medium mb-2">Campus</label>
                        <Dropdown inputId="campus" v-model="newUserInfo.campus" :options="campuses" optionValue="id" filter optionLabel="name" placeholder="Campus" checkmark :highlightOnSelect="false" class="w-12 mb-4" :disabled="isSaving" />

                        <template v-if="!isGoogleRegistration">
                            <label for="password1" class="block text-900 font-medium text-xl mb-2">Contraseña diferente a la institucional</label>
                            <Password
                                inputId="password1"
                                v-model="password1"
                                placeholder="Contraseña"
                                :toggleMask="true"
                                class="w-full mb-4"
                                inputClass="w-full"
                                :disabled="isSaving"
                                :inputProps="{ autocomplete: 'new-password' }"
                                :inputStyle="{ padding: '1rem' }"
                            >
                                <template #header>
                                    <h6>Introduce tu contraseña diferente a la institucional</h6>
                                </template>
                                <template #footer>
                                    <Divider />
                                    <p class="mt-2">La contraseña debe contener:</p>
                                    <ul class="pl-2 ml-2 mt-0 leading-6">
                                        <li><i class="pi font-bold" :class="password1.length >= 8 ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> La longitud mínima es de 8 caracteres.</li>
                                        <li><i class="pi font-bold" :class="/[A-Z]/.test(password1) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos una letra mayúscula.</li>
                                        <li><i class="pi font-bold" :class="/[a-z]/.test(password1) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos una letra minúscula.</li>
                                        <li><i class="pi font-bold" :class="/\d/.test(password1) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos un dígito numérico.</li>
                                        <li>
                                            <i class="pi font-bold" :class="/[`!@#$%^&*()_+\-=\[\]{};':\\|,.<>\/?~]/.test(password1) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos un carácter especial
                                            (!, @, #, $, etc.).
                                        </li>
                                    </ul>
                                </template>
                            </Password>

                            <label for="password2" class="block text-900 font-medium text-xl mb-2">Repetir contraseña</label>
                            <Password
                                inputId="password2"
                                v-model="password2"
                                placeholder="Contraseña"
                                :toggleMask="true"
                                class="w-full"
                                inputClass="w-full"
                                :disabled="isSaving"
                                :inputProps="{ autocomplete: 'new-password' }"
                                :inputStyle="{ padding: '1rem' }"
                            >
                                <template #header>
                                    <h6>Introduce tu contraseña</h6>
                                </template>
                                <template #footer>
                                    <Divider />
                                    <p class="mt-2">La contraseña debe contener:</p>
                                    <ul class="pl-2 ml-2 mt-0 leading-6">
                                        <li><i class="pi font-bold" :class="password2.length >= 8 ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> La longitud mínima es de 8 caracteres.</li>
                                        <li><i class="pi font-bold" :class="/[A-Z]/.test(password2) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos una letra mayúscula.</li>
                                        <li><i class="pi font-bold" :class="/[a-z]/.test(password2) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos una letra minúscula.</li>
                                        <li><i class="pi font-bold" :class="/\d/.test(password2) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos un dígito numérico.</li>
                                        <li>
                                            <i class="pi font-bold" :class="/[`!@#$%^&*()_+\-=\[\]{};':\\|,.<>\/?~]/.test(password2) ? 'pi-check-circle text-green-500' : 'pi-times-circle text-red-500'"></i> Se requiere al menos un carácter especial
                                            (!, @, #, $, etc.).
                                        </li>
                                    </ul>
                                </template>
                            </Password>
                            <div class="text-center max-w-full mt-4">
                                <p class="text-600 font-medium">Recuerda usar una contraseña única y diferente a la que utilizas en otras cuentas, incluido tu correo institucional</p>
                            </div>
                        </template>

                        <Message v-if="errorMsg" severity="error" class="mt-3" role="alert">{{ errorMsg }}</Message>
                        <Divider />
                        <Button type="submit" :label="isGoogleRegistration ? 'Guardar y continuar' : 'Registrarse'" :loading="isSaving" :disabled="!canSubmit" class="w-full p-3 mb-3 text-xl"></Button>
                        <Button type="button" @click="handleLoginClick" :label="isGoogleRegistration ? 'Cancelar' : 'Iniciar sesión'" :disabled="isSaving" class="w-full p-3 mb-3 text-xl" severity="secondary"></Button>
                        <a href="https://firebasestorage.googleapis.com/v0/b/peer-teaching.appspot.com/o/documents%2FAvisoPrivacidadMaesMx.pdf?alt=media&token=425380a0-f154-4723-b73a-4505a8a4fae2">
                            <p class="text-center text-indigo-800 w-full mt-4 underline cursor-pointer">Aviso de privacidad</p>
                        </a>
                    </form>
                </div>
            </div>
        </div>
    </div>
    <!-- <AppConfig simple /> -->
</template>

<style scoped>
.pi-eye {
    transform: scale(1.6);
    margin-right: 1rem;
}

.pi-eye-slash {
    transform: scale(1.6);
    margin-right: 1rem;
}
</style>
