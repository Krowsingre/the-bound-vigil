export function percent(progression: number | null | undefined): string {
  if (progression == null) return "0%";
  return `${Math.round(Math.min(1, Math.max(0, progression)) * 100)}%`;
}

export function authorLine(authors: string[]): string {
  if (authors.length === 0) return "Unknown author";
  if (authors.length <= 2) return authors.join(" & ");
  return `${authors[0]} and ${authors.length - 1} others`;
}

export function relativeTime(iso: string, now = Date.now()): string {
  const seconds = Math.round((now - Date.parse(iso)) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(iso).toLocaleDateString();
}

/** Stable small number from a string, used to vary generated covers. */
export function hashOf(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

export function greeting(date = new Date()): string {
  const hour = date.getHours();
  if (hour < 5) return "Good evening";
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
