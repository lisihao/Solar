#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const genesisRequire = createRequire(path.join(ROOT_DIR, 'package.json'));
const { Client } = genesisRequire('pg');

const SOLAR_SQLITE =
  process.env.SOLAR_TECH_HOTSPOT_DB ||
  '/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite';
const HF_REPORT_ROOT =
  process.env.SOLAR_HF_REPORT_ROOT ||
  '/Users/lisihao/Knowledge/_raw/tech-hotspot-radar';
const AI_DIGEST_ROOT =
  process.env.SOLAR_AI_DIGEST_ROOT ||
  '/Users/lisihao/Knowledge/_raw/ai-influence-daily-digest';
const HF_REPORT_PUBLIC_DIR = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-hf-paper-insights/html'
);
const AI_INFLUENCE_PUBLIC_DIR = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-ai-influence/html'
);
const HF_TRENDS_PUBLIC_PATH = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-hf-paper-trends.json'
);
const GITHUB_TRENDS_PUBLIC_PATH = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-github-trends.json'
);
const SOLAR_LIBRARY_SOURCES = [
  'solar-harness:hf-paper-insight',
  'solar-harness:hf-hot-paper',
  'solar-harness:ai-influence-digest',
  'solar-harness:ai-influence-field-report',
  'solar-harness:ai-influence-github-report',
];

function readDotEnv(file) {
  const values = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx < 0) continue;
    const key = trimmed.slice(0, idx).trim();
    let value = trimmed.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function sqliteJson(sql) {
  const output = execFileSync('sqlite3', [SOLAR_SQLITE, '-json', sql], {
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteTableExists(tableName) {
  return Boolean(
    sqliteJson(
      `select name from sqlite_master where type='table' and name='${escapeSql(tableName)}'`
    )[0]
  );
}

function frontMatterValue(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim() || '';
}

function mdTitle(content, fallback) {
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();
  const title = frontMatterValue(content, 'title');
  return title || fallback;
}

function reportExcerpt(content) {
  const withoutMatter = content.replace(/^---[\s\S]*?---\s*/, '').trim();
  const onePage = withoutMatter.match(
    /^##\s+一页判断\s*([\s\S]*?)(?=^##\s+)/m
  );
  const source = (onePage?.[1] || withoutMatter)
    .replace(/^>\s*/gm, '')
    .replace(/\n{2,}/g, '\n')
    .trim();
  return source.slice(0, 900);
}

function safeDateFromPath(file) {
  return file.match(/(20\d{2}-\d{2}-\d{2})/)?.[1] || '';
}

function copyReportHtml(date, htmlPath) {
  if (!date || !fs.existsSync(htmlPath)) return '';
  fs.mkdirSync(HF_REPORT_PUBLIC_DIR, { recursive: true });
  const targetName = `${date}.html`;
  fs.copyFileSync(htmlPath, path.join(HF_REPORT_PUBLIC_DIR, targetName));
  return `/local-data/solar-hf-paper-insights/html/${targetName}`;
}

function copyPublicHtml(sourcePath, publicSubdir, targetName) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return '';
  const targetDir = path.join(AI_INFLUENCE_PUBLIC_DIR, publicSubdir);
  fs.mkdirSync(targetDir, { recursive: true });
  const safeName = targetName.replace(/[^A-Za-z0-9._-]+/g, '-');
  fs.copyFileSync(sourcePath, path.join(targetDir, safeName));
  return `/local-data/solar-ai-influence/html/${publicSubdir}/${safeName}`;
}

function dateDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^20\d{2}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function titleFromIr(irPath, fallback) {
  if (!irPath || !fs.existsSync(irPath)) return fallback;
  try {
    const ir = JSON.parse(fs.readFileSync(irPath, 'utf8'));
    return (
      ir.title ||
      ir.report_title ||
      ir.headline ||
      ir.brief?.title ||
      ir.metadata?.title ||
      fallback
    );
  } catch {
    return fallback;
  }
}

function buildReportResource({
  type,
  title,
  abstract,
  content,
  sourceUrl,
  publishedAt,
  primaryCategory,
  categories,
  tags,
  qualityScore,
  trendingScore,
  metadata,
  sourceType,
  externalId,
  autoTags,
}) {
  return {
    type,
    title,
    abstract,
    content,
    source_url: sourceUrl,
    thumbnail_url: null,
    published_at: publishedAt,
    primary_category: primaryCategory,
    categories,
    tags,
    auto_tags: autoTags,
    quality_score: qualityScore,
    trending_score: trendingScore,
    view_count: 0,
    comment_count: 0,
    metadata,
    normalized_url: sourceUrl,
    source_type: sourceType,
    external_id: externalId,
  };
}

function buildAiInfluenceDigests() {
  return dateDirs(AI_DIGEST_ROOT)
    .filter((dir) => fs.existsSync(path.join(dir, 'digest.md')))
    .map((dir) => {
      const date = safeDateFromPath(dir);
      const mdPath = path.join(dir, 'digest.md');
      const htmlPath = path.join(dir, 'digest.html');
      const jsonPath = path.join(dir, 'digest.json');
      const content = fs.readFileSync(mdPath, 'utf8');
      const digestJson = fs.existsSync(jsonPath)
        ? JSON.parse(fs.readFileSync(jsonPath, 'utf8'))
        : {};
      const sourceUrl =
        copyPublicHtml(htmlPath, 'digest', `${date}.html`) || mdPath;
      return buildReportResource({
        type: 'BLOG',
        title: mdTitle(content, `AI Influence Digest ${date}`),
        abstract: reportExcerpt(content),
        content,
        sourceUrl,
        publishedAt: new Date(`${date}T12:00:00Z`),
        primaryCategory: '博客',
        categories: ['博客', 'AI Influence Digest', 'AI Influence'],
        tags: ['AI Influence Digest', 'AI Radar', 'Daily Brief'],
        autoTags: ['blog', 'ai-influence', 'digest'],
        qualityScore: 92,
        trendingScore: Number(digestJson.items?.length || digestJson.item_count || 0),
        sourceType: 'solar-harness:ai-influence-digest',
        externalId: `solar-harness:ai-influence-digest:${date}`,
        metadata: {
          importedAs: 'ai-influence-digest',
          source: 'solar-harness:ai-influence-digest',
          sourceName: 'AI Influence Digest',
          reportDate: date,
          localMarkdownPath: mdPath,
          localHtmlPath: htmlPath,
          localJsonPath: jsonPath,
          uiTab: 'blogs:digest',
        },
      });
    })
    .sort((a, b) => b.published_at - a.published_at);
}

function buildAiInfluenceFieldReports() {
  const plannedRoot = path.join(HF_REPORT_ROOT, 'ai-influence-planned');
  const reports = [];
  for (const dateDir of dateDirs(plannedRoot)) {
    const date = safeDateFromPath(dateDir);
    const reportsDir = path.join(dateDir, 'reports');
    if (!fs.existsSync(reportsDir)) continue;
    for (const entry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const reportDir = path.join(reportsDir, entry.name);
      const mdPath = path.join(reportDir, 'report.md');
      if (!fs.existsSync(mdPath)) continue;
      const htmlPath = path.join(reportDir, 'report.html');
      const irPath = path.join(reportDir, 'report-ir.json');
      const content = fs.readFileSync(mdPath, 'utf8');
      const sourceUrl =
        copyPublicHtml(htmlPath, 'field-reports', `${date}-${entry.name}.html`) ||
        mdPath;
      const title = titleFromIr(irPath, mdTitle(content, entry.name.replace(/-/g, ' ')));
      reports.push(
        buildReportResource({
          type: 'REPORT',
          title,
          abstract: reportExcerpt(content),
          content,
          sourceUrl,
          publishedAt: new Date(`${date}T12:00:00Z`),
          primaryCategory: '报告',
          categories: ['报告', '大咖访谈 / 大展洞察', 'AI Influence'],
          tags: ['AI Influence', '大咖访谈', '大展洞察'],
          autoTags: ['report', 'ai-influence', 'interview', 'event-insight'],
          qualityScore: 94,
          trendingScore: 80,
          sourceType: 'solar-harness:ai-influence-field-report',
          externalId: `solar-harness:ai-influence-field-report:${date}:${entry.name}`,
          metadata: {
            importedAs: 'ai-influence-field-report',
            source: 'solar-harness:ai-influence-field-report',
            sourceName: 'AI Influence · 大咖访谈 / 大展洞察',
            reportDate: date,
            reportSlug: entry.name,
            localMarkdownPath: mdPath,
            localHtmlPath: htmlPath,
            localIrPath: irPath,
            uiTab: 'reports:field',
          },
        })
      );
    }
  }

  const radarRoot = path.join(HF_REPORT_ROOT, 'ai-influence-radar');
  for (const dateDir of dateDirs(radarRoot)) {
    const date = safeDateFromPath(dateDir);
    for (const fileName of ['social-big-name-report.md', 'three-source-radar-report.md']) {
      const mdPath = path.join(dateDir, fileName);
      if (!fs.existsSync(mdPath)) continue;
      const content = fs.readFileSync(mdPath, 'utf8');
      reports.push(
        buildReportResource({
          type: 'REPORT',
          title: mdTitle(content, `AI Influence Radar ${date}`),
          abstract: reportExcerpt(content),
          content,
          sourceUrl: mdPath,
          publishedAt: new Date(`${date}T12:00:00Z`),
          primaryCategory: '报告',
          categories: ['报告', '大咖访谈 / 大展洞察', 'AI Influence'],
          tags: ['AI Influence', '大咖观点', '雷达报告'],
          autoTags: ['report', 'ai-influence', 'radar'],
          qualityScore: 90,
          trendingScore: 70,
          sourceType: 'solar-harness:ai-influence-field-report',
          externalId: `solar-harness:ai-influence-field-report:${date}:${fileName}`,
          metadata: {
            importedAs: 'ai-influence-field-report',
            source: 'solar-harness:ai-influence-field-report',
            sourceName: 'AI Influence · 大咖访谈 / 大展洞察',
            reportDate: date,
            reportSlug: fileName.replace(/\.md$/, ''),
            localMarkdownPath: mdPath,
            uiTab: 'reports:field',
          },
        })
      );
    }
  }

  return reports.sort((a, b) => b.published_at - a.published_at);
}

function buildAiInfluenceGithubReports() {
  const reportRoot = path.join(HF_REPORT_ROOT, 'github-trend-report');
  const reports = dateDirs(reportRoot)
    .filter((dir) => fs.existsSync(path.join(dir, 'github-trend-report.md')))
    .map((dir) => {
      const date = safeDateFromPath(dir);
      const mdPath = path.join(dir, 'github-trend-report.md');
      const htmlPath = path.join(dir, 'github-trend-report.html');
      const content = fs.readFileSync(mdPath, 'utf8');
      const sourceUrl =
        copyPublicHtml(htmlPath, 'github-reports', `${date}.html`) || mdPath;
      return buildReportResource({
        type: 'REPORT',
        title: mdTitle(content, `GitHub 洞察报告 ${date}`),
        abstract: reportExcerpt(content),
        content,
        sourceUrl,
        publishedAt: new Date(`${date}T12:00:00Z`),
        primaryCategory: '报告',
        categories: ['报告', 'GitHub 洞察', 'AI Influence'],
        tags: ['GitHub 洞察', 'AI Influence', 'Open Source'],
        autoTags: ['report', 'ai-influence', 'github'],
        qualityScore: 93,
        trendingScore: 85,
        sourceType: 'solar-harness:ai-influence-github-report',
        externalId: `solar-harness:ai-influence-github-report:${date}`,
        metadata: {
          importedAs: 'ai-influence-github-report',
          source: 'solar-harness:ai-influence-github-report',
          sourceName: 'AI Influence · GitHub 洞察',
          reportDate: date,
          localMarkdownPath: mdPath,
          localHtmlPath: htmlPath,
          uiTab: 'reports:github',
        },
      });
    });

  const radarRoot = path.join(HF_REPORT_ROOT, 'ai-influence-radar');
  for (const dateDir of dateDirs(radarRoot)) {
    const date = safeDateFromPath(dateDir);
    const mdPath = path.join(dateDir, 'github-report.md');
    if (!fs.existsSync(mdPath)) continue;
    const content = fs.readFileSync(mdPath, 'utf8');
    reports.push(
      buildReportResource({
        type: 'REPORT',
        title: mdTitle(content, `GitHub 洞察报告 ${date}`),
        abstract: reportExcerpt(content),
        content,
        sourceUrl: mdPath,
        publishedAt: new Date(`${date}T12:00:00Z`),
        primaryCategory: '报告',
        categories: ['报告', 'GitHub 洞察', 'AI Influence'],
        tags: ['GitHub 洞察', 'AI Influence', 'Open Source'],
        autoTags: ['report', 'ai-influence', 'github'],
        qualityScore: 90,
        trendingScore: 75,
        sourceType: 'solar-harness:ai-influence-github-report',
        externalId: `solar-harness:ai-influence-github-report:${date}:radar`,
        metadata: {
          importedAs: 'ai-influence-github-report',
          source: 'solar-harness:ai-influence-github-report',
          sourceName: 'AI Influence · GitHub 洞察',
          reportDate: date,
          localMarkdownPath: mdPath,
          uiTab: 'reports:github',
        },
      })
    );
  }

  return reports.sort((a, b) => b.published_at - a.published_at);
}

function buildInsightReports() {
  if (!fs.existsSync(HF_REPORT_ROOT)) return [];
  const dateDirs = fs
    .readdirSync(HF_REPORT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^20\d{2}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => path.join(HF_REPORT_ROOT, entry.name))
    .filter((dir) => fs.existsSync(path.join(dir, 'hf-paper-report.md')));

  return dateDirs
    .map((dir) => {
      const date = safeDateFromPath(dir);
      const mdPath = path.join(dir, 'hf-paper-report.md');
      const htmlPath = path.join(dir, 'hf-paper-report.html');
      const packPath = path.join(dir, 'hf-paper-insight-pack.json');
      const content = fs.readFileSync(mdPath, 'utf8');
      const pack = fs.existsSync(packPath)
        ? JSON.parse(fs.readFileSync(packPath, 'utf8'))
        : {};
      const reportUrl = copyReportHtml(date, htmlPath);
      const title = mdTitle(content, `HF Paper 洞察报告 ${date}`);
      const metrics = pack.collection_summary || {};
      const categories = [
        '论文',
        'HF Paper Insight',
        'HuggingFace',
        'arXiv',
        'AI Influence',
      ];

      return {
        type: 'PAPER',
        title,
        abstract: reportExcerpt(content),
        content,
        source_url: reportUrl || mdPath,
        thumbnail_url: null,
        published_at: new Date(`${date}T12:00:00Z`),
        primary_category: '论文',
        categories,
        tags: [
          'HF Paper Insight',
          'HuggingFace',
          'arXiv',
          'AI Influence',
          metrics.cadence || 'weekly',
        ].filter(Boolean),
        quality_score: 94,
        trending_score: Number(metrics.selected_papers || 0),
        view_count: 0,
        comment_count: 0,
        metadata: {
          importedAs: 'hf-paper-insight-report',
          source: 'solar-harness:hf-paper-insight',
          reportDate: date,
          reportWindow: metrics.window_label || pack.report_context?.window_label || null,
          reportCadence: metrics.cadence || pack.report_context?.cadence || null,
          selectedPapers: metrics.selected_papers || null,
          groupedSections: Number(frontMatterValue(content, 'grouped_sections') || 0),
          localMarkdownPath: mdPath,
          localHtmlPath: htmlPath,
          sourceName: 'AI Influence · HF Paper Insight',
        },
        normalized_url: reportUrl || mdPath,
        source_type: 'solar-harness:hf-paper-insight',
        external_id: `solar-harness:hf-paper-insight:${date}`,
      };
    })
    .sort((a, b) => b.published_at - a.published_at);
}

function parseTags(value) {
  return String(value || '')
    .split(',')
    .map((tag) => tag.trim())
    .filter(Boolean);
}

function parseJsonArray(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
  } catch {
    return parseTags(value);
  }
}

const TAG_LABELS = {
  agent: '智能体',
  coding_agent: '代码智能体',
  inference_compute: '推理计算',
  memory_context: '长上下文 / 记忆',
  multimodal: '多模态',
  paper_research: '论文研究',
  robotics: '机器人',
  document_ai: '文档智能',
  model_compression: '模型压缩',
  data_engineering: '数据工程',
  security: '安全',
  chip: '芯片',
  hardware: '硬件',
  software: '软件',
  robotics_physical_ai: '机器人 / 具身智能',
  research_automation: '研究自动化',
  ai_infrastructure: 'AI 基础设施',
  evaluation: '评测',
};

function uniqueValues(values) {
  return Array.from(new Set(values.filter(Boolean)));
}

function tagLabel(tag) {
  if (!tag) return 'N/A';
  if (TAG_LABELS[tag]) return TAG_LABELS[tag];
  if (tag.startsWith('arxiv:')) return tag.replace('arxiv:', 'arXiv ');
  return tag
    .split(/[_-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function rowTags(row) {
  const topicTags = parseTags(row.topic_tags);
  const categoryTags = parseTags(row.categories).map((category) => `arxiv:${category}`);
  return uniqueValues([...topicTags, ...categoryTags]);
}

function escapeSql(value) {
  return String(value || '').replace(/'/g, "''");
}

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function toDate(value) {
  const parsed = new Date(`${dateOnly(value)}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function addDays(date, days) {
  const next = new Date(date.getTime());
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}

function isoDate(date) {
  return date.toISOString().slice(0, 10);
}

function daysBetween(latestDate, value) {
  const date = toDate(value);
  if (!latestDate || !date) return 999;
  return Math.max(0, Math.round((latestDate.getTime() - date.getTime()) / 86400000));
}

function recencyWeight(daysAgo, halfLife = 21) {
  return Math.pow(0.5, Math.max(0, daysAgo) / halfLife);
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function topicBucket(row) {
  const tags = parseTags(row.topic_tags);
  const haystack = `${tags.join(' ')} ${row.title || ''} ${row.summary || ''}`.toLowerCase();

  if (/chip|semiconductor|hardware|accelerator|asic|gpu|tpu|nvlink|hbm|wafer/.test(haystack)) {
    return '芯片 / 硬件';
  }
  if (/inference_compute|serving|kernel|attention|sparse|latency|throughput|compute|cuda|memory/.test(haystack)) {
    return '推理计算';
  }
  if (/coding_agent|code|software|browser|computer-use|cli|repository|benchmark/.test(haystack)) {
    return 'Agent / 软件工程';
  }
  if (/agent|tool|workflow|planning|reasoning|memory_context/.test(haystack)) {
    return '智能体';
  }
  if (/multimodal|vision|video|image|audio|speech|vlm|mllm/.test(haystack)) {
    return '多模态';
  }
  if (/robotics|physical|embodied|spatial|3d|4d/.test(haystack)) {
    return '具身 / 空间智能';
  }
  if (/paper_research|survey|evaluation|eval|proof|math|theorem/.test(haystack)) {
    return '论文研究 / 评测';
  }
  return 'AI 模型';
}

function paperScore(row) {
  const rank = Number(row.rank || 999);
  return Math.max(1, 120 - Math.min(rank, 119));
}

const GITHUB_THEME_RULES = [
  {
    key: 'coding-agent-runtime',
    label: '代码智能体 / Agent Runtime',
    test: /claude|codex|cursor|copilot|coding[-_ ]?agent|agent[-_ ]?skills|devtools|mcp|plugin|workflow|tool[-_ ]?use|computer[-_ ]?use|browser[-_ ]?agent/,
  },
  {
    key: 'agent-memory-context',
    label: 'Agent 记忆 / 上下文工程',
    test: /memory|context|rag|knowledge|prompt|skill|workspace|harness|trace|notebook|retrieval/,
  },
  {
    key: 'model-serving-infra',
    label: '模型服务 / 推理基础设施',
    test: /serving|inference|vllm|sglang|runtime|cuda|gpu|kernel|latency|throughput|scheduler|distributed|observability/,
  },
  {
    key: 'multimodal-generation',
    label: '多模态生成 / 视频音频',
    test: /video|image|audio|speech|voice|tts|vision|multimodal|vlm|mllm|comfyui|sora|flux|wan/,
  },
  {
    key: 'data-document-intelligence',
    label: '文档 / 数据智能',
    test: /document|pdf|markdown|etl|dataset|table|spreadsheet|extract|parser|knowledge[-_ ]?graph|database|analytics/,
  },
  {
    key: 'security-automation',
    label: '安全 / 浏览器自动化',
    test: /security|sandbox|browser|scraping|stealth|captcha|cloudflare|fingerprint|playwright|puppeteer|privacy|auth/,
  },
  {
    key: 'robotics-physical-ai',
    label: '机器人 / 具身智能',
    test: /robot|robotics|embodied|physical|spatial|3d|simulation|autonomous|control/,
  },
  {
    key: 'ai-engineering-learning',
    label: 'AI 工程方法 / 教程',
    test: /engineering|from[-_ ]?scratch|course|cookbook|tutorial|benchmark|eval|evaluation|example|template/,
  },
];

function githubRepoTags(row) {
  return uniqueValues([
    ...parseTags(row.topics),
    ...parseJsonArray(row.external_topics_json),
    row.language,
  ].map((value) => String(value || '').toLowerCase()).filter(Boolean));
}

function githubTheme(row) {
  const haystack = [
    row.full_name,
    row.description,
    row.language,
    row.topics,
    row.external_topics_json,
    row.positioning,
    row.core_technical_idea,
    row.trend_implication,
  ]
    .join(' ')
    .toLowerCase();

  return (
    GITHUB_THEME_RULES.find((rule) => rule.test.test(haystack)) || {
      key: 'open-ai-tooling',
      label: '开源 AI 工具链',
    }
  );
}

function githubMaturityPenalty(stars) {
  const total = Number(stars || 0);
  if (total >= 150000) return 0.58;
  if (total >= 100000) return 0.68;
  if (total >= 60000) return 0.82;
  if (total >= 30000) return 0.93;
  return 1.08;
}

function githubMaturityBand(stars) {
  const total = Number(stars || 0);
  if (total >= 100000) return '成熟大仓';
  if (total >= 30000) return '高关注';
  if (total >= 5000) return '成长中';
  return '早期';
}

function githubNoveltyBoost(row) {
  const text = [
    row.full_name,
    row.description,
    row.topics,
    row.positioning,
    row.core_technical_idea,
    row.trend_implication,
  ]
    .join(' ')
    .toLowerCase();
  let boost = 0;
  if (/mcp|agent|claude|codex|computer[-_ ]?use|browser[-_ ]?agent|skill|memory|context/.test(text)) boost += 22;
  if (/new|experimental|from[-_ ]?scratch|v2|runtime|workflow|plugin|benchmark|eval/.test(text)) boost += 10;
  if (/awesome|list|collection|curated|resources/.test(text)) boost -= 18;
  return boost;
}

function githubRepoScore(row, latestDate) {
  const stars = Number(row.stars_latest || row.stars || row.source_stars || 0);
  const delta24h = Number(row.star_delta_24h || 0);
  const delta7d = Number(row.star_delta_7d || 0);
  const delta30d = Number(row.star_delta_30d || 0);
  const acceleration = Number(row.acceleration || 0);
  const rankAppearances = Number(row.rank_appearances || 0);
  const bestRank = Number(row.best_rank || 999);
  const daysAgo = daysBetween(latestDate, row.latest_snapshot_at || row.latest_rank_date || row.updated_at);
  const recency = recencyWeight(daysAgo, 14);
  const rankScore =
    rankAppearances > 0 ? rankAppearances * Math.max(1, 120 - Math.min(bestRank, 119)) : 0;
  const velocity =
    Math.log1p(Math.max(0, delta7d)) * 28 +
    Math.log1p(Math.max(0, delta24h)) * 18 +
    Math.log1p(Math.max(0, delta30d)) * 8 +
    Math.max(0, acceleration) * 0.08;
  const cardBoost =
    row.trend_implication || row.core_technical_idea
      ? (Number(row.confidence || 0.5) * 18 + (row.tier === 'A' ? 14 : row.tier === 'B' ? 8 : 3))
      : 0;
  const hasVelocity = delta24h > 0 || delta7d > 0 || delta30d > 0 || acceleration > 0;
  const hasAnalysisCard = Boolean(row.trend_implication || row.core_technical_idea);
  let signalQuality = 1;
  if (!hasVelocity && !hasAnalysisCard && stars < 20) signalQuality *= 0.18;
  else if (!hasVelocity && !hasAnalysisCard && stars < 100) signalQuality *= 0.38;
  else if (!hasVelocity && stars < 100) signalQuality *= 0.62;
  if (!hasVelocity && !hasAnalysisCard && rankAppearances < 3) signalQuality *= 0.55;
  const score =
    (velocity + rankScore * 0.75 + cardBoost + githubNoveltyBoost(row)) *
    githubMaturityPenalty(row.stars_latest || row.stars) *
    (0.45 + recency * 0.55) *
    signalQuality;
  return Math.max(1, Math.round(score));
}

function githubHasEmergingSignal(repo) {
  const stars = Number(repo.stars || 0);
  const hasVelocity =
    Number(repo.starDelta7d || 0) > 0 || Number(repo.acceleration || 0) > 0;
  if (stars < 100 && !hasVelocity) return false;
  return (
    hasVelocity ||
    Boolean(repo.trendImplication || repo.coreTechnicalIdea) ||
    (stars >= 100 && Number(repo.rankAppearances || 0) >= 3)
  );
}

function compactGithubRepo(row, extra = {}) {
  const tags = githubRepoTags(row);
  return {
    fullName: row.full_name,
    description: row.description || '',
    language: row.language || '',
    htmlUrl: row.html_url || row.repo_url || '',
    stars: Number(row.stars_latest || row.stars || row.source_stars || 0),
    forks: Number(row.forks || 0),
    openIssues: Number(row.open_issues || 0),
    createdAt: row.created_at || null,
    updatedAt: row.updated_at || null,
    pushedAt: row.pushed_at || null,
    latestSnapshotAt: row.latest_snapshot_at || null,
    latestRankDate: row.latest_rank_date || null,
    starDelta24h: Number(row.star_delta_24h || 0),
    starDelta7d: Number(row.star_delta_7d || 0),
    starDelta30d: Number(row.star_delta_30d || 0),
    acceleration: Math.round(Number(row.acceleration || 0)),
    rankAppearances: Number(row.rank_appearances || 0),
    bestRank: Number(row.best_rank || 0),
    latestRank: Number(row.latest_rank || 0),
    sources: parseJsonArray(row.external_sources_json),
    tags,
    theme: extra.theme || githubTheme(row).label,
    positioning: row.positioning || '',
    coreTechnicalIdea: row.core_technical_idea || '',
    trendImplication: row.trend_implication || '',
    tier: row.tier || '',
    confidence: Number(row.confidence || 0),
    maturityBand: githubMaturityBand(row.stars_latest || row.stars),
    ...extra,
  };
}

function compactPaper(row, extra = {}) {
  const tags = rowTags(row);
  return {
    paperId: row.paper_id,
    title: row.title,
    date: dateOnly(row.paper_date || row.fetched_at),
    rank: Number(row.rank || 0),
    topic: topicBucket(row),
    tags,
    tagLabels: tags.map(tagLabel),
    hfUrl: row.hf_url || null,
    arxivUrl: row.arxiv_url || null,
    source: row.source || 'hf',
    summary: row.summary || '',
    ...extra,
  };
}

function topEvidence(evidenceRows, limit = 3) {
  const byPaper = new Map();
  for (const item of evidenceRows) {
    const key = item.row.paper_id;
    const current = byPaper.get(key);
    if (!current || item.score > current.score) {
      byPaper.set(key, item);
    }
  }
  return Array.from(byPaper.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((item) => compactPaper(item.row, { evidenceScore: Math.round(item.score) }));
}

function buildTagPulse(rows, dates, latestDaily) {
  const dateSet = new Set(dates);
  const latestDate = toDate(latestDaily);
  const tagStats = new Map();
  const pairStats = new Map();

  const ensureTag = (tag) => {
    if (!tagStats.has(tag)) {
      tagStats.set(tag, {
        tag,
        label: tagLabel(tag),
        valuesByDate: new Map(),
        count: 0,
        totalScore: 0,
        papers: new Set(),
        sourceCounts: new Map(),
        evidenceRows: [],
      });
    }
    return tagStats.get(tag);
  };

  const ensurePair = (left, right) => {
    const tags = [left, right].sort();
    const key = tags.join('::');
    if (!pairStats.has(key)) {
      pairStats.set(key, {
        key,
        tags,
        label: `${tagLabel(tags[0])} × ${tagLabel(tags[1])}`,
        count: 0,
        score: 0,
        sourceCounts: new Map(),
        evidenceRows: [],
      });
    }
    return pairStats.get(key);
  };

  for (const row of rows) {
    const rowDate = dateOnly(row.paper_date);
    if (!dateSet.has(rowDate)) continue;

    const tags = rowTags(row).slice(0, 12);
    if (tags.length === 0) continue;

    const baseScore = paperScore(row);
    const weight = recencyWeight(daysBetween(latestDate, rowDate), 21);
    const score = baseScore * weight;
    const source = row.source || 'hf';

    for (const tag of tags) {
      const stat = ensureTag(tag);
      stat.count += 1;
      stat.totalScore += score;
      stat.papers.add(row.paper_id);
      stat.valuesByDate.set(rowDate, (stat.valuesByDate.get(rowDate) || 0) + score);
      stat.sourceCounts.set(source, (stat.sourceCounts.get(source) || 0) + 1);
      stat.evidenceRows.push({ row, score });
    }

    for (let i = 0; i < tags.length; i += 1) {
      for (let j = i + 1; j < tags.length; j += 1) {
        const pair = ensurePair(tags[i], tags[j]);
        pair.count += 1;
        pair.score += score;
        pair.sourceCounts.set(source, (pair.sourceCounts.get(source) || 0) + 1);
        pair.evidenceRows.push({ row, score });
      }
    }
  }

  const tagRows = Array.from(tagStats.values()).map((stat) => {
    const values = dates.map((date) => stat.valuesByDate.get(date) || 0);
    const latestScore = values[values.length - 1] || 0;
    const priorValues = values.slice(0, -1);
    const baseline = average(priorValues);
    const recent7 = values.slice(-7).reduce((sum, value) => sum + value, 0);
    const previousWindow = values.slice(-30, -7);
    const previousDailyAverage = average(previousWindow);
    const acceleration = recent7 - previousDailyAverage * Math.min(7, previousWindow.length || 7);
    const historicalBeforeRecent = Math.max(0, stat.totalScore - recent7);
    const novelty = Math.min(1, recent7 / (recent7 + historicalBeforeRecent + 25));
    const persistence = values.filter((value) => value > 0).length;
    const sourceCount = stat.sourceCounts.size;
    const confidence = Math.min(1, 0.35 + persistence / 18 + sourceCount * 0.12);
    const hotspotScore =
      stat.totalScore * 0.34 +
      Math.max(0, acceleration) * 0.28 +
      novelty * 130 +
      persistence * 7 +
      sourceCount * 18;

    return {
      tag: stat.tag,
      label: stat.label,
      totalScore: Math.round(stat.totalScore),
      hotspotScore: Math.round(hotspotScore),
      latestScore: Math.round(latestScore),
      baseline: Math.round(baseline),
      delta: Math.round(latestScore - baseline),
      acceleration: Math.round(acceleration),
      novelty: Number(novelty.toFixed(3)),
      persistence,
      confidence: Number(confidence.toFixed(3)),
      count: stat.count,
      paperCount: stat.papers.size,
      sources: Object.fromEntries(stat.sourceCounts.entries()),
      values: values.map((value) => Math.round(value)),
      evidence: topEvidence(stat.evidenceRows),
    };
  });

  const sortedTags = tagRows.sort(
    (a, b) => b.hotspotScore - a.hotspotScore || b.totalScore - a.totalScore
  );
  const emerging = [...tagRows]
    .sort(
      (a, b) =>
        b.acceleration - a.acceleration ||
        b.novelty - a.novelty ||
        b.hotspotScore - a.hotspotScore
    )
    .slice(0, 8);

  const cooccurrence = Array.from(pairStats.values())
    .map((pair) => ({
      key: pair.key,
      tags: pair.tags,
      labels: pair.tags.map(tagLabel),
      label: pair.label,
      score: Math.round(pair.score),
      count: pair.count,
      sources: Object.fromEntries(pair.sourceCounts.entries()),
      evidence: topEvidence(pair.evidenceRows),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 10);

  return {
    version: 1,
    generatedFrom: 'topic_tags + arxiv categories',
    window: `${dates[0] || 'N/A'} — ${dates[dates.length - 1] || 'N/A'}`,
    method:
      'TagPulse scores tags by rank-weighted appearances, recency decay, 7-day acceleration, novelty, persistence, and source diversity.',
    tags: sortedTags.slice(0, 12),
    emerging,
    cooccurrence,
  };
}

function periodTable(rows, startDate, endDate, limit = 12) {
  const byPaper = new Map();
  for (const row of rows) {
    const rowDate = dateOnly(row.paper_date);
    if (rowDate < startDate || rowDate > endDate) continue;
    const current = byPaper.get(row.paper_id);
    const rank = Number(row.rank || 9999);
    if (!current) {
      byPaper.set(row.paper_id, {
        row,
        appearances: 1,
        bestRank: rank,
        latestDate: rowDate,
        trendScore: paperScore(row),
      });
      continue;
    }
    current.appearances += 1;
    current.bestRank = Math.min(current.bestRank, rank);
    current.trendScore += paperScore(row);
    if (rowDate > current.latestDate || rank < Number(current.row.rank || 9999)) {
      current.row = row;
      current.latestDate = rowDate;
    }
  }

  return Array.from(byPaper.values())
    .sort((a, b) => b.trendScore - a.trendScore || a.bestRank - b.bestRank)
    .slice(0, limit)
    .map((item, index) =>
      compactPaper(item.row, {
        tableRank: index + 1,
        appearances: item.appearances,
        bestRank: item.bestRank,
        trendScore: Math.round(item.trendScore),
        latestDate: item.latestDate,
      })
    );
}

function topicTrend(rows, dates) {
  const dateSet = new Set(dates);
  const scores = new Map();
  const counts = new Map();

  for (const row of rows) {
    const rowDate = dateOnly(row.paper_date);
    if (!dateSet.has(rowDate)) continue;
    const topic = topicBucket(row);
    const key = `${topic}::${rowDate}`;
    scores.set(key, (scores.get(key) || 0) + paperScore(row));
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  const topicTotals = new Map();
  for (const [key, score] of scores.entries()) {
    const [topic] = key.split('::');
    topicTotals.set(topic, (topicTotals.get(topic) || 0) + score);
  }

  return Array.from(topicTotals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([topic, totalScore]) => {
      const values = dates.map((date) => scores.get(`${topic}::${date}`) || 0);
      const countValues = dates.map((date) => counts.get(`${topic}::${date}`) || 0);
      const latest = values[values.length - 1] || 0;
      const previous = values.slice(0, -1).reduce((sum, value) => sum + value, 0) / Math.max(1, values.length - 1);
      return {
        topic,
        totalScore: Math.round(totalScore),
        latestScore: Math.round(latest),
        delta: Math.round(latest - previous),
        count: countValues.reduce((sum, value) => sum + value, 0),
        values,
        countValues,
      };
    });
}

function buildPaperTrendData() {
  const hasArxivDaily = sqliteTableExists('arxiv_daily_papers');
  const latestDaily = sqliteJson(`
    select max(paper_date) as paper_date from (
      select max(paper_date) as paper_date from hf_daily_papers
      ${hasArxivDaily ? "union all select max(paper_date) as paper_date from arxiv_daily_papers" : ''}
    )
  `)[0]?.paper_date;
  if (!latestDaily) {
    return {
      generatedAt: new Date().toISOString(),
      latestDailyDate: null,
      dates: [],
      topics: [],
      tables: { day: [], week: [], month: [], quarter: [] },
      source: { sqlite: SOLAR_SQLITE, rows: 0 },
    };
  }

  const latestDate = toDate(latestDaily);
  const quarterStart = isoDate(addDays(latestDate, -89));
  const monthStart = isoDate(addDays(latestDate, -29));
  const weekStart = isoDate(addDays(latestDate, -6));
  const chartStart = isoDate(addDays(latestDate, -29));
  const rows = sqliteJson(`
    select * from (
      select
        paper_date,
        paper_id,
        title,
        hf_url,
        arxiv_url,
        summary,
        authors,
        rank,
        topic_tags,
        '' as categories,
        first_seen_at,
        last_seen_at,
        fetched_at,
        'hf' as source
      from hf_daily_papers
      where paper_date >= '${escapeSql(quarterStart)}'
      ${hasArxivDaily ? `
      union all
      select
        paper_date,
        arxiv_id as paper_id,
        title,
        '' as hf_url,
        arxiv_url,
        summary,
        authors,
        rank,
        topic_tags,
        categories,
        first_seen_at,
        last_seen_at,
        fetched_at,
        'arxiv' as source
      from arxiv_daily_papers
      where paper_date >= '${escapeSql(quarterStart)}'
      ` : ''}
    )
    order by paper_date asc, rank asc
  `);
  const coverage = sqliteJson(`
    select
      (select min(paper_date) from hf_daily_papers) as startDate,
      (select max(paper_date) from hf_daily_papers) as endDate,
      (select count(distinct paper_date) from hf_daily_papers) as days,
      (select count(*) from hf_daily_papers) as hfRows,
      (select count(distinct paper_id) from hf_daily_papers) as hfPapers,
      (select sum(case when arxiv_url <> '' then 1 else 0 end) from hf_daily_papers) as hfArxivUrlRows
      ${hasArxivDaily ? `,
      (select count(*) from arxiv_daily_papers) as arxivRows,
      (select count(distinct arxiv_id) from arxiv_daily_papers) as arxivPapers,
      (select min(paper_date) from arxiv_daily_papers) as arxivStartDate,
      (select max(paper_date) from arxiv_daily_papers) as arxivEndDate
      ` : `,
      0 as arxivRows,
      0 as arxivPapers,
      null as arxivStartDate,
      null as arxivEndDate
      `}
  `)[0] || {};
  coverage.rows = Number(coverage.hfRows || 0) + Number(coverage.arxivRows || 0);
  coverage.papers = Number(coverage.hfPapers || 0) + Number(coverage.arxivPapers || 0);
  coverage.arxivUrlRows = Number(coverage.hfArxivUrlRows || 0);

  const dates = [];
  for (let date = toDate(chartStart); date <= latestDate; date = addDays(date, 1)) {
    dates.push(isoDate(date));
  }
  const allDayCounts = new Map();
  for (const row of rows) {
    const rowDate = dateOnly(row.paper_date);
    allDayCounts.set(rowDate, (allDayCounts.get(rowDate) || 0) + 1);
  }

  const latestRows = rows.filter((row) => dateOnly(row.paper_date) === latestDaily);
  const topics = topicTrend(rows, dates);
  const tagPulse = buildTagPulse(rows, dates, latestDaily);
  const leadingTopic = topics[0] || null;

  return {
    generatedAt: new Date().toISOString(),
    latestDailyDate: latestDaily,
    windows: {
      day: latestDaily,
      week: `${weekStart} — ${latestDaily}`,
      month: `${monthStart} — ${latestDaily}`,
      quarter: `${quarterStart} — ${latestDaily}`,
    },
    dates,
    dailyCounts: dates.map((date) => ({
      date,
      count: allDayCounts.get(date) || 0,
    })),
    topics,
    tagPulse,
    headline: {
      leadingTopic: leadingTopic?.topic || 'N/A',
      leadingScore: leadingTopic?.totalScore || 0,
      papersToday: latestRows.length,
      papersInQuarter: rows.length,
    },
    tables: {
      day: periodTable(rows, latestDaily, latestDaily, 12),
      week: periodTable(rows, weekStart, latestDaily, 12),
      month: periodTable(rows, monthStart, latestDaily, 12),
      quarter: periodTable(rows, quarterStart, latestDaily, 12),
    },
    source: {
      sqlite: SOLAR_SQLITE,
      rows: rows.length,
      coverage,
      method: 'Derived from Solar hf_daily_papers and arxiv_daily_papers ranks and topic_tags; no model-generated trend inference.',
    },
  };
}

function writePaperTrendData() {
  const trendData = buildPaperTrendData();
  fs.mkdirSync(path.dirname(HF_TRENDS_PUBLIC_PATH), { recursive: true });
  fs.writeFileSync(HF_TRENDS_PUBLIC_PATH, `${JSON.stringify(trendData, null, 2)}\n`);
  return trendData;
}

function githubPeriodTable(repos, startDate, endDate, limit = 12) {
  return repos
    .filter((repo) => {
      const signalDate = dateOnly(
        repo.latestSnapshotAt || repo.latestRankDate || repo.updatedAt || repo.pushedAt
      );
      return signalDate >= startDate && signalDate <= endDate;
    })
    .sort((a, b) => b.emergingScore - a.emergingScore || b.starDelta7d - a.starDelta7d)
    .slice(0, limit)
    .map((repo, index) => ({ ...repo, tableRank: index + 1 }));
}

function buildGithubThemeTrend(rankRows, repos, dates, latestDate) {
  const dateSet = new Set(dates);
  const scores = new Map();
  const counts = new Map();
  const repoEvidence = new Map();

  for (const row of rankRows) {
    const rowDate = dateOnly(row.observed_at);
    if (!dateSet.has(rowDate)) continue;
    const theme = githubTheme(row).label;
    const key = `${theme}::${rowDate}`;
    const score =
      Math.max(1, 120 - Math.min(Number(row.rank || 999), 119)) *
      recencyWeight(daysBetween(latestDate, rowDate), 30);
    scores.set(key, (scores.get(key) || 0) + score);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

  for (const repo of repos) {
    const repoDate = dateOnly(repo.latestSnapshotAt || repo.latestRankDate || repo.updatedAt);
    if (!dateSet.has(repoDate)) continue;
    const key = `${repo.theme}::${repoDate}`;
    scores.set(key, (scores.get(key) || 0) + repo.emergingScore * 0.35);
    counts.set(key, (counts.get(key) || 0) + 1);
    const evidence = repoEvidence.get(repo.theme) || [];
    evidence.push(repo);
    repoEvidence.set(repo.theme, evidence);
  }

  const totals = new Map();
  for (const [key, score] of scores.entries()) {
    const [theme] = key.split('::');
    totals.set(theme, (totals.get(theme) || 0) + score);
  }

  return Array.from(totals.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([theme, totalScore]) => {
      const values = dates.map((date) => Math.round(scores.get(`${theme}::${date}`) || 0));
      const countValues = dates.map((date) => counts.get(`${theme}::${date}`) || 0);
      const latest = values[values.length - 1] || 0;
      const baseline = average(values.slice(0, Math.max(1, values.length - 7)));
      const evidence = (repoEvidence.get(theme) || [])
        .sort((a, b) => b.emergingScore - a.emergingScore)
        .slice(0, 3);
      return {
        theme,
        totalScore: Math.round(totalScore),
        latestScore: Math.round(latest),
        delta: Math.round(latest - baseline),
        repoCount: uniqueValues(evidence.map((repo) => repo.fullName)).length,
        values,
        countValues,
        evidence,
      };
    });
}

function buildGithubTopicPulse(repos) {
  const tagStats = new Map();
  const pairStats = new Map();

  for (const repo of repos) {
    const tags = uniqueValues([
      repo.theme,
      repo.language,
      ...(repo.tags || []),
    ])
      .map((tag) => String(tag || '').trim())
      .filter((tag) => tag && tag.length < 48)
      .slice(0, 8);

    for (const tag of tags) {
      const current =
        tagStats.get(tag) || {
          tag,
          score: 0,
          repoCount: 0,
          starDelta7d: 0,
          acceleration: 0,
          evidence: [],
        };
      current.score += repo.emergingScore;
      current.repoCount += 1;
      current.starDelta7d += repo.starDelta7d || 0;
      current.acceleration += repo.acceleration || 0;
      current.evidence.push(repo);
      tagStats.set(tag, current);
    }

    for (let i = 0; i < Math.min(tags.length, 5); i += 1) {
      for (let j = i + 1; j < Math.min(tags.length, 5); j += 1) {
        const pairTags = [tags[i], tags[j]].sort();
        const key = pairTags.join(' + ');
        const current =
          pairStats.get(key) || {
            key,
            tags: pairTags,
            score: 0,
            count: 0,
            evidence: [],
          };
        current.score += repo.emergingScore;
        current.count += 1;
        current.evidence.push(repo);
        pairStats.set(key, current);
      }
    }
  }

  const tags = Array.from(tagStats.values())
    .map((tag) => ({
      tag: tag.tag,
      label: tagLabel(tag.tag),
      hotspotScore: Math.round(tag.score),
      repoCount: tag.repoCount,
      starDelta7d: Math.round(tag.starDelta7d),
      acceleration: Math.round(tag.acceleration),
      evidence: tag.evidence
        .sort((a, b) => b.emergingScore - a.emergingScore)
        .slice(0, 3),
    }))
    .sort((a, b) => b.hotspotScore - a.hotspotScore)
    .slice(0, 14);

  const emerging = [...tags]
    .sort(
      (a, b) =>
        b.acceleration - a.acceleration ||
        b.starDelta7d - a.starDelta7d ||
        b.hotspotScore - a.hotspotScore
    )
    .slice(0, 8);

  const cooccurrence = Array.from(pairStats.values())
    .map((pair) => ({
      key: pair.key,
      tags: pair.tags,
      label: pair.tags.map(tagLabel).join(' x '),
      score: Math.round(pair.score),
      count: pair.count,
      evidence: pair.evidence
        .sort((a, b) => b.emergingScore - a.emergingScore)
        .slice(0, 3),
    }))
    .sort((a, b) => b.score - a.score || b.count - a.count)
    .slice(0, 10);

  return {
    version: 1,
    generatedFrom: 'github_repos + repo_velocity_metrics + github_external_rank_snapshots + repo_analysis_cards',
    method:
      'GitHubPulse weights star velocity, acceleration, external-rank appearances, recency, topic co-occurrence, and analysis-card confidence; mature repos are discounted so emerging directions surface first.',
    tags,
    emerging,
    cooccurrence,
  };
}

function buildGithubTrendData() {
  const requiredTables = [
    'github_repos',
    'repo_velocity_metrics',
    'github_external_rank_snapshots',
  ];
  const missingTables = requiredTables.filter((table) => !sqliteTableExists(table));
  if (missingTables.length > 0) {
    return {
      generatedAt: new Date().toISOString(),
      latestObservedAt: null,
      dates: [],
      themes: [],
      tables: { day: [], week: [], month: [], quarter: [] },
      source: { sqlite: SOLAR_SQLITE, rows: 0, missingTables },
    };
  }

  const latestObserved =
    sqliteJson(`
      select max(observed_at) as observed_at from (
        select max(latest_snapshot_at) as observed_at from repo_velocity_metrics
        union all
        select max(observed_at) as observed_at from github_external_rank_snapshots
      )
    `)[0]?.observed_at || null;

  if (!latestObserved) {
    return {
      generatedAt: new Date().toISOString(),
      latestObservedAt: null,
      dates: [],
      themes: [],
      tables: { day: [], week: [], month: [], quarter: [] },
      source: { sqlite: SOLAR_SQLITE, rows: 0 },
    };
  }

  const latestDate = toDate(latestObserved);
  const latestDay = isoDate(latestDate);
  const quarterStart = isoDate(addDays(latestDate, -89));
  const monthStart = isoDate(addDays(latestDate, -29));
  const weekStart = isoDate(addDays(latestDate, -6));
  const chartStart = isoDate(addDays(latestDate, -29));
  const dates = [];
  for (let date = toDate(chartStart); date <= latestDate; date = addDays(date, 1)) {
    dates.push(isoDate(date));
  }

  const rankRows = sqliteJson(`
    select
      full_name,
      source,
      rank,
      repo_url,
      description,
      language,
      topics_json,
      source_stars,
      observed_at
    from github_external_rank_snapshots
    where observed_at >= '${escapeSql(quarterStart)}'
  `);

  const repoRows = sqliteJson(`
    with ext as (
      select
        full_name,
        count(*) as rank_appearances,
        min(rank) as best_rank,
        max(rank) as latest_rank,
        max(observed_at) as latest_rank_date,
        group_concat(distinct source) as external_sources_json
      from github_external_rank_snapshots
      where observed_at >= '${escapeSql(quarterStart)}'
      group by full_name
    ),
    latest_cards as (
      select c.*
      from repo_analysis_cards c
      join (
        select repo_full_name, max(created_at) as created_at
        from repo_analysis_cards
        group by repo_full_name
      ) latest
        on latest.repo_full_name = c.repo_full_name
       and latest.created_at = c.created_at
    )
    select
      r.full_name,
      r.html_url,
      r.description,
      r.topics,
      r.language,
      r.stars,
      r.forks,
      r.open_issues,
      r.created_at,
      r.updated_at,
      r.pushed_at,
      v.latest_snapshot_at,
      v.stars_latest,
      v.star_delta_24h,
      v.star_delta_7d,
      v.star_delta_30d,
      v.acceleration,
      coalesce(ext.rank_appearances, 0) as rank_appearances,
      coalesce(ext.best_rank, 999) as best_rank,
      coalesce(ext.latest_rank, 999) as latest_rank,
      ext.latest_rank_date,
      ext.external_sources_json,
      c.positioning,
      c.core_technical_idea,
      c.trend_implication,
      c.tier,
      c.confidence
    from github_repos r
    left join repo_velocity_metrics v on v.repo_full_name = r.full_name
    left join ext on ext.full_name = r.full_name
    left join latest_cards c on c.repo_full_name = r.full_name
    where coalesce(r.archived, 0) = 0
      and (
        v.repo_full_name is not null
        or ext.full_name is not null
        or c.repo_full_name is not null
      )
  `);

  const repos = repoRows
    .map((row) => {
      const theme = githubTheme(row);
      const emergingScore = githubRepoScore(row, latestDate);
      return compactGithubRepo(row, {
        theme: theme.label,
        themeKey: theme.key,
        emergingScore,
      });
    })
    .filter((repo) => repo.emergingScore > 0)
    .sort((a, b) => b.emergingScore - a.emergingScore);

  const dayCountsMap = new Map();
  const dayScoreMap = new Map();
  for (const row of rankRows) {
    const rowDate = dateOnly(row.observed_at);
    if (!dates.includes(rowDate)) continue;
    dayCountsMap.set(rowDate, (dayCountsMap.get(rowDate) || 0) + 1);
    dayScoreMap.set(
      rowDate,
      (dayScoreMap.get(rowDate) || 0) + Math.max(1, 120 - Math.min(Number(row.rank || 999), 119))
    );
  }

  const themes = buildGithubThemeTrend(rankRows, repos, dates, latestDate);
  const pulse = buildGithubTopicPulse(repos.slice(0, 160));
  const emergingRepos = repos
    .filter(
      (repo) =>
        githubHasEmergingSignal(repo) &&
        (repo.maturityBand !== '成熟大仓' || repo.starDelta7d >= 1500)
    )
    .slice(0, 24);

  const coverage = sqliteJson(`
    select
      (select count(*) from github_repos) as repos,
      (select count(*) from github_star_snapshots) as starSnapshots,
      (select count(*) from github_external_rank_snapshots) as rankSnapshots,
      (select count(*) from repo_velocity_metrics) as velocityRows,
      (select count(*) from repo_analysis_cards) as analysisCards,
      (select min(observed_at) from github_external_rank_snapshots) as startDate,
      (select max(observed_at) from github_external_rank_snapshots) as endDate
  `)[0] || {};

  return {
    generatedAt: new Date().toISOString(),
    latestObservedAt: latestObserved,
    latestObservedDate: latestDay,
    windows: {
      day: latestDay,
      week: `${weekStart} — ${latestDay}`,
      month: `${monthStart} — ${latestDay}`,
      quarter: `${quarterStart} — ${latestDay}`,
    },
    dates,
    dailyCounts: dates.map((date) => ({
      date,
      count: dayCountsMap.get(date) || 0,
      score: Math.round(dayScoreMap.get(date) || 0),
    })),
    themes,
    pulse,
    headline: {
      leadingTheme: themes[0]?.theme || 'N/A',
      leadingScore: themes[0]?.totalScore || 0,
      emergingRepos: emergingRepos.length,
      starDelta7d: repos.reduce((sum, repo) => sum + Math.max(0, repo.starDelta7d || 0), 0),
      breakoutRepos: repos.filter((repo) => (repo.starDelta7d || 0) >= 1000 || (repo.acceleration || 0) >= 1000).length,
      sourceRepos: coverage.repos || 0,
    },
    emergingRepos,
    acceleratingRepos: [...repos]
      .sort((a, b) => b.acceleration - a.acceleration || b.emergingScore - a.emergingScore)
      .slice(0, 24),
    tables: {
      day: githubPeriodTable(emergingRepos, latestDay, latestDay, 12),
      week: githubPeriodTable(emergingRepos, weekStart, latestDay, 12),
      month: githubPeriodTable(emergingRepos, monthStart, latestDay, 12),
      quarter: githubPeriodTable(emergingRepos, quarterStart, latestDay, 12),
    },
    source: {
      sqlite: SOLAR_SQLITE,
      rows: repos.length,
      coverage,
      method:
        'Derived from Solar GitHub star velocity, external rank snapshots, repo topics, and AI Influence repo analysis cards. GitHubPulse discounts mature mega-repos to highlight emerging technical directions.',
    },
  };
}

function writeGithubTrendData() {
  const trendData = buildGithubTrendData();
  fs.mkdirSync(path.dirname(GITHUB_TRENDS_PUBLIC_PATH), { recursive: true });
  fs.writeFileSync(GITHUB_TRENDS_PUBLIC_PATH, `${JSON.stringify(trendData, null, 2)}\n`);
  return trendData;
}

function buildHotPapers() {
  const latestDaily = sqliteJson(
    `select max(paper_date) as paper_date from hf_daily_papers`
  )[0]?.paper_date;
  const dailyRows = latestDaily
    ? sqliteJson(`
        select
          'daily' as hot_source,
          paper_date,
          paper_id,
          title,
          hf_url,
          arxiv_url,
          summary,
          authors,
          rank,
          '' as score_text,
          topic_tags,
          first_seen_at,
          last_seen_at,
          fetched_at
        from hf_daily_papers
        where paper_date = '${latestDaily.replace(/'/g, "''")}'
        order by rank asc
        limit 80
      `)
    : [];
  const trendingRows = sqliteJson(`
    select
      'trending' as hot_source,
      '' as paper_date,
      paper_id,
      title,
      hf_url,
      arxiv_url,
      summary,
      authors,
      rank,
      score_text,
      topic_tags,
      first_seen_at,
      last_seen_at,
      fetched_at
    from hf_trending_papers
    order by rank asc
    limit 80
  `);

  const byPaper = new Map();
  for (const row of [...trendingRows, ...dailyRows]) {
    const existing = byPaper.get(row.paper_id);
    if (!existing || row.hot_source === 'daily') {
      byPaper.set(row.paper_id, {
        ...existing,
        ...row,
        trendingRank: existing?.rank || (row.hot_source === 'trending' ? row.rank : null),
        dailyRank: row.hot_source === 'daily' ? row.rank : existing?.dailyRank || null,
      });
    }
  }

  return Array.from(byPaper.values())
    .sort((a, b) => {
      const left = Number(a.dailyRank || a.trendingRank || a.rank || 9999);
      const right = Number(b.dailyRank || b.trendingRank || b.rank || 9999);
      return left - right;
    })
    .slice(0, 80)
    .map((paper) => {
      const tags = parseTags(paper.topic_tags);
      const sourceUrl = paper.hf_url || paper.arxiv_url;
      const rank = Number(paper.dailyRank || paper.trendingRank || paper.rank || 0);
      return {
        type: 'PAPER',
        title: paper.title,
        abstract: paper.summary || `${paper.title} · HuggingFace/arXiv hot paper`,
        content: [
          `# ${paper.title}`,
          '',
          paper.summary || '',
          '',
          `- HuggingFace: ${paper.hf_url || 'N/A'}`,
          `- arXiv: ${paper.arxiv_url || 'N/A'}`,
          `- 当前排名: ${rank || 'N/A'}`,
          `- 标签: ${tags.join(', ') || 'N/A'}`,
        ].join('\n'),
        source_url: sourceUrl,
        thumbnail_url: null,
        published_at: paper.fetched_at ? new Date(paper.fetched_at) : new Date(),
        primary_category: '论文',
        categories: ['论文', '热门论文', 'HuggingFace', 'arXiv'],
        tags: ['Hot Paper', 'HuggingFace', 'arXiv', ...tags],
        quality_score: Math.max(70, 96 - rank),
        trending_score: Math.max(1, 1000 - rank),
        view_count: 0,
        comment_count: 0,
        metadata: {
          importedAs: 'hf-hot-paper',
          source: 'solar-harness:hf-hot-paper',
          sourceName: 'HF/arXiv 热门论文',
          paperId: paper.paper_id,
          hfUrl: paper.hf_url || null,
          arxivUrl: paper.arxiv_url || null,
          dailyDate: paper.paper_date || latestDaily || null,
          dailyRank: paper.dailyRank || null,
          trendingRank: paper.trendingRank || null,
          scoreText: paper.score_text || null,
          topicTags: tags,
          firstSeenAt: paper.first_seen_at || null,
          lastSeenAt: paper.last_seen_at || null,
          fetchedAt: paper.fetched_at || null,
          hotScope: 'ai-compute-chip-software',
        },
        normalized_url: sourceUrl,
        source_type: 'solar-harness:hf-hot-paper',
        external_id: `solar-harness:hf-hot-paper:${paper.paper_id}`,
      };
    });
}

async function upsertResource(client, item) {
  const existing = await client.query(
    `select id from resources
     where external_id = $1
       and (
         source_type = any($2::text[])
         or metadata->>'source' = any($2::text[])
       )
     limit 1`,
    [item.external_id, SOLAR_LIBRARY_SOURCES]
  );
  const values = [
    item.type,
    item.title,
    item.abstract,
    item.content,
    item.source_url,
    item.thumbnail_url,
    item.published_at,
    item.primary_category,
    JSON.stringify(item.categories),
    JSON.stringify(item.tags),
    JSON.stringify(item.auto_tags || ['solar-harness', 'ai-influence']),
    item.quality_score,
    item.trending_score,
    JSON.stringify(item.metadata),
    item.normalized_url,
    item.source_type,
    item.external_id,
    item.view_count || 0,
    item.comment_count || 0,
  ];

  if (existing.rowCount) {
    await client.query(
      `update resources set
        type = $2,
        title = $3,
        abstract = $4,
        content = $5,
        source_url = $6,
        thumbnail_url = $7,
        published_at = $8,
        primary_category = $9,
        categories = $10::jsonb,
        tags = $11::jsonb,
        auto_tags = $12::jsonb,
        quality_score = $13,
        trending_score = $14,
        metadata = $15::jsonb,
        normalized_url = $16,
        source_type = $17,
        external_id = $18,
        view_count = $19,
        comment_count = $20,
        link_health = 'UNKNOWN',
        updated_at = now()
       where id = $1`,
      [existing.rows[0].id, ...values]
    );
    return 'updated';
  }

  await client.query(
    `insert into resources (
      id, type, title, abstract, content, source_url, thumbnail_url,
      published_at, primary_category, categories, tags, auto_tags,
      quality_score, trending_score, metadata, normalized_url,
      source_type, external_id, view_count, comment_count,
      link_health, created_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11::jsonb, $12::jsonb,
      $13, $14, $15::jsonb, $16, $17, $18, $19, $20, 'UNKNOWN', now(), now()
    )`,
    [crypto.randomUUID(), ...values]
  );
  return 'inserted';
}

async function main() {
  const env = readDotEnv(path.join(ROOT_DIR, '.env'));
  const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing');

  const paperTrendData = writePaperTrendData();
  const githubTrendData = writeGithubTrendData();
  const insightReports = buildInsightReports();
  const hotPapers = buildHotPapers();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {
    insightReports: { inserted: 0, updated: 0 },
    hotPapers: { inserted: 0, updated: 0 },
    aiInfluenceDigests: { inserted: 0, updated: 0 },
    aiInfluenceFieldReports: { inserted: 0, updated: 0 },
    aiInfluenceGithubReports: { inserted: 0, updated: 0 },
  };

  for (const row of insightReports) {
    summary.insightReports[await upsertResource(client, row)] += 1;
  }
  for (const row of hotPapers) {
    summary.hotPapers[await upsertResource(client, row)] += 1;
  }
  const aiInfluenceDigests = buildAiInfluenceDigests();
  const aiInfluenceFieldReports = buildAiInfluenceFieldReports();
  const aiInfluenceGithubReports = buildAiInfluenceGithubReports();
  for (const row of aiInfluenceDigests) {
    summary.aiInfluenceDigests[await upsertResource(client, row)] += 1;
  }
  for (const row of aiInfluenceFieldReports) {
    summary.aiInfluenceFieldReports[await upsertResource(client, row)] += 1;
  }
  for (const row of aiInfluenceGithubReports) {
    summary.aiInfluenceGithubReports[await upsertResource(client, row)] += 1;
  }

  const visible = await client.query(`
    select metadata->>'importedAs' as imported_as, count(*)::int as count
    from resources
    where metadata->>'source' = any($1::text[])
    group by metadata->>'importedAs'
    order by imported_as
  `, [SOLAR_LIBRARY_SOURCES]);
  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        visible: visible.rows,
        reportPublicDir: HF_REPORT_PUBLIC_DIR,
        trendsPublicPath: HF_TRENDS_PUBLIC_PATH,
        githubTrendsPublicPath: GITHUB_TRENDS_PUBLIC_PATH,
        aiInfluencePublicDir: AI_INFLUENCE_PUBLIC_DIR,
        trends: {
          latestDailyDate: paperTrendData.latestDailyDate,
          topics: paperTrendData.topics?.length || 0,
          quarterRows: paperTrendData.source?.rows || 0,
          githubLatestObservedAt: githubTrendData.latestObservedAt,
          githubThemes: githubTrendData.themes?.length || 0,
          githubRepos: githubTrendData.source?.rows || 0,
        },
      },
      null,
      2
    )
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
