export function fitImage(width, height, maxEdge = 1600) {
  const scale = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

export async function compressProofPhoto(file) {
  if (!file.type.startsWith('image/')) throw new Error('Please choose an image.')
  if (file.size > 30 * 1024 * 1024) throw new Error('Please choose a photo smaller than 30 MB.')
  const url = URL.createObjectURL(file)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const size = fitImage(image.naturalWidth, image.naturalHeight)
    const canvas = document.createElement('canvas')
    Object.assign(canvas, size)
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Photo processing is unavailable on this device.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, size.width, size.height)
    context.drawImage(image, 0, 0, size.width, size.height)
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.78))
    if (!blob) throw new Error('Could not process this photo. Please choose another image.')
    // Avoid making an already small JPEG larger when its dimensions are within bounds.
    return file.type === 'image/jpeg' && file.size < blob.size
      && image.naturalWidth <= 1600 && image.naturalHeight <= 1600 ? file : blob
  } finally {
    URL.revokeObjectURL(url)
  }
}
