// Makes the activation key for one Android phone's code, signed with TBV's
// private activation key (the ANDROID_ACTIVATION_KEY secret, a PEM file).
// The app checks it with the public half (crates/tbv-core/src/activation.rs).
//   ACTIVATION_KEY_PEM=... node scripts/android_activation_key.mjs K7QFM-2XHRA
import { createPrivateKey, sign } from "node:crypto";

const code = (process.argv[2] ?? "").replace(/[^0-9a-z]/gi, "").toUpperCase();
if (!/^[A-HJ-NP-Z2-9]{10}$/.test(code)) {
  console.error(`That isn't a phone's code. It looks like K7QFM-2XHRA: ten letters and digits.`);
  process.exit(1);
}
const pem = process.env.ACTIVATION_KEY_PEM ?? "";
if (!pem.includes("PRIVATE KEY")) {
  console.error("The ANDROID_ACTIVATION_KEY secret isn't set.");
  process.exit(1);
}
const key = createPrivateKey(pem);
console.log(sign(null, Buffer.from(`tbv-android-activation:${code}`), key).toString("base64url"));
