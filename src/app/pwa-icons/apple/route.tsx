import { pwaIcon } from "@/lib/pwa-icon";

// Was app/apple-icon.tsx, but Next 16.4 emits that file-based <link rel="apple-touch-icon"> without
// basePath (/apple-icon instead of /yams/apple-icon), so it is served here and linked from layout metadata.
export function GET() {
  return pwaIcon(180);
}
