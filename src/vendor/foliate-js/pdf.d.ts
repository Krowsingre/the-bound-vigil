// Types for foliate-js's PDF book. Not part of upstream.
export function makePDF(file: Blob): Promise<{ getCover(): Promise<Blob | null>; destroy(): void }>;
