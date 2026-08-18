const enc = new TextEncoder();

function b64url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64url(value) {
  const encoded = String(value || "");
  if (!encoded || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error("Invalid base64url");
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(encoded.length / 4) * 4, "=");
  const binary = atob(padded);
  const decoded = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  if (b64url(decoded) !== encoded) throw new Error("Non-canonical base64url");
  return decoded;
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, enc.encode(value)));
}

export async function auditDigest(secret, value) {
  if (secret) return b64url(await hmac(secret, `audit:${value}`));
  return `unsigned:${await hashIdentity(value)}`;
}

function rotationWindow(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export async function issueSession(secret, actorHash, ttlSeconds = 14400) {
  if (!secret || secret.length < 24) throw new Error("SESSION_SIGNING_KEY must be configured as a strong Worker secret");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    v: 1,
    actor: actorHash,
    csrf: b64url(crypto.getRandomValues(new Uint8Array(18))),
    iat: now,
    exp: now + Math.max(300, Math.min(Number(ttlSeconds || 14400), 86400)),
    kid: rotationWindow(),
  };
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const signature = b64url(await hmac(secret, `session:${payload.kid}:${body}`));
  return { token: `${body}.${signature}`, csrf: payload.csrf, expires_at: new Date(payload.exp * 1000).toISOString(), key_window: payload.kid };
}

export async function verifySession(secret, token) {
  try {
    const [body, signature] = String(token || "").split(".");
    if (!body || !signature) return null;
    const payload = JSON.parse(new TextDecoder().decode(fromB64url(body)));
    const now = Math.floor(Date.now() / 1000);
    if (payload.v !== 1 || !payload.actor || !payload.csrf || payload.exp <= now || payload.iat > now + 60) return null;
    const allowed = [rotationWindow(), rotationWindow(new Date(Date.now() - 86400000))];
    if (!allowed.includes(payload.kid)) return null;
    const expected = await hmac(secret, `session:${payload.kid}:${body}`);
    const received = fromB64url(signature);
    if (expected.length !== received.length) return null;
    let diff = 0;
    for (let i = 0; i < expected.length; i += 1) diff |= expected[i] ^ received[i];
    return diff === 0 ? payload : null;
  } catch {
    return null;
  }
}

export async function hashIdentity(value) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(String(value || "")));
  return b64url(new Uint8Array(digest));
}

export function cookieValue(request, name) {
  const cookies = request.headers.get("cookie") || "";
  for (const part of cookies.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

export function sessionCookie(token, maxAge = 14400) {
  return `amhwt_session=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

export function clearSessionCookie() {
  return "amhwt_session=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0";
}
