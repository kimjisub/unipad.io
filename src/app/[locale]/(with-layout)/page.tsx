import { setRequestLocale } from 'next-intl/server';

import { FeaturesSection } from '@/components/introduce/FeaturesSection';
import { HeroSection } from '@/components/introduce/HeroSection';

export default async function Home({
  params,
}: {
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  setRequestLocale(locale);

  return (
    <main className="flex flex-col min-h-screen">
      <section id="hero">
        <HeroSection />
      </section>

      <section id="features">
        <FeaturesSection />
      </section>
    </main>
  );
}
