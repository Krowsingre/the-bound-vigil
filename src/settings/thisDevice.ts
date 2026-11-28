/** What this device is called in Attunement's words: "On this iPhone", "On this computer". */
export function thisDevice(): string {
  if (typeof navigator === "undefined") return "computer";
  const ua = navigator.userAgent;
  if (/iPad/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)) return "iPad";
  if (/iPhone|iPod/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "phone";
  if (/Macintosh/.test(ua)) return "Mac";
  return "computer";
}
