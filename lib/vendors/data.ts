export interface ShipmentOrigin {
  city?: string;
  country: string;
  countryCode: string;
  lat: number;
  lng: number;
}

/**
 * Extract origin location from tracking info when available.
 * Returns null if we don't have enough info to show a location.
 * We only show location when we actually know it — no guessing.
 */
export function getShipmentOrigin(trackingInfo: {
  trackingUrl?: string;
  trackingNumber?: string;
  carrier?: string;
} | null): ShipmentOrigin | null {
  if (!trackingInfo?.carrier) return null;

  // In production, we'd resolve this from the tracking API or
  // CraftCloud's shipping origin data. For now, return null
  // until we have real tracking data to parse.
  return null;
}
