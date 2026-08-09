#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const genesisRequire = createRequire(path.join(ROOT_DIR, 'package.json'));
const yaml = genesisRequire('yaml');
const { Client } = genesisRequire('pg');

const SOLAR_YOUTUBE_CONFIG =
  process.env.SOLAR_YOUTUBE_CONFIG ||
  '/Users/lisihao/Solar/harness/config/youtube-influence-digest.yaml';
const SOLAR_SQLITE =
  process.env.SOLAR_TECH_HOTSPOT_DB ||
  '/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite';
const REPORT_ROOTS = [
  '/Users/lisihao/Knowledge/_raw/tech-hotspot-radar/ai-influence-planned',
];
const REPORT_JSON = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-youtube-insights.json'
);
const TRANSCRIPT_PUBLIC_DIR = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-youtube-transcripts'
);

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

function walkFiles(dir, predicate, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(full, predicate, out);
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function mdTitle(content, fallback) {
  const frontMatterTitle = content.match(/^title:\s*(.+)$/m);
  if (frontMatterTitle?.[1]) return frontMatterTitle[1].trim();
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();
  return fallback;
}

function reportDateFromPath(file, content) {
  const createdAt = content.match(/^created_at:\s*(.+)$/m);
  if (createdAt?.[1]) return createdAt[1].trim();
  const date = file.match(/(20\d{2}-\d{2}-\d{2})/);
  if (date?.[1]) return date[1];
  const stamp = file.match(/(20\d{6}T\d{6}Z?)/);
  if (stamp?.[1]) return stamp[1];
  return fs.statSync(file).mtime.toISOString();
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function readJsonIfExists(file) {
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

function aiInfluenceSummaryFromJson(json) {
  if (!json || typeof json !== 'object') return '';
  const trend = json.trend_analysis || {};
  const summary = typeof trend.summary === 'string' ? trend.summary.trim() : '';
  const coreTrends = Array.isArray(trend.core_trends)
    ? trend.core_trends
    : [];
  const trendLines = coreTrends
    .slice(0, 3)
    .map((item, index) => {
      const theme = item?.theme ? String(item.theme).trim() : '';
      const thesis = item?.thesis ? String(item.thesis).trim() : '';
      return theme || thesis
        ? `${index + 1}. ${theme}${thesis ? `：${thesis}` : ''}`
        : '';
    })
    .filter(Boolean);
  return [summary, ...trendLines].filter(Boolean).join('\n');
}

function markdownFromAiInfluenceReport(reportDir, mdPath, htmlPath, jsonPath) {
  const json = readJsonIfExists(jsonPath);
  if (fs.existsSync(mdPath)) {
    return fs.readFileSync(mdPath, 'utf8');
  }
  if (json) {
    const date = json.date || path.basename(reportDir);
    const summary = aiInfluenceSummaryFromJson(json);
    return [
      `# AI Influence Digest — ${date}`,
      '',
      summary,
    ]
      .filter(Boolean)
      .join('\n');
  }
  if (fs.existsSync(htmlPath)) {
    return stripHtml(fs.readFileSync(htmlPath, 'utf8'));
  }
  return '';
}

function uniquePreserve(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const clean = String(value || '').trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function normalizeSolarTranscriptText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\/\/n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function transcriptFileName(videoId) {
  return `${String(videoId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '_')}.json`;
}

function buildTranscriptSegments(text) {
  const lines = normalizeSolarTranscriptText(text)
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const chunks = [];
  let current = '';

  for (const line of lines) {
    if (current && `${current} ${line}`.length > 260) {
      chunks.push(current);
      current = line;
      continue;
    }
    current = current ? `${current} ${line}` : line;
  }

  if (current) chunks.push(current);

  return chunks.map((text, index) => ({
    text,
    start: index * 6,
    duration: 6,
  }));
}

function writeTranscriptArtifact(video) {
  const transcriptText = normalizeSolarTranscriptText(video.transcript_clean);
  if (!transcriptText) return null;

  fs.mkdirSync(TRANSCRIPT_PUBLIC_DIR, { recursive: true });
  const fileName = transcriptFileName(video.video_id);
  const artifact = {
    videoId: video.video_id,
    title: video.title,
    channelName: video.channel_name,
    source: 'solar-harness:youtube-transcript',
    transcriptStatus: video.transcript_status,
    transcriptChars: Number(video.transcript_chars || transcriptText.length),
    transcriptSource: video.transcript_source || null,
    transcriptLanguage: video.transcript_language || null,
    transcriptQualityTier: video.transcript_quality_tier || null,
    transcriptText,
    segments: buildTranscriptSegments(transcriptText),
  };

  fs.writeFileSync(
    path.join(TRANSCRIPT_PUBLIC_DIR, fileName),
    `${JSON.stringify(artifact, null, 2)}\n`
  );
  return `/local-data/solar-youtube-transcripts/${fileName}`;
}

function plannedReportDate(reportDir) {
  const parts = reportDir.split(path.sep);
  const idx = parts.lastIndexOf('ai-influence-planned');
  if (idx >= 0 && parts[idx + 1]) return parts[idx + 1];
  return fs.statSync(reportDir).mtime.toISOString().slice(0, 10);
}

function reportExcerptFromMarkdown(content, fallback = '') {
  const withoutTitle = content
    .replace(/^#\s+.+$/m, '')
    .replace(/^##\s+关键视频证据[\s\S]*?(?=^##\s+)/m, '')
    .replace(/^---[\s\S]*?---\s*/, '')
    .trim();
  const summaryMatch = withoutTitle.match(/^##\s+摘要\s*([\s\S]*?)(?=^##\s+)/m);
  const trendMatch = withoutTitle.match(/^##\s+趋势分析[^\n]*\s*([\s\S]*?)(?=^##\s+)/m);
  const source = (summaryMatch?.[1] || trendMatch?.[1] || fallback || withoutTitle)
    .replace(/\n{2,}/g, '\n')
    .trim();
  return source.slice(0, 900);
}

function buildReports() {
  const reportDirs = REPORT_ROOTS.flatMap((root) => {
    if (!fs.existsSync(root)) return [];
    const dirs = [];
    for (const dateEntry of fs.readdirSync(root, { withFileTypes: true })) {
      if (!dateEntry.isDirectory() || !/^20\d{2}-\d{2}-\d{2}$/.test(dateEntry.name)) {
        continue;
      }
      const reportsDir = path.join(root, dateEntry.name, 'reports');
      if (!fs.existsSync(reportsDir)) continue;
      for (const reportEntry of fs.readdirSync(reportsDir, { withFileTypes: true })) {
        if (!reportEntry.isDirectory()) continue;
        const reportDir = path.join(reportsDir, reportEntry.name);
        if (fs.existsSync(path.join(reportDir, 'report.html'))) {
          dirs.push(reportDir);
        }
      }
    }
    return dirs;
  });

  const reports = reportDirs
    .map((reportDir) => {
      const date = plannedReportDate(reportDir);
      const htmlPath = path.join(reportDir, 'report.html');
      const mdPath = path.join(reportDir, 'report.md');
      const resultJsonPath = path.join(reportDir, 'report-result.json');
      const evidencePath = path.join(reportDir, 'evidence-pack.json');
      const mailPath = path.join(reportDir, 'mail-result.json');
      if (!fs.existsSync(htmlPath) || !fs.existsSync(mdPath)) {
        return null;
      }

      const content = fs.readFileSync(mdPath, 'utf8');
      const resultJson = readJsonIfExists(resultJsonPath);
      const evidence = readJsonIfExists(evidencePath);
      const mail = readJsonIfExists(mailPath);
      const videos = Array.isArray(evidence?.videos) ? evidence.videos : [];
      const channels = uniquePreserve(videos.map((video) => video?.channel));
      const tags = uniquePreserve(
        videos.flatMap((video) => Array.isArray(video?.topic_tags) ? video.topic_tags : [])
      );
      const title =
        String(resultJson?.headline || '').trim() ||
        mdTitle(content, path.basename(reportDir));
      const subtitle = String(resultJson?.subheadline || '').trim();
      const model = String(
        resultJson?._model || resultJson?.model || 'N/A'
      );
      const reasoningEffort = String(
        resultJson?._reasoning_effort || resultJson?.reasoning_effort || 'N/A'
      );
      return {
        id: crypto.createHash('sha1').update(reportDir).digest('hex').slice(0, 16),
        title,
        generatedAt: date,
        source: 'ai-influence-planned-report',
        module: 'AI Influence 大咖访谈及大展洞察报告',
        subtitle,
        path: htmlPath,
        empty: false,
        excerpt: reportExcerptFromMarkdown(content, subtitle),
        content: content.slice(0, 40000),
        metrics: {
          model,
          reasoningEffort,
          materialVideos: videos.length,
          channels,
          tags,
          mailStatus: mail?.status || 'unsent',
          backend: resultJson?._backend || resultJson?.backend || null,
          operatorLine: resultJson?._operator_line || resultJson?.operator_line || null,
        },
      };
    })
    .filter(Boolean)
    .sort((a, b) => String(b.generatedAt).localeCompare(String(a.generatedAt)))
    .slice(0, 40);

  fs.mkdirSync(path.dirname(REPORT_JSON), { recursive: true });
  fs.writeFileSync(
    REPORT_JSON,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        sourceRoots: REPORT_ROOTS,
        reports,
      },
      null,
      2
    )
  );
  return reports.length;
}

function buildChannelRows(channels) {
  const channelIds = channels
    .map((c) => c.channel_id || c.channelId)
    .filter(Boolean)
    .map((id) => `'${String(id).replace(/'/g, "''")}'`)
    .join(',');
  const statsById = new Map();
  if (channelIds) {
    const stats = sqliteJson(`
      select
        channel_id,
        count(*) as total_videos,
        sum(case when duration_seconds >= 600 and video_url not like '%/shorts/%' then 1 else 0 end) as long_videos,
        max(published_at) as latest_published_at,
        (
          select thumbnail_url from youtube_videos v2
          where v2.channel_id = youtube_videos.channel_id
            and v2.duration_seconds >= 600
            and v2.video_url not like '%/shorts/%'
            and coalesce(v2.thumbnail_url, '') <> ''
          order by published_at desc
          limit 1
        ) as cover_url
      from youtube_videos
      where channel_id in (${channelIds})
      group by channel_id
    `);
    for (const row of stats) statsById.set(row.channel_id, row);
  }

  return channels.map((channel, index) => {
    const channelId = channel.channel_id || channel.channelId || '';
    const stats = statsById.get(channelId) || {};
    const title = channel.name || channel.url || `YouTube Channel ${index + 1}`;
    const rssUrl = channelId
      ? `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`
      : null;
    return {
      type: 'YOUTUBE_VIDEO',
      title,
      abstract: [
        `Solar YouTube subscription channel: ${title}`,
        `${Number(stats.long_videos || 0)} videos over 10 minutes synced.`,
        channel.category ? `Category: ${channel.category}` : null,
        rssUrl ? `RSS: ${rssUrl}` : null,
      ]
        .filter(Boolean)
        .join('\n'),
      content: '',
      source_url: channel.url,
      thumbnail_url: stats.cover_url || null,
      published_at: new Date(),
      primary_category: 'YouTube',
      categories: ['YouTube', channel.category || 'AI / Tech'],
      tags: ['YouTube', 'Solar', 'Channel', channel.priority || 'rotation'],
      quality_score: channel.priority === 'tier1' ? 95 : 80,
      trending_score: Number(stats.long_videos || 0),
      metadata: {
        importedAs: 'youtube-channel-subscription',
        source: 'solar-harness:youtube',
        channelId,
        channelName: title,
        channelUrl: channel.url,
        rssUrl,
        category: channel.category || null,
        priority: channel.priority || null,
        totalVideos: Number(stats.total_videos || 0),
        longVideos: Number(stats.long_videos || 0),
        latestPublishedAt: stats.latest_published_at || null,
        imageUrl: stats.cover_url || null,
      },
      normalized_url: channel.url,
      source_type: 'solar-harness:youtube-channel',
      external_id: channelId || channel.url,
    };
  });
}

function buildVideoRows() {
  return sqliteJson(`
    select
      v.video_id,
      v.channel_id,
      v.channel_name,
      v.video_url,
      v.title,
      v.description,
      v.published_at,
      v.duration_seconds,
      v.thumbnail_url,
      v.view_count,
      v.like_count,
      v.comment_count,
      v.tags,
      coalesce(t.transcript_status, 'missing') as transcript_status,
      coalesce(t.char_count, 0) as transcript_chars,
      coalesce(t.transcript_clean, '') as transcript_clean,
      coalesce(t.source, '') as transcript_source,
      coalesce(t.language, '') as transcript_language,
      coalesce(t.quality_tier, '') as transcript_quality_tier
    from youtube_videos v
    left join youtube_transcripts t on t.video_id = v.video_id
    where v.duration_seconds >= 600
      and v.video_url not like '%/shorts/%'
    order by v.published_at desc
  `).map((video) => {
    const solarTranscriptUrl = writeTranscriptArtifact(video);
    return {
      type: 'YOUTUBE_VIDEO',
      title: video.title,
      abstract:
        video.description ||
        `${video.channel_name} video over 10 minutes synced from Solar harness.`,
      content: video.description || '',
      source_url: video.video_url,
      thumbnail_url: video.thumbnail_url || null,
      published_at: video.published_at ? new Date(video.published_at) : null,
      primary_category: 'YouTube',
      categories: ['YouTube', 'AI / Tech'],
      tags: ['YouTube', 'Solar', 'Video'],
      quality_score: video.transcript_status === 'fetched' ? 92 : 76,
      trending_score: video.view_count || 0,
      view_count: video.view_count || 0,
      comment_count: video.comment_count || 0,
      metadata: {
        importedAs: 'youtube-video',
        source: 'solar-harness:youtube',
        videoId: video.video_id,
        channelId: video.channel_id,
        channelName: video.channel_name,
        durationSeconds: video.duration_seconds,
        thumbnailUrl: video.thumbnail_url || null,
        transcriptStatus: video.transcript_status,
        transcriptChars: video.transcript_chars,
        transcriptSource: video.transcript_source || null,
        transcriptLanguage: video.transcript_language || null,
        transcriptQualityTier: video.transcript_quality_tier || null,
        solarTranscriptUrl,
        imageUrl: video.thumbnail_url || null,
      },
      normalized_url: video.video_url,
      source_type: 'solar-harness:youtube-video',
      external_id: video.video_id,
    };
  });
}

function normalizePgTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

async function upsertResource(client, item) {
  const existing = await client.query(
    `select id from resources
     where external_id = $1
       and (
         source_type in ('solar-harness:youtube-channel', 'solar-harness:youtube-video', 'solar-harness:youtube-influence-digest')
         or metadata->>'source' like 'solar-harness:youtube%'
         or metadata->>'source' = 'solar-harness:youtube-influence-digest'
       )
     limit 1`,
    [item.external_id]
  );
  const values = [
    item.type,
    item.title,
    item.abstract,
    item.content,
    item.source_url,
    item.thumbnail_url,
    normalizePgTimestamp(item.published_at),
    item.primary_category,
    JSON.stringify(item.categories),
    JSON.stringify(item.tags),
    JSON.stringify(['youtube', 'solar-harness']),
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

  const config = yaml.parse(fs.readFileSync(SOLAR_YOUTUBE_CONFIG, 'utf8'));
  const channels = Array.isArray(config.channels) ? config.channels : [];
  const channelRows = buildChannelRows(channels);
  const videoRows = buildVideoRows();
  const reportCount = buildReports();

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {
    channels: { inserted: 0, updated: 0 },
    videos: { inserted: 0, updated: 0 },
    reports: reportCount,
  };

  for (const row of channelRows) {
    summary.channels[await upsertResource(client, row)] += 1;
  }
  for (const row of videoRows) {
    summary.videos[await upsertResource(client, row)] += 1;
  }

  const counts = await client.query(`
    select metadata->>'importedAs' as imported_as, count(*)::int as count
    from resources
    where type = 'YOUTUBE_VIDEO'
      and metadata->>'source' = 'solar-harness:youtube'
    group by metadata->>'importedAs'
    order by imported_as
  `);
  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        visible: counts.rows,
        reportJson: REPORT_JSON,
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
