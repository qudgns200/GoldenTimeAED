import { getDistance } from 'geolib';
import type { AEDItem, Coordinates } from '../types/aed';

const RADIUS_METERS = 300;

export function filterByRadius(aedList: AEDItem[], center: Coordinates): AEDItem[] {
  return aedList
    .map((item) => {
      const distance = getDistance(
        { latitude: center.lat, longitude: center.lng },
        { latitude: item.coordinates.lat, longitude: item.coordinates.lng }
      );
      return { ...item, distance };
    })
    .filter((item) => item.distance <= RADIUS_METERS)
    .sort((a, b) => (a.distance ?? 0) - (b.distance ?? 0));
}
