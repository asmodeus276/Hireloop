// Named constant so it's trivial to dial down to 0 for automated tests
// and back up for a live demo.
export const NEGOTIATION_PACING_MS = 2500;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
