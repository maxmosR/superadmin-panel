// The editor's autosave queue, kept free of React so it can be unit-tested.
//
// - schedule(state): debounce; the save starts `delayMs` after the last edit.
// - Only one save is in flight; edits made meanwhile replace the queued
//   state, and only the latest one is sent when the flight ends.
// - A conflict (409 draft_changed) stops the queue for good: the page must
//   reload, never overwrite another window's work.
// - An error keeps the latest state; retry() sends it again.

export type SaveOutcome = "ok" | "conflict" | "error"
export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error" | "conflict"

export interface AutosaveOptions<S> {
  delayMs: number
  send: (state: S) => Promise<SaveOutcome>
  onStatus?: (status: AutosaveStatus) => void
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (handle: unknown) => void
}

export interface Autosave<S> {
  schedule(state: S): void
  /** Send the queued state now (no debounce). */
  flush(): void
  retry(): void
  /** True while a state is waiting or being sent. */
  hasPending(): boolean
  status(): AutosaveStatus
  /** Drop anything queued (after a reload or discard). */
  reset(): void
}

export function createAutosave<S>(opts: AutosaveOptions<S>): Autosave<S> {
  const setTimer = opts.setTimer ?? ((fn, ms) => setTimeout(fn, ms))
  const clearTimer = opts.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  let timer: unknown = null
  let queued: { state: S } | null = null
  let inFlight = false
  let current: AutosaveStatus = "idle"

  const set = (s: AutosaveStatus) => {
    current = s
    opts.onStatus?.(s)
  }

  const stopTimer = () => {
    if (timer !== null) clearTimer(timer)
    timer = null
  }

  const run = async () => {
    stopTimer()
    if (inFlight || !queued || current === "conflict") return
    const { state } = queued
    queued = null
    inFlight = true
    set("saving")
    let outcome: SaveOutcome
    try {
      outcome = await opts.send(state)
    } catch {
      outcome = "error"
    }
    inFlight = false
    if (outcome === "conflict") {
      queued = null
      set("conflict")
      return
    }
    if (outcome === "error") {
      // Keep the newest state for retry(): a newer edit wins over the failed one.
      queued = queued ?? { state }
      set("error")
      return
    }
    if (queued) {
      set("pending")
      void run()
    } else {
      set("saved")
    }
  }

  return {
    schedule(state) {
      if (current === "conflict") return
      queued = { state }
      if (!inFlight) set("pending")
      stopTimer()
      timer = setTimer(() => void run(), opts.delayMs)
    },
    flush() {
      void run()
    },
    retry() {
      if (current === "error") void run()
    },
    hasPending() {
      return inFlight || queued !== null
    },
    status() {
      return current
    },
    reset() {
      stopTimer()
      queued = null
      if (!inFlight) set("idle")
    },
  }
}
