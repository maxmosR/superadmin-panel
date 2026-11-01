// Readiness: the steps before a restaurant can take orders (lib/readiness.ts).
export const en = {
  steps: {
    owner: "Owner",
    domain: "Active domain",
    sms: "SMS sender",
    order_email: "Order email",
    payout: "Payout account",
    zones: "Delivery zones",
    hours: "Opening hours",
  },
  hints: {
    sms: "Register the name at OpenAPI.com first.",
    payoutWaiting: "Waiting for Stripe to enable charges and payouts.",
    payoutCard: "Needed for card payments.",
    hours: "The owner sets them in the restaurant's admin panel.",
  },
  ready: "Ready to take orders",
  cashOnly: "Cash only until the payout account is ready",
  unpublishedZones: "Unpublished zone changes",
  needsSetup: "Needs setup",
  progress: "{done} of {total} done",
  missing: "Missing: {list}",
  before: "Before it can take orders",
  openZones: "Open the zones editor",
  setBelow: "Set it below",
}

export const it: typeof en = {
  steps: {
    owner: "Titolare",
    domain: "Dominio attivo",
    sms: "Mittente SMS",
    order_email: "Email ordini",
    payout: "Conto incassi",
    zones: "Zone di consegna",
    hours: "Orari di apertura",
  },
  hints: {
    sms: "Prima registra il nome su OpenAPI.com.",
    payoutWaiting: "In attesa che Stripe attivi incassi e bonifici.",
    payoutCard: "Serve per i pagamenti con carta.",
    hours: "Li imposta il titolare nel pannello del ristorante.",
  },
  ready: "Pronto a ricevere ordini",
  cashOnly: "Solo contanti finché il conto incassi non è pronto",
  unpublishedZones: "Modifiche alle zone non pubblicate",
  needsSetup: "Da configurare",
  progress: "{done} di {total} fatti",
  missing: "Manca: {list}",
  before: "Prima di poter ricevere ordini",
  openZones: "Apri l'editor delle zone",
  setBelow: "Impostalo qui sotto",
}
