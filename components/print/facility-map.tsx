"use client";

import { Card, CardContent } from "@/components/ui/card";

interface FacilityMapProps {
  origin: {
    city?: string;
    country: string;
    lat: number;
    lng: number;
  };
}

export function FacilityMap({ origin }: FacilityMapProps) {
  const zoom = origin.city ? 4 : 2;
  const mapUrl = `https://staticmap.openstreetmap.de/staticmap.php?center=${origin.lat},${origin.lng}&zoom=${zoom}&size=400x200&maptype=mapnik`;

  const label = origin.city
    ? `${origin.city}, ${origin.country}`
    : origin.country;

  return (
    <Card className="overflow-hidden">
      <div className="relative">
        <img
          src={mapUrl}
          alt={`Shipping from ${label}`}
          className="w-full h-[140px] object-cover"
          loading="lazy"
        />

        {/* Factory pin — centered on map */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="flex flex-col items-center -mt-2">
            <div className="w-7 h-7 rounded-full bg-foreground text-background flex items-center justify-center">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M2 20h20" />
                <path d="M17 20V8l-5 4V8l-5 4v8" />
                <path d="M19 20V4h3v16" />
              </svg>
            </div>
            <div className="w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-foreground" />
          </div>
        </div>

        <div className="absolute inset-0 bg-gradient-to-t from-background/50 via-transparent to-transparent" />
      </div>
      <CardContent className="p-3">
        <p className="text-xs font-medium">Shipping from</p>
        <p className="text-xs text-muted-foreground mt-0.5">{label}</p>
      </CardContent>
    </Card>
  );
}
