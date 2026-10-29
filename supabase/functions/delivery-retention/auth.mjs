export async function authorized(value, secret) {
  if (!value || !secret) return false
  const digest = async (text) => new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))
  const [a, b] = await Promise.all([digest(value), digest(secret)])
  let difference = 0
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i]
  return difference === 0
}
