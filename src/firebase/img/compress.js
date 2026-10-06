export async function prepareImage(file, kind = 'profile') {
    const maxBytes = (kind === 'profile' ? 5 : 10) * 1024 * 1024;
    if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > maxBytes) throw new Error(`Selecciona una imagen válida de hasta ${maxBytes / 1024 / 1024} MiB`);
    const bitmap = await createImageBitmap(file);
    const maxDimension = kind === 'profile' ? 640 : 1920;
    const scale = Math.min(1, maxDimension / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
    const result = await new Promise(resolve => canvas.toBlob(resolve, 'image/webp', 0.85));
    if (!result) throw new Error('No se pudo preparar la imagen');
    return result;
}
