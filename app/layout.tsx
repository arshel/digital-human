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

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="nl" className={`${display.variable} ${body.variable}`}>
      <body>{children}</body>
    </html>
  );
}
