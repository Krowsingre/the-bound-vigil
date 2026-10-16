// Work that must finish before the app quits, such as saving the reading
// position. Quitting waits for it, but never longer than a second.

type Task = () => Promise<unknown>;
const tasks = new Set<Task>();

/** Registers a task; returns a function that removes it again. */
export function onBeforeQuit(task: Task): () => void {
  tasks.add(task);
  return () => tasks.delete(task);
}

export async function runBeforeQuit(limitMs = 1000): Promise<void> {
  const all = Promise.allSettled([...tasks].map((t) => t()));
  await Promise.race([all, new Promise((resolve) => setTimeout(resolve, limitMs))]);
}
