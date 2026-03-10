import { siteConfig } from '@/lib/site.config';
import { buttonVariants } from '@/components/ui/button-variants';

export default async function CommunityPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">
        {lang === 'zh' ? '社区' : 'Community'}
      </h1>
      <p className="text-muted-foreground mb-8 text-center max-w-md">
        {lang === 'zh'
          ? '加入社区，获取帮助和分享经验'
          : 'Join the community, get help, and share your experience'}
      </p>
      <div className="flex gap-4">
        <a
          href={siteConfig.repo.url}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          GitHub
        </a>
      </div>
    </main>
  );
}
