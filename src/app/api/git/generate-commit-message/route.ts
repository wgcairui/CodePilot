import { NextRequest, NextResponse } from 'next/server';
import { execFile } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { generateTextFromProvider } from '@/lib/text-generator';
import { resolveProvider } from '@/lib/provider-resolver';

const execFileAsync = promisify(execFile);

async function runGitSilent(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    maxBuffer: 2 * 1024 * 1024,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    timeout: 10000,
  });
  return stdout;
}

async function getDiff(cwd: string): Promise<string> {
  // Try diff against HEAD (covers staged + unstaged). For a brand-new repo
  // with no commits, fall back to --cached only.
  try {
    const diff = await runGitSilent(['diff', 'HEAD', '--no-color'], cwd);
    return diff.slice(0, 6000);
  } catch {
    try {
      const diff = await runGitSilent(['diff', '--cached', '--no-color'], cwd);
      return diff.slice(0, 6000);
    } catch {
      return '';
    }
  }
}

async function getFileList(cwd: string): Promise<string> {
  try {
    const output = await runGitSilent(['status', '--short'], cwd);
    return output.trim();
  } catch {
    return '';
  }
}

/** Detect the primary language used in CLAUDE.md (Chinese or English). */
function detectLanguage(cwd: string): 'en' | 'zh' {
  try {
    const claudeMdPath = path.join(cwd, 'CLAUDE.md');
    const content = fs.readFileSync(claudeMdPath, 'utf-8').slice(0, 1000);
    const chineseChars = (content.match(/[\u4e00-\u9fff]/g) || []).length;
    const totalNonSpace = content.replace(/\s/g, '').length;
    return chineseChars / Math.max(totalNonSpace, 1) > 0.15 ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

/**
 * Pick the cheapest/fastest model for the resolved provider.
 * Priority: haiku role → small role → Anthropic haiku model ID → provider default.
 */
function pickSmallModel(resolved: ReturnType<typeof resolveProvider>): string {
  if (resolved.roleModels.haiku) return resolved.roleModels.haiku;
  if (resolved.roleModels.small) return resolved.roleModels.small;
  if (resolved.protocol === 'anthropic') return 'claude-haiku-4-5-20251001';
  return resolved.model || 'claude-haiku-4-5-20251001';
}

export async function POST(req: NextRequest) {
  try {
    const { cwd } = await req.json();
    if (!cwd) {
      return NextResponse.json({ error: 'cwd is required' }, { status: 400 });
    }

    const [diff, fileList] = await Promise.all([getDiff(cwd), getFileList(cwd)]);

    if (!diff && !fileList) {
      return NextResponse.json({ error: 'No changes detected' }, { status: 400 });
    }

    const lang = detectLanguage(cwd);

    const resolved = resolveProvider();
    if (!resolved.hasCredentials && !resolved.provider) {
      return NextResponse.json({ error: 'No AI provider configured' }, { status: 400 });
    }

    const langInstruction = lang === 'zh'
      ? 'Write the commit message in Chinese (中文).'
      : 'Write the commit message in English.';

    const system = `You are a git commit message generator. Generate a concise, clear commit message following Conventional Commits format (feat/fix/refactor/chore/docs/style/test/perf, etc.). ${langInstruction}

Rules:
- Subject line: max 72 characters, imperative mood, no trailing period
- Scope is optional but helpful (e.g. feat(auth): ...)
- If changes are complex, add a blank line then bullet points explaining key changes
- Be specific: mention what changed and why, not how
- Output ONLY the commit message text, nothing else`;

    const prompt = `Generate a commit message for these changes:

Changed files:
${fileList || '(no file list)'}

Diff:
${diff || '(no diff)'}`;

    const message = await generateTextFromProvider({
      providerId: resolved.provider?.id || '',
      model: pickSmallModel(resolved),
      system,
      prompt,
      maxTokens: 256,
    });

    return NextResponse.json({ message: message.trim() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to generate commit message' },
      { status: 500 },
    );
  }
}
