"use client"

import { ArrowRight, CheckCircle2, Circle, CircleAlert } from "lucide-react"
import type { Readiness, SetupSection, SetupStep } from "@/lib/readiness"
import { cn } from "@/lib/utils"
import { useI18n } from "@/lib/i18n/client"

/** One line for the restaurants table: ready, or how far along and what's left. */
export function SetupSummary({ readiness }: { readiness: Readiness }) {
  const { t, fmt } = useI18n()
  const open = readiness.steps.filter((s) => !s.done)

  if (readiness.ready) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-1.5 text-sm font-medium text-green-700">
          <CheckCircle2 className="h-4 w-4" aria-hidden />
          {t.setup.ready}
        </div>
        {/* Only the payout step can be open here: cash still works without it. */}
        {open.length > 0 && <p className="text-xs text-muted-foreground">{t.setup.cashOnly}</p>}
        {readiness.unpublishedZones && <p className="text-xs text-amber-700">{t.setup.unpublishedZones}</p>}
      </div>
    )
  }

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-2 text-sm font-medium">
        <CircleAlert className="h-4 w-4 text-amber-700" aria-hidden />
        <span>
          {t.setup.needsSetup}{" "}
          <span className="font-normal text-muted-foreground tabular-nums">· {fmt(t.setup.progress, { done: readiness.done, total: readiness.total })}</span>
        </span>
      </div>
      <p className="max-w-[18rem] text-xs text-muted-foreground">{fmt(t.setup.missing, { list: open.map((s) => t.setup.steps[s.key]).join(", ") })}</p>
      {readiness.unpublishedZones && <p className="text-xs text-amber-700">{t.setup.unpublishedZones}</p>}
    </div>
  )
}

/**
 * The full checklist at the top of the edit dialog. Each open step jumps to
 * where it's done: a section of the dialog, the zones editor, or (for opening
 * hours) a note that the owner sets them.
 */
export function SetupChecklist({
  readiness,
  zonesHref,
  onJump,
}: {
  readiness: Readiness
  zonesHref: string
  onJump: (section: SetupSection | "payout") => void
}) {
  const { t, fmt } = useI18n()
  return (
    <section aria-labelledby="setup-heading" className="rounded-lg border bg-muted/40 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 id="setup-heading" className="text-sm font-semibold">
          {readiness.ready ? t.setup.ready : t.setup.before}
        </h3>
        <span className="text-xs text-muted-foreground tabular-nums">
          {fmt(t.setup.progress, { done: readiness.done, total: readiness.total })}
        </span>
      </div>
      <ul className="grid gap-x-6 gap-y-2 sm:grid-cols-2">
        {readiness.steps.map((step) => (
          <li key={step.key} className="flex items-start gap-2 text-sm">
            {step.done ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-green-700" aria-hidden />
            ) : (
              <Circle className={cn("mt-0.5 h-4 w-4 shrink-0", step.blocking ? "text-amber-700" : "text-muted-foreground")} aria-hidden />
            )}
            <div className="min-w-0">
              <span className={cn(step.done && "text-muted-foreground")}>
                {t.setup.steps[step.key]}
                <span className="sr-only">: {step.done ? t.common.done : t.common.notDone}</span>
              </span>
              {!step.done && <StepAction step={step} zonesHref={zonesHref} onJump={onJump} />}
            </div>
          </li>
        ))}
      </ul>
    </section>
  )
}

function StepAction({
  step,
  zonesHref,
  onJump,
}: {
  step: SetupStep
  zonesHref: string
  onJump: (section: SetupSection | "payout") => void
}) {
  const linkClass =
    "inline-flex items-center gap-1 rounded-sm text-xs font-medium text-primary underline-offset-2 outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/50"
  const { t } = useI18n()
  const { action } = step
  const hint = step.hint ? t.setup.hints[step.hint] : null

  if (action.kind === "owner") return <p className="text-xs text-muted-foreground">{hint}</p>
  if (action.kind === "zones")
    return (
      <div>
        <a href={zonesHref} className={linkClass}>
          {t.setup.openZones} <ArrowRight className="h-3 w-3" aria-hidden />
        </a>
      </div>
    )
  return (
    <div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      <button type="button" className={linkClass} onClick={() => onJump(action.kind === "payout" ? "payout" : action.section)}>
        {t.setup.setBelow} <ArrowRight className="h-3 w-3" aria-hidden />
      </button>
    </div>
  )
}
