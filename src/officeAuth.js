export function validateOfficeLogin(pin, settings, status) {
  if (status !== 'ready' || !settings?.officePin) {
    return { ok: false, message: 'Office login is temporarily unavailable. Please retry when service is restored.' }
  }
  return String(pin).trim() === String(settings.officePin)
    ? { ok: true, message: '' }
    : { ok: false, message: 'Invalid office PIN.' }
}

export async function checkOfficeLogin(pin, loadSettings) {
  try {
    const settings = await loadSettings()
    return validateOfficeLogin(pin, settings, 'ready')
  } catch {
    return validateOfficeLogin(pin, null, 'error')
  }
}
