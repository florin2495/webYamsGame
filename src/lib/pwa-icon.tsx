import { ImageResponse } from "next/og";

// Opaque app icon: a white die showing five on an indigo background.
// `inset` shrinks the artwork (maskable icons keep it inside the central 80%).
export function pwaIcon(px: number, inset = 1): ImageResponse {
  const s = px * inset * 0.62;
  const pip = s * 0.16;
  const at = [
    [0.25, 0.25],
    [0.75, 0.25],
    [0.5, 0.5],
    [0.25, 0.75],
    [0.75, 0.75],
  ];
  return new ImageResponse(
    (
      <div style={{ width: px, height: px, display: "flex", alignItems: "center", justifyContent: "center", background: "#4f46e5" }}>
        <div style={{ width: s, height: s, position: "relative", display: "flex", background: "#fafaf9", borderRadius: s * 0.18 }}>
          {at.map(([x, y], i) => (
            <div
              key={i}
              style={{
                position: "absolute",
                left: x * s - pip / 2,
                top: y * s - pip / 2,
                width: pip,
                height: pip,
                borderRadius: pip,
                background: "#1e1b4b",
              }}
            />
          ))}
        </div>
      </div>
    ),
    { width: px, height: px },
  );
}
