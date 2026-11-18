// Redimensiona y comprime imagenes en el navegador antes de subirlas a Storage.
// Si algo falla, o el resultado pesa mas que el original, se devuelve el archivo original
// para que la subida nunca se rompa por el compresor.

// Calcula el tamano de salida y el recorte de origen.
// mode 'cover': cuadro maxW x maxH recortado al centro.
// mode 'inside': escala manteniendo proporcion, sin ampliar.
// Devuelve null si las dimensiones o los limites no son validos.
export function computeTargetSize(w, h, maxW, maxH, mode = 'inside') {
    if (![w, h, maxW, maxH].every(n => Number.isFinite(n) && n > 0)) {
        return null;
    }

    if (mode === 'cover') {
        const scale = Math.max(maxW / w, maxH / h);
        const sw = maxW / scale;
        const sh = maxH / scale;
        return {
            width: maxW,
            height: maxH,
            sx: (w - sw) / 2,
            sy: (h - sh) / 2,
            sw,
            sh
        };
    }

    const scale = Math.min(1, maxW / w, maxH / h);
    return {
        width: Math.max(1, Math.round(w * scale)),
        height: Math.max(1, Math.round(h * scale)),
        sx: 0,
        sy: 0,
        sw: w,
        sh: h
    };
}

async function decodeImage(file) {
    if (typeof createImageBitmap === 'function') {
        try {
            const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
            return {
                source: bitmap,
                width: bitmap.width,
                height: bitmap.height,
                release: () => bitmap.close?.()
            };
        } catch (error) {
            // Se cae al decodificador de <img>
        }
    }

    const url = URL.createObjectURL(file);
    const img = await new Promise((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = reject;
        el.src = url;
    });
    return {
        source: img,
        width: img.naturalWidth,
        height: img.naturalHeight,
        release: () => URL.revokeObjectURL(url)
    };
}

// Devuelve un Blob JPEG (fondo blanco, para PNG con transparencia) o el archivo original.
export async function compressImage(file, { maxWidth, maxHeight, mode = 'inside', quality = 0.8 } = {}) {
    let decoded = null;
    try {
        decoded = await decodeImage(file);
        const size = computeTargetSize(decoded.width, decoded.height, maxWidth, maxHeight, mode);
        if (!size) {
            return file;
        }

        const canvas = document.createElement('canvas');
        canvas.width = size.width;
        canvas.height = size.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            return file;
        }

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, size.width, size.height);
        ctx.drawImage(decoded.source, size.sx, size.sy, size.sw, size.sh, 0, 0, size.width, size.height);

        const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
        if (!blob || blob.size > file.size) {
            return file;
        }
        return blob;
    } catch (error) {
        console.warn('No se pudo comprimir la imagen, se sube el original:', error);
        return file;
    } finally {
        decoded?.release?.();
    }
}
