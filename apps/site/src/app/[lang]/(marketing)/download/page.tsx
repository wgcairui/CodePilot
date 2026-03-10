import { siteConfig } from '@/lib/site.config';
import { buttonVariants } from '@/components/ui/button-variants';

export default async function DownloadPage({
  params,
}: {
  params: Promise<{ lang: string }>;
}) {
  const { lang } = await params;

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8">
      <h1 className="text-3xl font-bold mb-4">
        {lang === 'zh' ? '下载 CodePilot' : 'Download CodePilot'}
      </h1>
      <p className="text-muted-foreground mb-8 text-center max-w-md">
        {lang === 'zh'
          ? '从 GitHub Releases 下载最新版本'
          : 'Download the latest version from GitHub Releases'}
      </p>
      <a
        href={siteConfig.repo.releases}
        target="_blank"
        rel="noopener noreferrer"
        className={buttonVariants({ variant: "default" })}
      >
        {lang === 'zh' ? '前往 GitHub Releases' : 'Go to GitHub Releases'}
      </a>
    </main>
  );
}
