import { getMarketingContent } from '../../../../content/marketing';
import { ScrollNav } from '@/components/marketing/ScrollNav';
import { HeroSection } from '@/components/marketing/HeroSection';
import { FeaturesSection } from '@/components/marketing/FeaturesSection';
import { IntegrationsSection } from '@/components/marketing/IntegrationsSection';
import { FAQSection } from '@/components/marketing/FAQAccordion';
import { FinalCTA } from '@/components/marketing/FinalCTA';
import { SiteFooter } from '@/components/marketing/SiteFooter';

export default async function HomePage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;
  const content = getMarketingContent(lang);

  return (
    <main>
      <ScrollNav locale={lang} />
      <HeroSection content={content.hero} locale={lang} />
      <FeaturesSection content={content.features} />
      <IntegrationsSection content={content.openSource} />
      <FAQSection content={content.faq} />
      <FinalCTA content={content.cta} locale={lang} />
      <SiteFooter content={content.footer} />
    </main>
  );
}
