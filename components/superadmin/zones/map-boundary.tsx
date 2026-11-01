"use client"

import { Component, type ReactNode } from "react"
import { MapOff } from "./map-off"

/** Thrown by the map to show the operator a specific reason. */
export class MapProblem extends Error {}

// Keeps a map failure inside the map area. Google Maps can fail after it
// loads (a rejected key, a blocked script, a library that never arrives), and
// an error thrown from a map effect would otherwise take down the whole
// editor. The step panel and autosave live outside this boundary, so the
// operator keeps working and can try the map again.
export class MapBoundary extends Component<{ children: ReactNode }, { failed: boolean; detail?: string; attempt: number }> {
  state: { failed: boolean; detail?: string; attempt: number } = { failed: false, attempt: 0 }

  static getDerivedStateFromError(error: unknown) {
    // A MapProblem carries a message meant for the operator (a key that
    // rejects this domain, a missing key); anything else stays generic.
    return { failed: true, detail: error instanceof MapProblem ? error.message : undefined }
  }

  componentDidCatch(error: unknown) {
    // No personal data here: only the error's name and message.
    console.error("zone map failed", error instanceof Error ? `${error.name}: ${error.message}` : "unknown")
  }

  render() {
    if (this.state.failed) {
      return <MapOff detail={this.state.detail} onRetry={() => this.setState((s) => ({ failed: false, detail: undefined, attempt: s.attempt + 1 }))} />
    }
    // A new key remounts the map from scratch on retry.
    return <div key={this.state.attempt} className="contents">{this.props.children}</div>
  }
}
