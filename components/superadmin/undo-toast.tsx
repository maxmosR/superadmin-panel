"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react"
import { Loader2, X } from "lucide-react"
import { useI18n } from "@/lib/i18n/client"

// One "Done · Undo" bar for changes that apply at once (a domain disabled, a
// role changed, a section hidden). It says what happened and offers the way
// back for a few seconds; a new change replaces the previous offer. Changes
// that can't be reversed from here (removing a person) keep their confirm
// and don't offer an undo.

interface Offer {
  id: number
  message: string
  undo: () => Promise<void> | void
}

interface UndoApi {
  /** Show `message` with an Annulla button that runs `undo`. */
  offer: (message: string, undo: () => Promise<void> | void) => void
}

const UndoContext = createContext<UndoApi | null>(null)
const SHOW_MS = 8000

export function UndoToastProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const [current, setCurrent] = useState<Offer | null>(null)
  const [busy, setBusy] = useState(false)
  const [undone, setUndone] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const seq = useRef(0)

  const clear = useCallback(() => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    setCurrent(null)
  }, [])

  const offer = useCallback(
    (message: string, undo: Offer["undo"]) => {
      if (timer.current) clearTimeout(timer.current)
      setUndone(null)
      setCurrent({ id: ++seq.current, message, undo })
      timer.current = setTimeout(() => setCurrent(null), SHOW_MS)
    },
    [],
  )

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current)
  }, [])

  const runUndo = async () => {
    if (!current || busy) return
    if (timer.current) clearTimeout(timer.current)
    setBusy(true)
    try {
      await current.undo()
      setUndone(t.common.undone)
    } catch {
      setUndone(t.common.undoFailed)
    } finally {
      setBusy(false)
      setCurrent(null)
      timer.current = setTimeout(() => setUndone(null), 3000)
    }
  }

  const api = useMemo(() => ({ offer }), [offer])
  const text = current?.message ?? undone

  return (
    <UndoContext.Provider value={api}>
      {children}
      {/* Always mounted, so screen readers hear each new message. */}
      <div aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
        {text && (
          <div
            role="status"
            className="pointer-events-auto flex max-w-md items-center gap-3 rounded-lg bg-foreground py-2.5 pr-2 pl-4 text-sm text-background shadow-lg motion-safe:animate-in motion-safe:fade-in-0 motion-safe:slide-in-from-bottom-2"
          >
            <span className="min-w-0">{text}</span>
            {current && (
              <button
                type="button"
                onClick={() => void runUndo()}
                disabled={busy}
                className="inline-flex shrink-0 items-center gap-1 rounded-md px-2 py-1 font-semibold underline underline-offset-2 outline-none hover:bg-background/10 focus-visible:ring-[3px] focus-visible:ring-ring/60"
              >
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
                {t.common.undo}
              </button>
            )}
            <button
              type="button"
              aria-label={t.common.close}
              onClick={() => {
                clear()
                setUndone(null)
              }}
              className="shrink-0 rounded-md p-1 outline-none hover:bg-background/10 focus-visible:ring-[3px] focus-visible:ring-ring/60"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
      </div>
    </UndoContext.Provider>
  )
}

/** Offer an undo for a change that has just applied. Safe outside the provider (does nothing). */
export function useUndoToast(): UndoApi {
  return useContext(UndoContext) ?? { offer: () => {} }
}
