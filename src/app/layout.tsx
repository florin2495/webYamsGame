import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin", "latin-ext"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Yams",
  applicationName: "Yams",
  appleWebApp: { capable: true, title: "Yams", statusBarStyle: "default" },
  // Metadata icon URLs are not prefixed with basePath; keep "/yams" in sync with next.config.ts.
  // Setting icons replaces the file-based favicon link too, so list it here.
  icons: { icon: [{ url: "/yams/favicon.ico", sizes: "48x48", type: "image/x-icon" }], apple: [{ url: "/yams/pwa-icons/apple", sizes: "180x180", type: "image/png" }] },
  other: { "apple-mobile-web-app-capable": "yes" },
  description: "Yams cu zaruri între prieteni, pe telefon. Până la 16 jucători.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f4f4f5" },
    { media: "(prefers-color-scheme: dark)", color: "#09090b" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="ro" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
