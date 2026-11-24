// Restaurant's own Google Analytics 4 / Meta Pixel ids for its storefront (business_configurations).
export const en = {
  title: "Analytics and ads",
  description:
    "The restaurant's own Google Analytics 4 and Meta Pixel ids. The storefront loads each one only after a visitor accepts the matching cookies (analytics or marketing). Leave a field empty to turn that tag off.",
  ga4Label: "Google Analytics 4 measurement id",
  ga4Hint: "In GA4: Admin → Data streams → the shop's web stream. Starts with G-.",
  ga4Placeholder: "G-XXXXXXXXXX",
  pixelLabel: "Meta Pixel id",
  pixelHint: "In Meta Events Manager: Data sources → the Pixel. Digits only.",
  pixelPlaceholder: "1234567890123456",
  save: "Save",
  saving: "Saving…",
  saved: "Saved. The storefront picks it up within a minute.",
  notSet: "Not set: no tracking on this storefront.",
  errors: {
    invalid_ga4_measurement_id: "Not a GA4 measurement id. It looks like G-XXXXXXXXXX (not a UA- id or a property number).",
    invalid_meta_pixel_id: "Not a Meta Pixel id. It's 10 to 20 digits.",
    tracking_unavailable: "Tracking settings aren't available on this database yet.",
    configuration_not_found: "This restaurant has no configuration yet. Save its opening hours first.",
  } as Record<string, string>,
  loadFailed: "Couldn't load the tracking settings ({reason}).",
}

export const it: typeof en = {
  title: "Statistiche e pubblicità",
  description:
    "Gli id Google Analytics 4 e Meta Pixel del ristorante. Lo shop carica ciascuno solo dopo che il visitatore accetta i cookie corrispondenti (analitici o marketing). Lascia vuoto un campo per disattivare quel tag.",
  ga4Label: "ID di misurazione Google Analytics 4",
  ga4Hint: "In GA4: Amministrazione → Stream di dati → lo stream web dello shop. Inizia con G-.",
  ga4Placeholder: "G-XXXXXXXXXX",
  pixelLabel: "ID Meta Pixel",
  pixelHint: "In Meta Gestione eventi: Origini dati → il Pixel. Solo cifre.",
  pixelPlaceholder: "1234567890123456",
  save: "Salva",
  saving: "Salvataggio…",
  saved: "Salvato. Lo shop lo applica entro un minuto.",
  notSet: "Non impostati: nessun tracciamento su questo shop.",
  errors: {
    invalid_ga4_measurement_id: "Non è un ID di misurazione GA4. Ha la forma G-XXXXXXXXXX (non un ID UA- né il numero della proprietà).",
    invalid_meta_pixel_id: "Non è un ID Meta Pixel. È composto da 10 a 20 cifre.",
    tracking_unavailable: "Le impostazioni di tracciamento non sono ancora disponibili su questo database.",
    configuration_not_found: "Questo ristorante non ha ancora una configurazione. Salva prima gli orari di apertura.",
  } as Record<string, string>,
  loadFailed: "Impossibile caricare le impostazioni di tracciamento ({reason}).",
}
