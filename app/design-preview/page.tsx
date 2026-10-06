import type { Metadata } from 'next';
import { NovaPreview } from '@/components/design-preview/NovaPreview';

// Experimentele vormgeving, los van de homepage. Verwijderen: deze map en
// components/design-preview weghalen; / blijft dan ongewijzigd werken.
export const metadata: Metadata = {
  title: 'Nova — designpreview',
  robots: { index: false },
};

export default function DesignPreviewPage() {
  return <NovaPreview />;
}
