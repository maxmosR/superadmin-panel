// Every console string, Italian and English. TypeScript makes each Italian
// dictionary match its English one key for key; tests/i18n-parity.test.ts
// also checks no Italian string was left empty or in English by mistake.
import * as common from "./common"
import * as shell from "./shell"
import * as setup from "./setup"
import * as dashboard from "./dashboard"
import * as create from "./create"
import * as edit from "./edit"
import * as staff from "./staff"
import * as domains from "./domains"
import * as payout from "./payout"
import * as providers from "./providers"
import * as operators from "./operators"
import * as sections from "./sections"
import * as login from "./login"
import * as zones from "./zones"
import * as sms from "./sms"

const areas = { common, shell, setup, dashboard, create, edit, staff, domains, payout, providers, operators, sections, login, zones, sms }
type Areas = typeof areas

export type Messages = { [K in keyof Areas]: Areas[K]["en"] }

function pick(lang: "en" | "it"): Messages {
  return Object.fromEntries(Object.entries(areas).map(([k, v]) => [k, v[lang]])) as Messages
}

export const messages = { en: pick("en"), it: pick("it") }
