"use client"

import { MapPinOff, RotateCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useI18n } from "@/lib/i18n/client"

/** What the map area shows when the map can't run. The steps beside it still work. */
export function MapOff({ detail, onRetry }: { detail?: string; onRetry: () => void }) {
  const { t } = useI18n()
  return (
    <div
      role="alert"
      className="flex h-full min-h-[420px] w-full flex-col items-center justify-center gap-3 rounded-md border bg-muted p-6 text-center"
    >
      <MapPinOff className="h-6 w-6 text-muted-foreground" aria-hidden />
      <div className="max-w-sm space-y-1">
        <p className="font-medium">{t.zones.map.off}</p>
        <p className="text-sm text-muted-foreground">{t.zones.map.offBody}</p>
        {detail && <p className="text-xs text-muted-foreground">{detail}</p>}
      </div>
      <Button variant="outline" size="sm" onClick={onRetry}>
        <RotateCw className="h-4 w-4" aria-hidden />
        {t.zones.map.reload}
      </Button>
    </div>
  )
}
