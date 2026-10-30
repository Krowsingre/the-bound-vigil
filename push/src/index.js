// TBV's push server. It knows nothing about anyone's books: only each
// library's wake-up name (32 random letters and digits, kept in the
// library's own cloud folder) and the push addresses of the iPhones and
// iPads that share it. When one device has sent changes it asks here, and
// the others get a silent push that wakes TBV to sync.
//
//   POST /register {key, token, sandbox}  this phone wants waking for this library
//   POST /forget   {key, token}           it doesn't any more
//   POST /wake     {key, except}          wake every phone of this library but `except`

const KEY = /^[0-9a-f]{32}$/;
const TOKEN = /^[0-9a-f]{64,200}$/;
/** Phones not heard from in this long are dropped. */
const KEEP_FOR = 60 * 24 * 60 * 60 * 1000;
const MOST_DEVICES = 20;
/** One library is woken at most this often. */
const WAKE_GAP = 15 * 1000;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/") return text("TBV push server");
    if (request.method !== "POST") return text("Not here", 405);
    let body;
    try {
      body = await request.json();
    } catch {
      return text("That isn't JSON", 400);
    }
    if (typeof body?.key !== "string" || !KEY.test(body.key)) return text("No library", 400);
    switch (url.pathname) {
      case "/register":
        return register(env, body);
      case "/forget":
        return forget(env, body);
      case "/wake":
        return wake(env, body);
      default:
        return text("Not here", 404);
    }
  },
};

function text(message, status = 200) {
  return new Response(message, { status, headers: { "content-type": "text/plain" } });
}

function json(value) {
  return new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
}

async function devices(env, key) {
  const list = (await env.DEVICES.get(`devices:${key}`, "json")) ?? [];
  const now = Date.now();
  return list.filter((d) => now - d.at < KEEP_FOR);
}

async function keep(env, key, list) {
  if (list.length === 0) await env.DEVICES.delete(`devices:${key}`);
  else await env.DEVICES.put(`devices:${key}`, JSON.stringify(list));
}

async function register(env, { key, token, sandbox }) {
  if (typeof token !== "string" || !TOKEN.test(token)) return text("No push address", 400);
  const list = (await devices(env, key)).filter((d) => d.token !== token);
  list.push({ token, sandbox: sandbox === true, at: Date.now() });
  await keep(env, key, list.slice(-MOST_DEVICES));
  return json({ devices: Math.min(list.length, MOST_DEVICES) });
}

async function forget(env, { key, token }) {
  const list = await devices(env, key);
  await keep(env, key, list.filter((d) => d.token !== token));
  return json({ ok: true });
}

async function wake(env, { key, except }) {
  const last = Number(await env.DEVICES.get(`woke:${key}`));
  if (last && Date.now() - last < WAKE_GAP) return json({ woken: 0, waited: true });
  await env.DEVICES.put(`woke:${key}`, String(Date.now()), { expirationTtl: 60 });
  const list = await devices(env, key);
  const others = list.filter((d) => d.token !== except);
  if (others.length === 0) return json({ woken: 0 });
  const jwt = await appleToken(env);
  const gone = new Set();
  let woken = 0;
  await Promise.all(
    others.map(async (d) => {
      const host = d.sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
      const response = await fetch(`https://${host}/3/device/${d.token}`, {
        method: "POST",
        headers: {
          authorization: `bearer ${jwt}`,
          "apns-topic": env.TOPIC,
          "apns-push-type": "background",
          "apns-priority": "5",
          "apns-expiration": String(Math.floor(Date.now() / 1000) + 3600),
          // One waiting wake-up per phone is enough.
          "apns-collapse-id": "sync",
        },
        body: JSON.stringify({ aps: { "content-available": 1 } }),
      });
      if (response.ok) {
        woken++;
        return;
      }
      const reason = await response.json().then((r) => r.reason).catch(() => "");
      if (response.status === 410 || reason === "BadDeviceToken" || reason === "DeviceTokenNotForTopic") gone.add(d.token);
      else console.log(`Apple said ${response.status} ${reason}`);
    }),
  );
  if (gone.size > 0) await keep(env, key, list.filter((d) => !gone.has(d.token)));
  return json({ woken });
}

// Apple's sign-in for sending pushes: a token signed with the push key,
// good for an hour; a fresh one is made every 40 minutes.
let signed = null;

async function appleToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (signed && now - signed.at < 40 * 60) return signed.token;
  const pem = env.APNS_KEY_P8.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const part = (value) => base64url(new TextEncoder().encode(JSON.stringify(value)));
  const unsigned = `${part({ alg: "ES256", kid: env.APNS_KEY_ID.trim() })}.${part({ iss: env.APPLE_TEAM_ID.trim(), iat: now })}`;
  const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, new TextEncoder().encode(unsigned));
  signed = { at: now, token: `${unsigned}.${base64url(new Uint8Array(signature))}` };
  return signed.token;
}

function base64url(bytes) {
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
