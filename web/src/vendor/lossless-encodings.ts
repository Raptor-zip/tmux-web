export function losslessEncodings(depth: number, compression: number): number[] {
  return [
    1, // CopyRect
    ...(depth === 24 ? [16, 5, 2, 6] : []), // ZRLE, Hextile, RRE, Zlib
    0, // Raw fallback
    -256 + compression,
    -223, -224, -258, -261, -308, -309, -312, -313, -307,
    0xc0a1e5ce, -316, // Extended clipboard and mouse buttons
    ...(depth === 24 ? [0x574d5664, -239] : []), // Cursor shapes
  ];
}
