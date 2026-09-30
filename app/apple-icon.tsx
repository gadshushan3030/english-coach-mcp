import { ImageResponse } from "next/og";

export const size = { width: 180, height: 180 };
export const contentType = "image/png";

// Home-screen icon for iPhone / Mac "Add to Dock".
export default function AppleIcon() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center", background: "#2459d6", color: "#fff", fontSize: 84, fontWeight: 700 }}>
        En
      </div>
    ),
    size,
  );
}
