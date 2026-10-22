<script setup>
import { onMounted, ref } from 'vue';
import { getAuth, sendPasswordResetEmail } from 'firebase/auth';
import { useRoute } from 'vue-router';

const email = ref('');
const errorMsg = ref('');
const resetSent = ref(false);
const loading = ref(false);
const route = useRoute();

onMounted(() => {
    if (typeof route.query.email === 'string') {
        email.value = route.query.email.trim().toLowerCase();
    }
});

function isValidTecMxEmail(email) {
    // Regular expression to match the pattern of (string of characters)@tec.mx
    const regex = /^[a-zA-Z0-9._%+-]+@tec\.mx$/;
    return regex.test(email);
}

const onResetPassword = async () => {
    const auth = getAuth();
    errorMsg.value = '';
    resetSent.value = false;
    email.value = email.value.trim().toLowerCase();

    if (email.value == '') {
        errorMsg.value = 'Ingresa tu correo institucional.';
        return;
    }

    if (!isValidTecMxEmail(email.value)) {
        errorMsg.value = 'Usa un correo institucional que termine en @tec.mx.';
        return;
    }

    loading.value = true;
    try {
        await sendPasswordResetEmail(auth, email.value);
        resetSent.value = true;
    } catch (error) {
        switch (error.code) {
            case 'auth/user-not-found':
                // Mostrar el mismo resultado evita revelar qué correos están registrados.
                resetSent.value = true;
                break;
            case 'auth/too-many-requests':
                errorMsg.value = 'Se solicitaron demasiados correos. Espera unos minutos e inténtalo de nuevo.';
                break;
            case 'auth/network-request-failed':
                errorMsg.value = 'No pudimos conectarnos. Revisa tu conexión e inténtalo de nuevo.';
                break;
            case 'auth/invalid-email':
                errorMsg.value = 'El correo no tiene un formato válido.';
                break;
            default:
                errorMsg.value = 'No pudimos enviar el correo en este momento. Inténtalo nuevamente o contacta al administrador.';
                break;
        }
    } finally {
        loading.value = false;
    }
};

const resetForm = () => {
    resetSent.value = false;
    errorMsg.value = '';
    email.value = '';
};
</script>

<template>
    <div class="surface-ground flex align-items-center justify-content-center min-h-screen min-w-screen overflow-hidden">
        <div class="flex flex-column align-items-center justify-content-center">
            <img src="../../../../public/layout/images/logo-maes.svg" alt="Sakai logo" class="mb-5 w-16rem flex-shrink-0" />
            <div style="border-radius: 56px; padding: 0.3rem; background: linear-gradient(180deg, var(--primary-color) 10%, rgba(33, 150, 243, 0) 30%)">
                <div class="w-full surface-card py-8 px-5 sm:px-8" style="border-radius: 53px">
                    <div class="text-center mb-5">
                        <div class="text-900 text-3xl font-medium mb-3">Restablece tu contraseña</div>
                        <span class="text-600 font-medium line-height-3">Te enviaremos un enlace a tu correo institucional.</span>
                    </div>

                    <form @submit.prevent="onResetPassword">
                        <label for="email" class="block text-900 text-xl font-medium mb-2">Correo institucional</label>
                        <InputText id="email" type="email" placeholder="usuario@tec.mx" class="w-full" style="padding: 1rem" v-model="email" autocomplete="email" inputmode="email" :disabled="loading || resetSent" />

                        <small class="block text-600 mt-2 line-height-3"> Si existe una cuenta con ese correo, recibirás las instrucciones. Revisa spam y la cuarentena de Microsoft 365. </small>

                        <Message v-if="resetSent" severity="success" class="mt-3" role="status"> Solicitud enviada. Revisa tu correo, spam y la cuarentena de Microsoft 365. </Message>
                        <Message v-if="errorMsg" severity="error" class="mt-3" role="alert">{{ errorMsg }}</Message>

                        <Button v-if="!resetSent" type="submit" :loading="loading" :disabled="email == ''" label="Enviar enlace" class="w-full p-3 mt-4 mb-3 text-xl" />
                        <Button v-else type="button" @click="resetForm" label="Enviar a otro correo" severity="secondary" class="w-full p-3 mt-4 mb-3 text-xl" />

                        <router-link :to="{ path: '/auth/login', query: email ? { email: email } : {} }" class="block text-center text-indigo-800 w-full mt-2 mb-4 underline"> Regresar al inicio de sesión </router-link>

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

<style scoped></style>
