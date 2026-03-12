import { NextResponse } from 'next/server';
import { findClaudeBinary, getClaudeVersion, findAllClaudeBinaries, classifyClaudePath, isWindows, findGitBash } from '@/lib/platform';
import type { ClaudeInstallInfo } from '@/lib/platform';

export async function GET() {
  try {
    const claudePath = findClaudeBinary();

    // On Windows, check for Git Bash (bash.exe) using the same detection as the SDK runtime.
    // This avoids false negatives when Git is installed but git.exe isn't on PATH.
    const missingGit = isWindows && findGitBash() === null;

    if (!claudePath) {
      return NextResponse.json({ connected: false, version: null, binaryPath: null, installType: null, otherInstalls: [], missingGit });
    }
    const version = await getClaudeVersion(claudePath);
    const installType = classifyClaudePath(claudePath);

    // Detect other installations for conflict warning
    let otherInstalls: ClaudeInstallInfo[] = [];
    try {
      const all = findAllClaudeBinaries();
      otherInstalls = all.filter(i => i.path !== claudePath);
    } catch {
      // non-critical — don't fail the status check
    }

    return NextResponse.json({
      // If Git Bash is missing on Windows, Claude is installed but not usable
      connected: !!version && !missingGit,
      version,
      binaryPath: claudePath,
      installType,
      otherInstalls,
      missingGit,
    });
  } catch {
    return NextResponse.json({ connected: false, version: null, binaryPath: null, installType: null, otherInstalls: [], missingGit: false });
  }
}
