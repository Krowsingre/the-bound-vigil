// Tries the push server with a pretend Apple and a pretend KV store:
// node push/test.mjs
import assert from "node:assert/strict";
import server from "./src/index.js";

const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
const der = Buffer.from(await crypto.subtle.exportKey("pkcs8", pair.privateKey)).toString("base64");
const store = new Map();
const env = {
  TOPIC: "com.krowsingre.theboundvigil",
  APNS_KEY_P8: `-----BEGIN PRIVATE KEY-----\n${der.match(/.{1,64}/g).join("\n")}\n-----END PRIVATE KEY-----\n`,
  APNS_KEY_ID: "KEYID12345",
  APPLE_TEAM_ID: "TEAMID1234",
  DEVICES: {
    get: async (k, type) => (store.has(k) ? (type === "json" ? JSON.parse(store.get(k)) : store.get(k)) : null),
    put: async (k, v) => void store.set(k, v),
    delete: async (k) => void store.delete(k),
  },
};
const sent = [];
globalThis.fetch = async (url, init) => {
  sent.push({ url, init });
  return url.includes("dead") ? new Response('{"reason":"BadDeviceToken"}', { status: 400 }) : new Response("", { status: 200 });
};
const call = async (path, body) => {
  const r = await server.fetch(new Request(`https://push.test${path}`, { method: "POST", body: JSON.stringify(body) }), env);
  return [r.status, r.headers.get("content-type") === "application/json" ? await r.json() : await r.text()];
};

const key = "0123456789abcdef0123456789abcdef";
const [phone, ipad, dead] = ["1".repeat(64), "2".repeat(64), "dead".repeat(16)];
assert.deepEqual(await call("/register", { key, token: phone }), [200, { devices: 1 }]);
assert.deepEqual(await call("/register", { key, token: ipad, sandbox: true }), [200, { devices: 2 }]);
assert.deepEqual(await call("/register", { key, token: phone }), [200, { devices: 2 }]);
assert.deepEqual(await call("/register", { key, token: dead }), [200, { devices: 3 }]);

// The phone that sent the changes isn't woken; the others are, the iPad through Apple's test service.
assert.deepEqual(await call("/wake", { key, except: phone }), [200, { woken: 1 }]);
assert.deepEqual(sent.map((s) => new URL(s.url).host).sort(), ["api.push.apple.com", "api.sandbox.push.apple.com"]);
const push = sent.find((s) => s.url.endsWith(ipad));
assert.equal(push.init.headers["apns-push-type"], "background");
assert.equal(push.init.headers["apns-topic"], "com.krowsingre.theboundvigil");
assert.deepEqual(JSON.parse(push.init.body), { aps: { "content-available": 1 } });

// Apple's sign-in token is signed with the push key.
const [head, claims, signature] = push.init.headers.authorization.slice("bearer ".length).split(".");
const read = (part) => JSON.parse(Buffer.from(part, "base64url").toString());
assert.deepEqual(read(head), { alg: "ES256", kid: "KEYID12345" });
assert.equal(read(claims).iss, "TEAMID1234");
assert.ok(
  await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pair.publicKey, Buffer.from(signature, "base64url"), new TextEncoder().encode(`${head}.${claims}`)),
);

// A push address Apple says is gone is dropped; a second wake right away waits.
assert.deepEqual(JSON.parse(store.get(`devices:${key}`)).map((d) => d.token), [ipad, phone]);
assert.deepEqual(await call("/wake", { key }), [200, { woken: 0, waited: true }]);

assert.deepEqual(await call("/forget", { key, token: ipad }), [200, { ok: true }]);
assert.deepEqual(JSON.parse(store.get(`devices:${key}`)).map((d) => d.token), [phone]);
assert.equal((await call("/wake", { key: "not a library" }))[0], 400);
assert.equal((await call("/register", { key, token: "not a phone" }))[0], 400);
console.log("Push server: all good");
