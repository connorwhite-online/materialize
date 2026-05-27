"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface ErrorBoundaryProps {
  /**
   * Rendered in place of `children` once a descendant throws during
   * render (or in a lifecycle method). Static — it must not depend on
   * the three.js tree, since by the time it shows that tree is gone.
   */
  fallback: ReactNode;
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
}

/**
 * Minimal client-only React error boundary.
 *
 * The three.js `<Canvas>` consumers load remote models through
 * `useLoader`, which THROWS on fetch/parse failure (expired R2 URL,
 * corrupt STL/OBJ/3MF, Environment IBL fetch). React's `<Suspense>`
 * only catches the pending promise, not the eventual throw — without a
 * boundary that throw bubbles to the route-level `error.tsx` and tears
 * down the whole page. Wrapping each Canvas in this boundary contains
 * the failure to an inline "Preview unavailable" fallback while the
 * surrounding UI stays mounted.
 *
 * Behaves like a standard boundary: it only intercepts errors thrown
 * during the React render/commit phase. Event handlers, async work, and
 * other non-render errors are NOT swallowed.
 */
export class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Surface the failure for debugging without re-throwing — a normal
    // boundary logs and renders its fallback.
    console.error("ErrorBoundary caught an error:", error, info);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}
