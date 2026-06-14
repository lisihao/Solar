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
const HF_REPORT_PUBLIC_DIR = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-hf-paper-insights/html'
);
const HF_TRENDS_PUBLIC_PATH = path.join(
  ROOT_DIR,
  'frontend/public/local-data/solar-hf-paper-trends.json'
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

function compactPaper(row, extra = {}) {
  const tags = parseTags(row.topic_tags);
  return {
    paperId: row.paper_id,
    title: row.title,
    date: dateOnly(row.paper_date || row.fetched_at),
    rank: Number(row.rank || 0),
    topic: topicBucket(row),
    tags,
    hfUrl: row.hf_url || null,
    arxivUrl: row.arxiv_url || null,
    source: row.source || 'hf',
    summary: row.summary || '',
    ...extra,
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
         source_type in ('solar-harness:hf-paper-insight', 'solar-harness:hf-hot-paper')
         or metadata->>'source' in ('solar-harness:hf-paper-insight', 'solar-harness:hf-hot-paper')
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
    item.published_at,
    item.primary_category,
    JSON.stringify(item.categories),
    JSON.stringify(item.tags),
    JSON.stringify(['paper', 'huggingface', 'arxiv', 'ai-influence']),
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
  const insightReports = buildInsightReports();
  const hotPapers = buildHotPapers();
  const client = new Client({ connectionString: databaseUrl });
  await client.connect();

  const summary = {
    insightReports: { inserted: 0, updated: 0 },
    hotPapers: { inserted: 0, updated: 0 },
  };

  for (const row of insightReports) {
    summary.insightReports[await upsertResource(client, row)] += 1;
  }
  for (const row of hotPapers) {
    summary.hotPapers[await upsertResource(client, row)] += 1;
  }

  const visible = await client.query(`
    select metadata->>'importedAs' as imported_as, count(*)::int as count
    from resources
    where type = 'PAPER'
      and metadata->>'source' in ('solar-harness:hf-paper-insight', 'solar-harness:hf-hot-paper')
    group by metadata->>'importedAs'
    order by imported_as
  `);
  await client.end();

  console.log(
    JSON.stringify(
      {
        ok: true,
        summary,
        visible: visible.rows,
        reportPublicDir: HF_REPORT_PUBLIC_DIR,
        trendsPublicPath: HF_TRENDS_PUBLIC_PATH,
        trends: {
          latestDailyDate: paperTrendData.latestDailyDate,
          topics: paperTrendData.topics?.length || 0,
          quarterRows: paperTrendData.source?.rows || 0,
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
