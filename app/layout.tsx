import type { Metadata, Viewport } from "next";
import "./globals.css";

// Systeemletters: Arial voor koppen, bediening en ondertiteling.
// Er worden geen externe webfonts geladen.

export const metadata: Metadata = {
  title: "Nova — nieuws in gewone taal",
  description:
    "Nova is een AI-presentator die nieuwsberichten uitlegt in eenvoudige taal, met de bron erbij.",
};

// viewport-fit=cover: de pagina loopt door tot de randen van telefoons met een notch; de CSS
// houdt de bediening met env(safe-area-inset-*) uit de onveilige randen.
// interactive-widget=resizes-content: op Android maakt het schermtoetsenbord de pagina
// kleiner in plaats van eroverheen te schuiven, zodat het vraagveld zichtbaar blijft.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content",
};

// suppressHydrationWarning op <html>: browserextensies (donkere modus, vertalers) zetten
// daar een eigen style op voordat React hydrateert, en React ziet dat als een verschil met
// de server. Dempen mag hier, want wij zetten op dit element alleen lang. Het werkt niet
// door in de elementen eronder, dus echte fouten in de pagina blijven gewoon zichtbaar.
export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="nl" suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
