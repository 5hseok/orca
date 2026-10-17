// Why: React 19.2's dev build records every component render with performance.measure()
// and nothing clears the timeline, so a long `pnpm dev` session grows the renderer by GBs.
const TRIM_INTERVAL_MS = 60_000

export function installReactDevPerformanceMeasureTrim(): void {
  if (typeof performance === 'undefined' || typeof performance.clearMeasures !== 'function') {
    return
  }
  window.setInterval(() => performance.clearMeasures(), TRIM_INTERVAL_MS)
}
