import { NextRequest, NextResponse } from 'next/server';
import { resolveProvider } from '@/lib/provider-resolver';
import { generateTextFromProvider } from '@/lib/text-generator';

export const runtime = 'nodejs';

/**
 * POST /api/ai/analyze-log
 * Analyze log content using AI to identify issues and provide recommendations
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { content, providerId: reqProviderId, model: reqModel } = body as {
      content: string;
      providerId?: string;
      model?: string;
    };

    if (!content || typeof content !== 'string') {
      return NextResponse.json(
        { error: 'Log content is required' },
        { status: 400 }
      );
    }

    // Resolve provider: use what the user explicitly selected, or fall back to default
    const resolved = resolveProvider(reqProviderId ? { providerId: reqProviderId } : {});
    if (!resolved.provider) {
      return NextResponse.json(
        { error: 'No AI provider configured' },
        { status: 400 }
      );
    }

    const providerId = resolved.provider.id;
    // Use the user-selected model if provided; otherwise pick the cheapest capable model
    const model = reqModel
      || resolved.roleModels.haiku
      || resolved.roleModels.small
      || resolved.model
      || 'claude-haiku-4-5-20251001';

    // Prepare the analysis prompt
    const prompt = `请分析以下远程主机连接和代理运行的日志内容，识别可能的问题并提供解决建议：

日志内容：
\`\`\`
${content.slice(0, 50000)}
\`\`\`

请提供以下内容的分析：

1. **连接状态总结**
   - 连接是否成功
   - 是否有连接失败或中断

2. **错误识别**
   - 列出所有发现的错误和警告
   - 按严重程度排序

3. **性能问题**
   - 连接延迟情况
   - 是否有超时问题

4. **解决建议**
   - 针对发现的问题提供具体的修复建议
   - 预防措施

5. **系统状态**
   - 远程环境状态（Node.js、Claude CLI等）
   - Agent运行状态

请用中文回复，并保持简洁明了。`;

    const analysis = await generateTextFromProvider({
      providerId,
      model,
      system: '你是一个专业的系统运维和日志分析专家，专长于识别远程主机连接和SSH相关问题。',
      prompt,
    });

    if (!analysis || !analysis.trim()) {
      return NextResponse.json(
        { analysis: '分析失败，请稍后重试。' },
        { status: 200 }
      );
    }

    return NextResponse.json({ analysis });
  } catch (error) {
    console.error('[api] log analysis error:', error);
    const msg = error instanceof Error ? error.message : 'AI analysis failed';
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}