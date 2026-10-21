import 'leaflet/dist/leaflet.css'
import { divIcon, type LatLngExpression } from 'leaflet'
import { useEffect } from 'react'
import { Circle, MapContainer, Marker, TileLayer, useMap, useMapEvents } from 'react-leaflet'

// A plain CSS dot instead of Leaflet's default marker image: the default icon's
// image paths break under bundlers, and a broken marker on the pin map would
// make the one thing this map is for invisible.
const PIN_ICON = divIcon({
  className: '',
  html: '<span style="display:block;width:22px;height:22px;border-radius:50%;background:#0f766e;border:3px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)"></span>',
  iconSize: [22, 22],
  iconAnchor: [11, 11],
})

export interface MapPoint {
  latitude: number
  longitude: number
}

interface PinMapProps {
  pin: MapPoint
  /** The radius guests are checked against, drawn around the pin. Null = not known yet. */
  radiusM: number | null
  /** Called when the admin drags the pin or taps the map. Omit for a read-only map. */
  onMove?: (point: MapPoint) => void
  /**
   * Set to a new object to move the view there (after an address search or
   * "set pin from my phone"). Dragging does not re-centre the map, so it never
   * jumps away from under the admin's finger.
   */
  focus: MapPoint | null
}

export function PinMap({ pin, radiusM, onMove, focus }: PinMapProps) {
  const position: LatLngExpression = [pin.latitude, pin.longitude]
  return (
    <MapContainer
      center={position}
      zoom={18}
      scrollWheelZoom
      className="z-0 h-72 w-full rounded-xl border border-slate-200 sm:h-96"
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://tile.openstreetmap.org/{z}/{x}/{y}.png"
        maxZoom={19}
      />
      <FocusOn point={focus} />
      {onMove && <TapToMove onMove={onMove} />}
      {radiusM !== null && (
        <Circle
          center={position}
          radius={radiusM}
          pathOptions={{ color: '#0f766e', weight: 2, fillOpacity: 0.12 }}
        />
      )}
      <Marker
        position={position}
        icon={PIN_ICON}
        draggable={onMove !== undefined}
        eventHandlers={{
          dragend: (event) => {
            const { lat, lng } = event.target.getLatLng()
            onMove?.({ latitude: lat, longitude: lng })
          },
        }}
      />
    </MapContainer>
  )
}

function FocusOn({ point }: { point: MapPoint | null }) {
  const map = useMap()
  useEffect(() => {
    if (point) map.setView([point.latitude, point.longitude], Math.max(map.getZoom(), 18))
  }, [point, map])
  return null
}

function TapToMove({ onMove }: { onMove: (point: MapPoint) => void }) {
  useMapEvents({
    click: (event) => onMove({ latitude: event.latlng.lat, longitude: event.latlng.lng }),
  })
  return null
}
