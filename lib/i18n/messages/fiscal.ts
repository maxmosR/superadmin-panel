// Restaurant's fiscal id for its electronic receipts (business_fiscal_settings).
export const en = {
  title: "Receipts",
  description: "The restaurant's own VAT number or tax code, printed on its electronic receipts. Without it the admin panel can't issue receipts.",
  label: "VAT number (P.IVA) or tax code",
  hint: "11 digits (P.IVA) or 16 characters (codice fiscale).",
  placeholder: "01234567897",
  save: "Save",
  saving: "Saving…",
  saved: "Saved.",
  notSet: "Not set: receipts are off for this restaurant.",
  updated: "Last changed {date}.",
  errors: {
    invalid_fiscal_id: "Not a valid P.IVA (11 digits) or codice fiscale (16 characters). Check for typos.",
    fiscal_settings_unavailable: "Receipt settings aren't available on this database yet.",
  } as Record<string, string>,
  loadFailed: "Couldn't load the receipt settings ({reason}).",
}

export const it: typeof en = {
  title: "Scontrini",
  description: "La partita IVA o il codice fiscale del ristorante, riportati sui suoi scontrini elettronici. Senza, il pannello admin non può emettere scontrini.",
  label: "Partita IVA o codice fiscale",
  hint: "11 cifre (P.IVA) o 16 caratteri (codice fiscale).",
  placeholder: "01234567897",
  save: "Salva",
  saving: "Salvataggio…",
  saved: "Salvato.",
  notSet: "Non impostato: gli scontrini sono disattivati per questo ristorante.",
  updated: "Ultima modifica {date}.",
  errors: {
    invalid_fiscal_id: "Non è una P.IVA (11 cifre) o un codice fiscale (16 caratteri) valido. Controlla eventuali errori di battitura.",
    fiscal_settings_unavailable: "Le impostazioni degli scontrini non sono ancora disponibili su questo database.",
  } as Record<string, string>,
  loadFailed: "Impossibile caricare le impostazioni degli scontrini ({reason}).",
}
