/** Open coordinates in the user's default maps app / browser. */
export function mapsUrl(latitude: number, longitude: number) {
  const q = `${latitude},${longitude}`;
  if (typeof navigator === "undefined") {
    return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
  }
  const ua = navigator.userAgent;
  const isApple =
    /iPhone|iPad|iPod|Macintosh/.test(ua) && !(window as Window & { MSStream?: unknown }).MSStream;
  if (isApple) {
    return `https://maps.apple.com/?ll=${latitude},${longitude}&q=${encodeURIComponent(q)}`;
  }
  return `https://www.google.com/maps?q=${encodeURIComponent(q)}`;
}

export function openInMaps(latitude: number, longitude: number) {
  const url = mapsUrl(latitude, longitude);
  window.open(url, "_blank", "noopener,noreferrer");
}

export function parseLocationCoords(content: string | null | undefined): {
  latitude: number;
  longitude: number;
} | null {
  if (!content) return null;
  const encoded = content.match(
    /chatter:live-location:(-?\d+(?:\.\d+)?),(-?\d+(?:\.\d+)?)/i,
  );
  if (encoded) {
    return {
      latitude: Number(encoded[1]),
      longitude: Number(encoded[2]),
    };
  }
  const loose = content.match(
    /(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)/,
  );
  if (!loose) return null;
  const latitude = Number(loose[1]);
  const longitude = Number(loose[2]);
  if (
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180
  ) {
    return { latitude, longitude };
  }
  return null;
}

export function encodeLiveLocationContent(
  latitude: number,
  longitude: number,
) {
  return `📍 Live location\nchatter:live-location:${latitude},${longitude}`;
}
