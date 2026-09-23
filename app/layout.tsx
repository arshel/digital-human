import type { Metadata } from 'next';
import { Bricolage_Grotesque, Schibsted_Grotesk } from 'next/font/google';
import './globals.css';

const display = Bricolage_Grotesque({
  subsets: ['latin'],
  variable: '--font-display',
  weight: ['600', '800'],
});

const body = Schibsted_Grotesk({
  subsets: ['latin'],
  variable: '--font-body',
  weight: ['400', '500', '700'],
});

export const metadata: Metadata = {
  title: 'Nova — je nieuwspresentator',
  description: 'Drie verhalen per dag, uitgelegd door een digitale presentator die alleen het artikel voor zich gebruikt.',
};

// suppressHydrationWarning op <html>: browserextensies (donkere modus, vertalers) zetten
// daar een eigen style op voordat React hydrateert, en React ziet dat als een verschil met
// de server. Dempen mag hier, want wij zetten op dit element alleen lang en de twee
// fontklassen. Het werkt niet door in de elementen eronder, dus echte fouten in de pagina
// blijven gewoon zichtbaar.
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${display.variable} ${body.variable}`} suppressHydrationWarning>
      <body>{children}</body>
    </html>
  );
}
