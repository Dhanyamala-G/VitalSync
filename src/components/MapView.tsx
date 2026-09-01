// ─────────────────────────────────────────────
//  MapView — Leaflet + OpenStreetMap
//  No API key required
// ─────────────────────────────────────────────
import { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

// Fix default marker icons for bundlers
delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon-2x.png',
  iconUrl:       'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-icon.png',
  shadowUrl:     'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/images/marker-shadow.png',
});

export interface MapMarker {
  lat:        number;
  lng:        number;
  label:      string;
  color?:     'red' | 'blue' | 'green' | 'orange' | 'purple' | 'gray' | 'yellow';
  pulse?:     boolean;
  iconText?:  string;
}

interface Props {
  center:      { lat: number; lng: number };
  zoom?:       number;
  markers?:    MapMarker[];
  height?:     string;
  className?:  string;
  showRoute?:  boolean;
  showLegend?: boolean;
}

function makeIcon(color: string, pulse: boolean, iconText?: string): L.DivIcon {
  const ring = pulse
    ? `<span style="position:absolute;inset:-6px;border-radius:50%;border:2.5px solid ${color};animation:ping 1.4s cubic-bezier(0, 0, 0.2, 1) infinite;opacity:0.75;"></span>`
    : '';
  
  const inner = iconText
    ? `<span style="font-size:12px;line-height:1;filter:drop-shadow(0 1px 1px rgba(0,0,0,0.5));">${iconText}</span>`
    : '';

  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:28px;height:28px;display:flex;items-center;justify-content:center;">
        ${ring}
        <div style="
          width:28px;height:28px;border-radius:50%;
          background:${color};border:2.5px solid white;
          box-shadow:0 3px 10px rgba(0,0,0,0.4);
          display:flex;align-items:center;justify-content:center;
        ">
          ${inner}
        </div>
      </div>`,
    iconSize:   [28, 28],
    iconAnchor: [14, 14],
    popupAnchor: [0, -18],
  });
}

const COLOR_MAP: Record<string, string> = {
  red:    '#DC2626', // Incident / Patient
  blue:   '#2563EB', // Current User / Self
  green:  '#16A34A', // Free / Available Ambulance (Can accept missions)
  orange: '#EA580C', // On Mission / Dispatched Ambulance (Accepted)
  purple: '#9333EA', // Hospital
  yellow: '#EAB308',
  gray:   '#6B7280',
};

export default function MapView({
  center,
  zoom = 14,
  markers = [],
  height = '240px',
  className = '',
  showRoute = false,
  showLegend = true,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);
  const lastCenterRef = useRef<{ lat: number; lng: number }>({ lat: 0, lng: 0 });

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: false,
      attributionControl: false,
      scrollWheelZoom: true, // Enabled so user can zoom and explore nearby ambulances & hospitals
      touchZoom: true,
      doubleClickZoom: true,
      dragging: true,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;
    lastCenterRef.current = { lat: center.lat, lng: center.lng };

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center smoothly without jumping or jittering
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const latDiff = Math.abs(lastCenterRef.current.lat - center.lat);
    const lngDiff = Math.abs(lastCenterRef.current.lng - center.lng);
    // Only re-center if significant coordinate change (> ~25 meters)
    if (latDiff > 0.00025 || lngDiff > 0.00025) {
      map.setView([center.lat, center.lng], map.getZoom(), { animate: true });
      lastCenterRef.current = { lat: center.lat, lng: center.lng };
    }
  }, [center.lat, center.lng]);

  // Update markers
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    map.eachLayer(l => { 
      if (l instanceof L.Marker || (l instanceof L.Polyline && !(l instanceof L.Polygon))) {
        map.removeLayer(l); 
      }
    });

    markers.forEach(m => {
      const hexColor = COLOR_MAP[m.color || 'red'] || '#DC2626';
      const icon     = makeIcon(hexColor, m.pulse || false, m.iconText);
      L.marker([m.lat, m.lng], { icon })
        .bindPopup(`
          <div style="font-family:system-ui,-apple-system,sans-serif;font-size:12px;padding:2px 0;">
            <b style="color:${hexColor};display:block;margin-bottom:2px;">${m.label}</b>
            <span style="color:#64748b;font-size:11px;">${m.lat.toFixed(5)}, ${m.lng.toFixed(5)}</span>
          </div>
        `)
        .addTo(map);
    });

    if (showRoute && markers.length >= 2) {
      const latlngs = markers.map(m => [m.lat, m.lng] as L.LatLngExpression);
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: 4,
        opacity: 0.85,
        dashArray: '8, 8',
        lineJoin: 'round',
      }).addTo(map);
    }
  }, [markers, showRoute]);

  return (
    <div className="space-y-1.5 relative isolate z-0">
      <div
        ref={containerRef}
        className={`map-container rounded-2xl overflow-hidden shadow-inner border border-gray-100 relative isolate z-0 ${className}`}
        style={{ height }}
      />
      {showLegend && (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 py-1 px-2 bg-gray-50/90 rounded-xl border border-gray-200/60 text-[10px] text-gray-600 font-medium">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-green-600 border border-white shadow-xs" />
            <span className="text-gray-700 font-semibold">Free</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-orange-600 border border-white shadow-xs" />
            <span className="text-gray-700 font-semibold">On Mission</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-purple-600 border border-white shadow-xs" />
            <span className="text-gray-700 font-semibold">Hospital</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-blue-600 border border-white shadow-xs" />
            <span className="text-gray-700 font-semibold">You</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-full bg-red-600 border border-white shadow-xs" />
            <span className="text-gray-700 font-semibold">Emergency</span>
          </span>
        </div>
      )}
    </div>
  );
}
