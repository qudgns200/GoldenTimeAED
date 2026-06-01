declare namespace kakao.maps {
  class Map {
    constructor(container: HTMLElement, options: MapOptions);
    setCenter(latlng: LatLng): void;
    getCenter(): LatLng;
    setLevel(level: number): void;
    getLevel(): number;
  }

  interface MapOptions {
    center: LatLng;
    level?: number;
    draggable?: boolean;
    scrollwheel?: boolean;
  }

  class LatLng {
    constructor(lat: number, lng: number);
    getLat(): number;
    getLng(): number;
  }

  class Marker {
    constructor(options: MarkerOptions);
    setMap(map: Map | null): void;
    getMap(): Map | null;
    setPosition(latlng: LatLng): void;
    getPosition(): LatLng;
  }

  interface MarkerOptions {
    position: LatLng;
    map?: Map;
    image?: MarkerImage;
    title?: string;
    clickable?: boolean;
    zIndex?: number;
  }

  class MarkerImage {
    constructor(src: string, size: Size, options?: MarkerImageOptions);
  }

  interface MarkerImageOptions {
    offset?: Point;
  }

  class Size {
    constructor(width: number, height: number);
  }

  class Point {
    constructor(x: number, y: number);
  }

  class InfoWindow {
    constructor(options: InfoWindowOptions);
    open(map: Map, marker: Marker): void;
    close(): void;
    getMap(): Map | null;
    setContent(content: string | HTMLElement): void;
  }

  interface InfoWindowOptions {
    content?: string | HTMLElement;
    position?: LatLng;
    removable?: boolean;
    zIndex?: number;
  }

  class CustomOverlay {
    constructor(options: CustomOverlayOptions);
    setMap(map: Map | null): void;
    getMap(): Map | null;
    setPosition(latlng: LatLng): void;
    setContent(content: string | HTMLElement): void;
  }

  interface CustomOverlayOptions {
    position: LatLng;
    content: string | HTMLElement;
    map?: Map;
    xAnchor?: number;
    yAnchor?: number;
    zIndex?: number;
    clickable?: boolean;
  }

  namespace event {
    function addListener(
      target: Map | Marker | CustomOverlay,
      type: string,
      handler: (...args: unknown[]) => void
    ): void;
    function removeListener(
      target: Map | Marker | CustomOverlay,
      type: string,
      handler: (...args: unknown[]) => void
    ): void;
  }

  function load(callback: () => void): void;

  namespace services {
    enum Status {
      OK = 'OK',
      ZERO_RESULT = 'ZERO_RESULT',
      ERROR = 'ERROR',
    }

    interface AddressResult {
      address_name: string;
      address_type: string;
      x: string;
      y: string;
      address: {
        address_name: string;
        region_1depth_name: string;
        region_2depth_name: string;
        region_3depth_name: string;
        mountain_yn: string;
        main_address_no: string;
        sub_address_no: string;
      };
      road_address: {
        address_name: string;
        region_1depth_name: string;
        region_2depth_name: string;
        region_3depth_name: string;
        road_name: string;
        underground_yn: string;
        main_building_no: string;
        sub_building_no: string;
        building_name: string;
        zone_no: string;
        x: string;
        y: string;
      } | null;
    }

    interface PlaceResult {
      id: string;
      place_name: string;
      category_name: string;
      address_name: string;
      road_address_name: string;
      x: string;
      y: string;
      phone: string;
    }

    class Geocoder {
      addressSearch(
        address: string,
        callback: (result: AddressResult[], status: Status) => void
      ): void;
    }

    class Places {
      keywordSearch(
        keyword: string,
        callback: (result: PlaceResult[], status: Status) => void
      ): void;
    }
  }
}

interface Window {
  kakao: typeof kakao;
}
