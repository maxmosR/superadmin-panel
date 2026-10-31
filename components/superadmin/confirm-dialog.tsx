"use client"

import type React from "react"
import { useCallback, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

export interface ConfirmOptions {
  /** A question that names what is affected: "Remove Mario Rossi from Trattoria da Mario?" */
  title: string
  /** What happens, in plain words, and whether it can be undone. */
  description: React.ReactNode
  confirmLabel: string
  /** Red confirm button for removals and other changes that take something away. */
  destructive?: boolean
}

/**
 * One confirmation pattern for every change that takes effect at once and
 * can't simply be undone. `confirm()` resolves true only on the confirm
 * button; Esc, Cancel and clicking outside resolve false. Focus starts on
 * Cancel so Enter never confirms by accident, and goes back to whatever
 * opened it.
 *
 *   const { confirm, dialog } = useConfirm()
 *   if (await confirm({ ... })) doIt()
 *   return <>{...}{dialog}</>
 */
export function useConfirm() {
  const [options, setOptions] = useState<ConfirmOptions | null>(null)
  const resolver = useRef<((ok: boolean) => void) | null>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((o: ConfirmOptions) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
    setOptions(o)
    return new Promise<boolean>((resolve) => {
      resolver.current = resolve
    })
  }, [])

  const settle = (ok: boolean) => {
    resolver.current?.(ok)
    resolver.current = null
    setOptions(null)
  }

  const dialog = (
    <Dialog open={!!options} onOpenChange={(open) => !open && settle(false)}>
      <DialogContent
        role="alertdialog"
        className="sm:max-w-md"
        showCloseButton={false}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
        onCloseAutoFocus={(e) => {
          if (returnFocus.current?.isConnected) {
            e.preventDefault()
            returnFocus.current.focus()
          }
        }}
      >
        {options && (
          <>
            <DialogHeader>
              <DialogTitle>{options.title}</DialogTitle>
              <DialogDescription asChild>
                <div className="space-y-2">{options.description}</div>
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button ref={cancelRef} variant="outline" onClick={() => settle(false)}>
                Cancel
              </Button>
              <Button variant={options.destructive ? "destructive" : "default"} onClick={() => settle(true)}>
                {options.confirmLabel}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )

  return { confirm, dialog }
}
