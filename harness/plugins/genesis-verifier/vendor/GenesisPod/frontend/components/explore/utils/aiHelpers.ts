/**
 * AI-related helper functions for resource analysis
 */

import { config } from '@/lib/utils/config';
import { getAuthHeader } from '@/lib/utils/auth';
import type { Resource, AIInsight } from './types';

import { logger } from '@/lib/utils/logger';
/**
 * Save AI analysis results to database
 */
export async function saveAIAnalysisToDatabase(
  resourceId: string,
  data: {
    aiSummary?: string;
    keyInsights?: AIInsight[];
    methodology?: string;
  }
): Promise<void> {
  try {
    const res = await fetch(`${config.apiUrl}/resources/${resourceId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify(data),
    });
    if (res.ok) {
      logger.debug('AI analysis saved to database for resource:', resourceId);
    }
  } catch (error) {
    logger.error('Failed to save AI analysis to database:', error);
  }
}

/**
 * Generate AI summary for resource
 */
export async function generateSummary(
  resource: Resource,
  articleTextContent: string,
  setAiSummary: (summary: string) => void,
  setAiLoading: (loading: boolean) => void
): Promise<void> {
  if (!resource) return;

  // Check if we already have summary in database
  if (resource.aiSummary) {
    logger.debug('Using cached summary from database');
    setAiSummary(resource.aiSummary);
    return;
  }

  try {
    setAiLoading(true);
    // Use extracted article content if available, otherwise fallback to abstract
    const content = articleTextContent || resource.abstract || '';

    // Don't call AI with insufficient content
    if (content.length < 50) {
      setAiSummary(
        '内容尚未加载完成，请先切换到「阅读模式」等待文章内容加载后再试。'
      );
      return;
    }

    logger.debug('Generating summary with content length:', content.length);

    // BYOK: Include auth header so backend can use user's personal API key
    const res = await fetch('/api/ai-service/ai/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        content: content,
        max_length: 200,
        language: 'zh',
      }),
    });

    if (!res.ok) {
      // 透传后端真实原因（如所选模型额度不足 / 未配可用模型 / provider 报错），
      // 不再硬编码"配置 ai-service.env"——该路由实际走主后端 BYOK，文案误导。
      let detail = `AI 服务返回错误 (${res.status})`;
      try {
        const error = await res.json();
        detail = error.error || error.detail || error.message || detail;
      } catch {
        /* 保留默认 */
      }
      setAiSummary(`⚠️ 摘要生成失败：${detail}`);
      return;
    }

    const result = await res.json();
    // Handle wrapped API response { success: true, data: T }
    const data = result?.data ?? result;
    setAiSummary(data.summary);

    // Save to database for future use
    if (data.summary) {
      await saveAIAnalysisToDatabase(resource.id, { aiSummary: data.summary });
    }
  } catch (error) {
    logger.error('Failed to generate summary:', error);
    setAiSummary(
      `⚠️ 摘要生成失败：${error instanceof Error ? error.message : '网络错误，请稍后重试'}`
    );
  } finally {
    setAiLoading(false);
  }
}

/**
 * Generate AI insights for resource
 */
export async function generateInsights(
  resource: Resource,
  articleTextContent: string,
  setAiInsights: (insights: AIInsight[]) => void
): Promise<void> {
  if (!resource) return;

  // Check if we already have insights in database
  if (resource.keyInsights && resource.keyInsights.length > 0) {
    logger.debug('Using cached insights from database');
    setAiInsights(resource.keyInsights);
    return;
  }

  try {
    // Use extracted article content if available, otherwise fallback to abstract
    const content = articleTextContent || resource.abstract || '';

    // Don't call AI with insufficient content
    if (content.length < 50) {
      return;
    }

    logger.debug('Generating insights with content length:', content.length);

    // BYOK: Include auth header so backend can use user's personal API key
    const res = await fetch('/api/ai-service/ai/insights', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeader() },
      body: JSON.stringify({
        content: content,
        language: 'zh',
      }),
    });

    const result = await res.json();
    // Handle wrapped API response { success: true, data: T }
    const data = result?.data ?? result;
    const insights = data.insights || [];
    setAiInsights(insights);

    // Save to database for future use
    if (insights.length > 0) {
      await saveAIAnalysisToDatabase(resource.id, { keyInsights: insights });
    }
  } catch (error) {
    logger.error('Failed to generate insights:', error);
  }
}
