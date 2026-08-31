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
  lat:     number;
  lng:     number;
  label:   string;
  color?:  'red' | 'blue' | 'green' | 'orange';
  pulse?:  boolean;
}

interface Props {
  center:     { lat: number; lng: number };
  zoom?:      number;
  markers?:   MapMarker[];
  height?:    string;
  className?: string;
  showRoute?: boolean;
}

function makeIcon(color: string, pulse: boolean): L.DivIcon {
  const ring = pulse
    ? `<span style="position:absolute;inset:-6px;border-radius:50%;border:2px solid ${color};animation:ping 1.5s ease-in-out infinite;opacity:0.5;"></span>`
    : '';
  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:24px;height:24px;">
        ${ring}
        <div style="
          width:24px;height:24px;border-radius:50%;
          background:${color};border:3px solid white;
          box-shadow:0 2px 8px rgba(0,0,0,0.35);
        "></div>
      </div>`,
    iconSize:   [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -16],
  });
}

const COLOR_MAP: Record<string, string> = {
  red:    '#DC2626',
  blue:   '#2563EB',
  green:  '#16A34A',
  orange: '#D97706',
};

export default function MapView({ center, zoom = 14, markers = [], height = '240px', className = '', showRoute = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef       = useRef<L.Map | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const map = L.map(containerRef.current, {
      center: [center.lat, center.lng],
      zoom,
      zoomControl: false,
      attributionControl: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
    }).addTo(map);

    L.control.zoom({ position: 'bottomright' }).addTo(map);
    mapRef.current = map;

    return () => { map.remove(); mapRef.current = null; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Update center
  useEffect(() => {
    mapRef.current?.setView([center.lat, center.lng]);
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
      const hexColor = COLOR_MAP[m.color || 'red'];
      const icon     = makeIcon(hexColor, m.pulse || false);
      L.marker([m.lat, m.lng], { icon })
        .bindPopup(`<b style="color:${hexColor}">${m.label}</b>`)
        .addTo(map);
    });

    if (showRoute && markers.length >= 2) {
      const latlngs = markers.map(m => [m.lat, m.lng] as L.LatLngExpression);
      L.polyline(latlngs, {
        color: '#2563EB',
        weight: 5,
        opacity: 0.8,
        dashArray: '8, 8',
        lineJoin: 'round',
      }).addTo(map);
    }
  }, [markers, showRoute]);

  return (
    <div
      ref={containerRef}
      className={`map-container ${className}`}
      style={{ height }}
    />
  );
}
