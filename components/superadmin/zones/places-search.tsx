"use client"

// Address search on Places API (New): AutocompleteSuggestion with session
// tokens, same pattern as the storefront's google-places-autocomplete.tsx
// (the legacy Autocomplete widget fails on this key). Results are biased to a
// circle around the restaurant, never restricted to a fixed city box.

import { useEffect, useRef, useState } from "react"
import { Input } from "@/components/ui/input"
import { loadGoogleMaps } from "@/lib/google-maps/loader"
import type { LatLng } from "@/lib/zones/types"

export interface PickedPlace {
  point: LatLng
  formatted: string
  /** The result is a street, not an address: its point is the street's middle. */
  streetOnly: boolean
}

interface Props {
  placeholder?: string
  /** Bias results to this circle (radius in metres). */
  bias?: { center: LatLng; radiusM: number } | null
  onPick: (place: PickedPlace) => void
  disabled?: boolean
}

const ADDRESS_TYPES = new Set(["street_address", "premise", "subpremise"])

export function PlacesSearch({ placeholder, bias, onPick, disabled }: Props) {
  const [value, setValue] = useState("")
  const [suggestions, setSuggestions] = useState<google.maps.places.AutocompleteSuggestion[]>([])
  const [open, setOpen] = useState(false)
  const [ready, setReady] = useState(false)
  const placesRef = useRef<google.maps.PlacesLibrary | null>(null)
  const tokenRef = useRef<google.maps.places.AutocompleteSessionToken | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    loadGoogleMaps()
      .then(async (g) => {
        const places = (await g.maps.importLibrary("places")) as google.maps.PlacesLibrary
        if (!mounted.current) return
        placesRef.current = places
        setReady(true)
      })
      .catch(() => {
        // The map shows the load error; the field just stays disabled.
      })
    return () => {
      mounted.current = false
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  const fetchSuggestions = (input: string) => {
    const places = placesRef.current
    if (!places || input.trim().length < 3) {
      setSuggestions([])
      setOpen(false)
      return
    }
    tokenRef.current ??= new places.AutocompleteSessionToken()
    const request: google.maps.places.AutocompleteRequest = { input, sessionToken: tokenRef.current }
    if (bias) request.locationBias = { center: bias.center, radius: Math.min(50_000, bias.radiusM) }
    places.AutocompleteSuggestion.fetchAutocompleteSuggestions(request)
      .then(({ suggestions: results }) => {
        if (!mounted.current) return
        // Prefer results with a street number (real addresses) over streets and places.
        const list = results
          .filter((s) => s.placePrediction)
          .map((s, i) => ({ s, i, addr: (s.placePrediction?.types ?? []).some((t) => ADDRESS_TYPES.has(t)) }))
          .sort((a, b) => Number(b.addr) - Number(a.addr) || a.i - b.i)
          .map((x) => x.s)
        setSuggestions(list)
        setOpen(list.length > 0)
      })
      .catch(() => {
        if (!mounted.current) return
        setSuggestions([])
        setOpen(false)
      })
  }

  const pick = async (s: google.maps.places.AutocompleteSuggestion) => {
    const prediction = s.placePrediction
    if (!prediction) return
    setOpen(false)
    setSuggestions([])
    try {
      const place = prediction.toPlace()
      await place.fetchFields({ fields: ["location", "formattedAddress", "types", "addressComponents"] })
      const loc = place.location
      if (!loc || !mounted.current) return
      const hasNumber = (place.addressComponents ?? []).some((c) => c.types.includes("street_number"))
      const types = place.types ?? []
      const streetOnly = !hasNumber && types.includes("route")
      const formatted = place.formattedAddress ?? prediction.text.text
      setValue(formatted)
      onPick({ point: { lat: loc.lat(), lng: loc.lng() }, formatted, streetOnly })
    } catch {
      // Ignore: the operator can search again or click the map.
    } finally {
      tokenRef.current = null
    }
  }

  return (
    <div className="relative">
      <Input
        value={value}
        placeholder={placeholder ?? "Search an address"}
        autoComplete="off"
        disabled={disabled || !ready}
        onChange={(e) => {
          setValue(e.target.value)
          if (debounceRef.current) clearTimeout(debounceRef.current)
          const text = e.target.value
          debounceRef.current = setTimeout(() => fetchSuggestions(text), 250)
        }}
        onFocus={() => suggestions.length > 0 && setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover text-sm shadow-md">
          {suggestions.map((s) => {
            const p = s.placePrediction
            if (!p) return null
            return (
              <li key={p.placeId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-accent"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => void pick(s)}
                >
                  {p.text.text}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
