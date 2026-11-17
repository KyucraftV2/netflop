/**
 * Minuterie robuste en arrière-plan : les navigateurs ralentissent fortement les
 * setInterval des onglets cachés (jusqu'à 1/min), ce qui ferait expirer le heartbeat.
 * Un Web Worker dédié n'est pas soumis à ce bridage intensif.
 */
export function createTicker(intervalMs: number, onTick: () => void): () => void {
  if (typeof Worker !== "undefined" && typeof Blob !== "undefined") {
    try {
      const src = `setInterval(() => postMessage(0), ${Math.max(1000, Math.floor(intervalMs))});`;
      const url = URL.createObjectURL(new Blob([src], { type: "text/javascript" }));
      const worker = new Worker(url);
      worker.onmessage = () => onTick();
      return () => {
        worker.terminate();
        URL.revokeObjectURL(url);
      };
    } catch {
      /* CSP ou navigateur ancien : repli sur setInterval */
    }
  }
  const id = window.setInterval(onTick, intervalMs);
  return () => window.clearInterval(id);
}
