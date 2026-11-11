export function losslessEncodings(depth: number, compression: number): number[] {
  return [
    1, // CopyRect
    ...(depth === 24 ? [16, 5, 2, 6] : []), // ZRLE, Hextile, RRE, Zlib
    0, // Raw fallback
    -256 + compression,
    // Request-driven updates apply backpressure all the way to the encoder.
    // ContinuousUpdates (-313) can queue old frames in the browser while
    // JPEG decoding/rendering falls behind, even on a fast LAN.
    -223, -224, -258, -261, -308, -309, -312, -307,
    0xc0a1e5ce, -316, // Extended clipboard and mouse buttons
    ...(depth === 24 ? [0x574d5664, -239] : []), // Cursor shapes
  ];
}

export function desktopEncodings(depth: number, compression: number, quality: number | null): number[] {
  const encodings = losslessEncodings(depth, compression);
  if (quality === null || depth !== 24) return encodings;
  // Tight handles JPEG images and lossless text/solid rectangles in one stream.
  encodings.splice(1, 0, 7);
  encodings.push(-32 + quality);
  return encodings;
}
