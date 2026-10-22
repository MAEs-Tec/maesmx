<script setup>
import { onMounted, ref } from 'vue';
import { getAuth, getAdditionalUserInfo, GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, signOut } from 'firebase/auth';
import { getCurrentUser } from '../../../firebase/db/users';
import router from '../../../router';
import { useRoute } from 'vue-router';

const email = ref('');
const password = ref('');
const errorMsg = ref('');
const userInfo = ref(null);
const loginLoading = ref(false);
const googleLoading = ref(false);
const route = useRoute();

const normalizedEmail = (value) => value.trim().toLowerCase();

onMounted(async () => {
    if (typeof route.query.email === 'string') {
        email.value = normalizedEmail(route.query.email);
    }

    const auth = getAuth();
    userInfo.value = await getCurrentUser();
    if (userInfo.value && auth.currentUser?.emailVerified) {
        await navigateAfterSignIn();
        return;
    }

    const signedInWithGoogle = auth.currentUser?.providerData.some(({ providerId }) => providerId === 'google.com');
    if (auth.currentUser?.emailVerified && signedInWithGoogle) {
        await router.push(registrationTarget());
        return;
    }

    if (auth.currentUser) {
        await signOut(auth);
    }
});

function isValidTecMxEmail(email) {
    const regex = /^[a-zA-Z0-9._%+-]+@tec\.mx$/;
    return regex.test(email);
}

const navigateAfterSignIn = async () => {
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

const registrationTarget = () => {
    const asesoriaId = route.query.asesoriaId || '';
    return {
        path: '/auth/register',
        query: {
            ...(asesoriaId ? { asesoriaId } : {}),
            provider: 'google'
        }
    };
};

const onSignIn = async () => {
    const auth = getAuth();
    errorMsg.value = '';

    if (email.value == '' || password.value == '') {
        errorMsg.value = 'Ingresa tu correo institucional y contraseña.';
        return;
    }

    email.value = normalizedEmail(email.value);
    if (!isValidTecMxEmail(email.value)) {
        errorMsg.value = 'Usa un correo institucional que termine en @tec.mx.';
        return;
    }

    loginLoading.value = true;
    try {
        const userCredential = await signInWithEmailAndPassword(auth, email.value, password.value);
        if (!userCredential.user.emailVerified) {
            errorMsg.value = 'Verifica tu correo antes de continuar. Revisa también la carpeta de spam.';
            return;
        }
        await navigateAfterSignIn();
    } catch (error) {
        switch (error.code) {
            case 'auth/too-many-requests':
                errorMsg.value = 'Hubo demasiados intentos. Espera unos minutos o restablece tu contraseña.';
                break;
            case 'auth/network-request-failed':
                errorMsg.value = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
                break;
            case 'auth/invalid-email':
                errorMsg.value = 'El correo no tiene un formato válido.';
                break;
            default:
                errorMsg.value = 'El correo o la contraseña no son válidos.';
                break;
        }
    } finally {
        loginLoading.value = false;
    }
};

const onGoogleSignIn = async () => {
    const auth = getAuth();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ hd: 'tec.mx', prompt: 'select_account' });
    errorMsg.value = '';
    googleLoading.value = true;

    try {
        const userCredential = await signInWithPopup(auth, provider);
        const googleEmail = normalizedEmail(userCredential.user.email || '');
        const additionalUserInfo = getAdditionalUserInfo(userCredential);
        const hostedDomain = typeof additionalUserInfo?.profile?.hd === 'string' ? additionalUserInfo.profile.hd.toLowerCase() : '';

        if (hostedDomain !== 'tec.mx' || !isValidTecMxEmail(googleEmail) || !userCredential.user.emailVerified) {
            await signOut(auth);
            errorMsg.value = 'Selecciona una cuenta institucional válida de Google (@tec.mx).';
            return;
        }

        const profile = await getCurrentUser({ forceRefresh: true });
        if (!profile) {
            await router.push(registrationTarget());
            return;
        }

        await navigateAfterSignIn();
    } catch (error) {
        switch (error.code) {
            case 'auth/popup-closed-by-user':
                errorMsg.value = 'Se cerró la ventana de Google antes de terminar. Inténtalo nuevamente.';
                break;
            case 'auth/popup-blocked':
                errorMsg.value = 'El navegador bloqueó la ventana de Google. Permite ventanas emergentes e inténtalo de nuevo.';
                break;
            case 'auth/operation-not-allowed':
                errorMsg.value = 'El acceso con Google aún no está habilitado. Contacta al administrador.';
                break;
            case 'auth/unauthorized-domain':
                errorMsg.value = 'Este dominio no está autorizado para iniciar sesión con Google.';
                break;
            case 'auth/network-request-failed':
                errorMsg.value = 'No pudimos conectarnos con Google. Revisa tu conexión e inténtalo de nuevo.';
                break;
            default:
                errorMsg.value = 'No fue posible iniciar sesión con Google. Inténtalo nuevamente.';
                break;
        }
    } finally {
        googleLoading.value = false;
    }
};

function handleRegisterClick() {
    const asesoriaId = route.query.asesoriaId || '';
    router.push({
        path: '/auth/register',
        query: asesoriaId ? { asesoriaId } : {}
    });
}
</script>

<template>
    <div class="surface-ground flex align-items-center justify-content-center min-h-screen min-w-screen overflow-hidden">
        <div class="flex flex-column align-items-center justify-content-center">
            <img src="../../../../public/layout/images/logo-maes.svg" alt="Sakai logo" class="mb-5 w-16rem flex-shrink-0" />
            <div style="border-radius: 56px; padding: 0.3rem; background: linear-gradient(180deg, var(--primary-color) 10%, rgba(33, 150, 243, 0) 30%)">
                <div class="w-full surface-card py-8 px-5 sm:px-8" style="border-radius: 53px">
                    <div class="text-center mb-5">
                        <div class="text-900 text-3xl font-medium mb-3">Bienvenid@ al portal de MAE</div>
                        <span class="text-600 font-medium">Inicia sesión para continuar</span>
                    </div>

                    <div>
                        <Toast />
                        <Button @click="onGoogleSignIn" label="Continuar con Google" icon="pi pi-google" :loading="googleLoading" :disabled="loginLoading" severity="secondary" outlined class="google-button w-full p-3 mb-4 text-xl" />

                        <Divider align="center"><span class="text-600 text-sm px-2">o usa tu contraseña</span></Divider>

                        <form @submit.prevent="onSignIn">
                            <label for="email" class="block text-900 text-xl font-medium mb-2">Correo institucional</label>
                            <InputText id="email" type="email" placeholder="usuario@tec.mx" class="w-full md:w-30rem mb-5" style="padding: 1rem" v-model="email" autocomplete="email" inputmode="email" />

                            <label for="password" class="block text-900 font-medium text-xl mb-2">Contraseña</label>
                            <Password
                                inputId="password"
                                v-model="password"
                                placeholder="Contraseña"
                                :toggleMask="true"
                                class="w-full"
                                inputClass="w-full"
                                :inputProps="{ autocomplete: 'current-password' }"
                                :inputStyle="{ padding: '1rem' }"
                            ></Password>

                            <router-link :to="{ path: '/auth/password-reset', query: email ? { email: email } : {} }" class="block text-center text-indigo-800 w-full mt-3 underline"> ¿Olvidaste tu contraseña? </router-link>
                            <Message v-if="errorMsg" severity="error" class="mt-3" role="alert">{{ errorMsg }}</Message>

                            <!-- <div class="flex align-items-center justify-content-between mb-5 mt-3 gap-5">
                            <div class="flex align-items-center">
                                <Checkbox v-model="checked" id="rememberme1" binary class="mr-2"></Checkbox>
                                <label for="rememberme1">Recuerdame</label>
                            </div>
                            <a class="font-medium no-underline ml-2 text-right cursor-pointer" style="color: var(--primary-color)">Olvidaste tu contraseña?</a>
                        </div> -->
                            <Button type="submit" :loading="loginLoading" :disabled="googleLoading || email == '' || password == ''" label="Iniciar sesión" class="w-full p-3 mt-4 mb-3 text-xl"></Button>
                        </form>
                        <Button @click="handleRegisterClick" label="Crear cuenta con correo" :disabled="loginLoading || googleLoading" class="w-full p-3 text-xl" severity="secondary" />

                        <a href="https://firebasestorage.googleapis.com/v0/b/peer-teaching.appspot.com/o/documents%2FAvisoPrivacidadMaesMx.pdf?alt=media&token=425380a0-f154-4723-b73a-4505a8a4fae2">
                            <p class="text-center text-indigo-800 w-full mt-4 underline cursor-pointer">Aviso de privacidad</p>
                        </a>
                    </div>
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

.google-button {
    min-height: 3.5rem;
}
</style>
