#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '../..');
const genesisRequire = createRequire(path.join(ROOT_DIR, 'package.json'));
const { Client } = genesisRequire('pg');

const KNOWLEDGE_ROOT =
  process.env.SOLAR_KNOWLEDGE_ROOT || '/Users/lisihao/Knowledge';
const SOLAR_TECH_DB =
  process.env.SOLAR_TECH_HOTSPOT_DB ||
  '/Users/lisihao/.solar/harness/state/tech-hotspot-radar/tech-hotspot-radar.sqlite';

const DEFAULT_LIMITS = {
  hfPapers: 200,
  arxivPapers: 200,
  youtubeVideos: 80,
  reportFiles: 120,
  maxDocumentChars: 160000,
};

const SOLAR_KB_DEFINITION = {
  name: 'Solar 知识库',
  description:
    '统一的 Solar-harness 知识库，整合 Core、论文趋势、YouTube 字幕、AI Influence/GitHub 报告和硅谷前沿库资料。',
  sourceTypes: [
    'SOLAR_HARNESS',
    'SOLAR_CORE',
    'OBSIDIAN_MARKDOWN',
    'SOLAR_HF_PAPERS',
    'SOLAR_ARXIV_PAPERS',
    'SOLAR_YOUTUBE_TRANSCRIPT',
    'SOLAR_AI_INFLUENCE_REPORTS',
    'SOLAR_LIBRARY',
  ],
};

const KB_DEFINITIONS = {
  core: {
    name: 'Solar Core',
    description:
      'Solar-harness curated synthesis, concepts, and entity notes from the local Solar knowledge base.',
    sourceTypes: ['SOLAR_HARNESS', 'SOLAR_CORE', 'OBSIDIAN_MARKDOWN'],
  },
  papers: {
    name: 'Solar Papers',
    description:
      'Solar-harness HuggingFace/arXiv paper trends, paper insight reports, and selected paper summaries.',
    sourceTypes: ['SOLAR_HARNESS', 'SOLAR_HF_PAPERS', 'SOLAR_ARXIV_PAPERS'],
  },
  youtube: {
    name: 'Solar YouTube',
    description:
      'Solar-harness YouTube videos over 10 minutes with locally collected transcripts and metadata.',
    sourceTypes: ['SOLAR_HARNESS', 'SOLAR_YOUTUBE_TRANSCRIPT'],
  },
  reports: {
    name: 'Solar Influence Reports',
    description:
      'Solar-harness AI Influence daily digests, GitHub reports, big-name viewpoints, and event insight reports.',
    sourceTypes: ['SOLAR_HARNESS', 'SOLAR_AI_INFLUENCE_REPORTS'],
  },
};

function parseArgs(argv) {
  const args = {
    apply: false,
    dryRun: true,
    userId: process.env.GENESIS_USER_ID || '',
    userEmail: process.env.GENESIS_USER_EMAIL || '',
    only: new Set(),
    limits: { ...DEFAULT_LIMITS },
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--apply') {
      args.apply = true;
      args.dryRun = false;
    } else if (arg === '--dry-run') {
      args.dryRun = true;
      args.apply = false;
    } else if (arg === '--user-id') {
      args.userId = argv[++i] || '';
    } else if (arg === '--user-email') {
      args.userEmail = argv[++i] || '';
    } else if (arg === '--only') {
      for (const part of String(argv[++i] || '').split(',')) {
        const clean = part.trim();
        if (clean) args.only.add(clean);
      }
    } else if (arg.startsWith('--hf-limit=')) {
      args.limits.hfPapers = Number(arg.split('=')[1] || args.limits.hfPapers);
    } else if (arg.startsWith('--arxiv-limit=')) {
      args.limits.arxivPapers = Number(arg.split('=')[1] || args.limits.arxivPapers);
    } else if (arg.startsWith('--youtube-limit=')) {
      args.limits.youtubeVideos = Number(arg.split('=')[1] || args.limits.youtubeVideos);
    } else if (arg.startsWith('--report-limit=')) {
      args.limits.reportFiles = Number(arg.split('=')[1] || args.limits.reportFiles);
    } else if (arg.startsWith('--max-doc-chars=')) {
      args.limits.maxDocumentChars = Number(arg.split('=')[1] || args.limits.maxDocumentChars);
    } else if (arg === '--help') {
      printHelp();
      process.exit(0);
    }
  }

  return args;
}

function printHelp() {
  console.log(`Usage: node scripts/local/sync-solar-knowledge-kb.js [--dry-run|--apply]

Options:
  --only core,papers,youtube,reports
  --user-id <id>              GenesisPod user id owner
  --user-email <email>        GenesisPod user email owner
  --hf-limit=<n>              Default ${DEFAULT_LIMITS.hfPapers}
  --arxiv-limit=<n>           Default ${DEFAULT_LIMITS.arxivPapers}
  --youtube-limit=<n>         Default ${DEFAULT_LIMITS.youtubeVideos}
  --report-limit=<n>          Default ${DEFAULT_LIMITS.reportFiles}
  --max-doc-chars=<n>         Default ${DEFAULT_LIMITS.maxDocumentChars}

All selected Solar source groups sync into one GenesisPod KB: "${SOLAR_KB_DEFINITION.name}".
`);
}

function readDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
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
  const dbUri = `file:${path.resolve(SOLAR_TECH_DB).replace(/#/g, '%23').replace(/\?/g, '%3F')}?mode=ro&immutable=1`;
  const output = execFileSync('sqlite3', ['-readonly', '-json', dbUri, sql], {
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  }).trim();
  return output ? JSON.parse(output) : [];
}

function sqliteTableExists(tableName) {
  const rows = sqliteJson(
    `select name from sqlite_master where type='table' and name='${escapeSql(tableName)}'`
  );
  return Boolean(rows[0]);
}

function escapeSql(value) {
  return String(value || '').replace(/'/g, "''");
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

function dateDirs(root) {
  if (!fs.existsSync(root)) return [];
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && /^20\d{2}-\d{2}-\d{2}$/.test(entry.name))
    .map((entry) => path.join(root, entry.name))
    .sort();
}

function readText(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
}

function normalizeText(value) {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\/\/n/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')
    .trim();
}

function truncateContent(content, maxChars) {
  const clean = normalizeText(content);
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}\n\n[Truncated by sync-solar-knowledge-kb at ${maxChars} chars]`;
}

function frontMatterValue(content, key) {
  const match = content.match(new RegExp(`^${key}:\\s*(.+)$`, 'm'));
  return match?.[1]?.trim().replace(/^['"]|['"]$/g, '') || '';
}

function mdTitle(content, fallback) {
  const title = frontMatterValue(content, 'title');
  if (title) return title;
  const h1 = content.match(/^#\s+(.+)$/m);
  if (h1?.[1]) return h1[1].trim();
  return fallback;
}

function slugFromPath(file) {
  return path
    .relative(KNOWLEDGE_ROOT, file)
    .replace(/\\/g, '/')
    .replace(/\.[^.]+$/, '');
}

function stableHash(value, len = 20) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, len);
}

function contentHash(content) {
  return crypto.createHash('sha256').update(content).digest('hex');
}

function sourceUrlForFile(file) {
  return `solar://knowledge/${slugFromPath(file)}`;
}

function splitTags(value) {
  return String(value || '')
    .replace(/^\[|\]$/g, '')
    .split(/[, ]+/)
    .map((item) => item.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);
}

function parseTagsFromMarkdown(content) {
  return splitTags(frontMatterValue(content, 'tags'));
}

function sectionsFromMarkdown(content, limit = 30) {
  return content
    .split('\n')
    .map((line, index) => {
      const match = line.match(/^(#{1,4})\s+(.+)$/);
      if (!match) return null;
      return {
        title: match[2].trim(),
        level: match[1].length,
        line: index + 1,
      };
    })
    .filter(Boolean)
    .slice(0, limit);
}

function markdownDoc({ kbKey, file, sourceType, sourceIdPrefix, maxChars }) {
  const original = readText(file);
  const rawContent = truncateContent(original, maxChars);
  const sourceId = `${sourceIdPrefix}:${stableHash(path.resolve(file))}`;
  return {
    kbKey,
    title: mdTitle(original, path.basename(file, path.extname(file))),
    sourceType,
    sourceId,
    sourceUrl: sourceUrlForFile(file),
    mimeType: 'text/markdown',
    rawContent,
    metadata: {
      solar: {
        source: sourceType,
        sourcePath: file,
        relativePath: path.relative(KNOWLEDGE_ROOT, file),
        contentHash: contentHash(rawContent),
        tags: parseTagsFromMarkdown(original),
      },
      preparse: {
        status: 'ready',
        source: 'solar-harness',
        structuredContent: {
          sections: sectionsFromMarkdown(original),
        },
      },
    },
  };
}

function buildCoreDocs(limits) {
  const dirs = ['synthesis', 'concepts', 'entities'].map((dir) =>
    path.join(KNOWLEDGE_ROOT, dir)
  );
  return dirs.flatMap((dir) =>
    walkFiles(dir, (file) => file.endsWith('.md')).map((file) =>
      markdownDoc({
        kbKey: 'core',
        file,
        sourceType: `solar-harness:${path.basename(dir)}`,
        sourceIdPrefix: `solar:${path.basename(dir)}`,
        maxChars: limits.maxDocumentChars,
      })
    )
  );
}

function buildPaperReportDocs(limits) {
  const docs = [];
  const qmdRoot = path.join(KNOWLEDGE_ROOT, 'qmd', 'hf-paper-insight');
  for (const file of walkFiles(qmdRoot, (item) => item.endsWith('.md'))) {
    docs.push(
      markdownDoc({
        kbKey: 'papers',
        file,
        sourceType: 'solar-harness:qmd-hf-paper-insight',
        sourceIdPrefix: 'solar:qmd:hf-paper-insight',
        maxChars: limits.maxDocumentChars,
      })
    );
  }

  const radarRoot = path.join(KNOWLEDGE_ROOT, '_raw', 'tech-hotspot-radar');
  const reportFiles = walkFiles(
    radarRoot,
    (file) =>
      file.endsWith('.md') &&
      /\/hf-paper-(report|insight-assets)\//.test(file.replace(/\\/g, '/')) === false &&
      /hf-paper-report\.md$/.test(file)
  )
    .sort()
    .reverse()
    .slice(0, limits.reportFiles);

  for (const file of reportFiles) {
    docs.push(
      markdownDoc({
        kbKey: 'papers',
        file,
        sourceType: 'solar-harness:hf-paper-report',
        sourceIdPrefix: 'solar:hf-paper-report',
        maxChars: limits.maxDocumentChars,
      })
    );
  }

  const assetReports = walkFiles(
    radarRoot,
    (file) =>
      file.endsWith('.md') &&
      /\/hf-paper-insight-assets\//.test(file.replace(/\\/g, '/')) &&
      /\/(report|cards|deep_research|topics|experiments|projects|seeds)\.md$/.test(
        file.replace(/\\/g, '/')
      )
  )
    .sort()
    .reverse()
    .slice(0, limits.reportFiles);

  for (const file of assetReports) {
    docs.push(
      markdownDoc({
        kbKey: 'papers',
        file,
        sourceType: 'solar-harness:hf-paper-insight-asset',
        sourceIdPrefix: 'solar:hf-paper-insight-asset',
        maxChars: limits.maxDocumentChars,
      })
    );
  }

  return docs;
}

function paperMarkdown(row, source) {
  const tags = splitTags(row.topic_tags);
  const urls = [
    row.hf_url ? `- HuggingFace: ${row.hf_url}` : '',
    row.arxiv_url ? `- arXiv: ${row.arxiv_url}` : '',
    row.pdf_url ? `- PDF: ${row.pdf_url}` : '',
  ].filter(Boolean);
  return [
    `# ${row.title}`,
    '',
    `- Source: ${source}`,
    `- Date: ${row.paper_date}`,
    `- Rank: ${row.rank}`,
    row.authors ? `- Authors: ${row.authors}` : '',
    row.categories ? `- arXiv categories: ${row.categories}` : '',
    tags.length ? `- Topic tags: ${tags.join(', ')}` : '',
    urls.length ? ['', '## Links', ...urls].join('\n') : '',
    '',
    '## Summary',
    normalizeText(row.summary || ''),
  ]
    .filter(Boolean)
    .join('\n');
}

function buildPaperDbDocs(limits) {
  if (!fs.existsSync(SOLAR_TECH_DB)) return [];
  const docs = [];
  if (sqliteTableExists('hf_daily_papers')) {
    const rows = sqliteJson(`
      select * from hf_daily_papers
      where paper_date >= date((select max(paper_date) from hf_daily_papers), '-30 days')
      order by paper_date desc, rank asc
      limit ${Number(limits.hfPapers) || 0}
    `);
    for (const row of rows) {
      const rawContent = truncateContent(paperMarkdown(row, 'HuggingFace Daily Papers'), limits.maxDocumentChars);
      docs.push({
        kbKey: 'papers',
        title: row.title,
        sourceType: 'solar-harness:hf-daily-paper',
        sourceId: `solar:hf:${row.paper_date}:${row.paper_id}`,
        sourceUrl: row.hf_url || row.arxiv_url || null,
        mimeType: 'text/markdown',
        rawContent,
        metadata: {
          solar: {
            source: 'solar-harness:hf-daily-paper',
            sourceTable: 'hf_daily_papers',
            paperDate: row.paper_date,
            paperId: row.paper_id,
            rank: Number(row.rank || 0),
            topicTags: splitTags(row.topic_tags),
            contentHash: contentHash(rawContent),
          },
          preparse: { status: 'ready', source: 'solar-harness' },
        },
      });
    }
  }

  if (sqliteTableExists('arxiv_daily_papers')) {
    const rows = sqliteJson(`
      select * from arxiv_daily_papers
      where paper_date >= date((select max(paper_date) from arxiv_daily_papers), '-30 days')
      order by paper_date desc, rank asc
      limit ${Number(limits.arxivPapers) || 0}
    `);
    for (const row of rows) {
      const rawContent = truncateContent(paperMarkdown(row, 'arXiv Daily Papers'), limits.maxDocumentChars);
      docs.push({
        kbKey: 'papers',
        title: row.title,
        sourceType: 'solar-harness:arxiv-daily-paper',
        sourceId: `solar:arxiv:${row.paper_date}:${row.arxiv_id}`,
        sourceUrl: row.arxiv_url || row.pdf_url || null,
        mimeType: 'text/markdown',
        rawContent,
        metadata: {
          solar: {
            source: 'solar-harness:arxiv-daily-paper',
            sourceTable: 'arxiv_daily_papers',
            paperDate: row.paper_date,
            arxivId: row.arxiv_id,
            rank: Number(row.rank || 0),
            categories: splitTags(row.categories),
            topicTags: splitTags(row.topic_tags),
            contentHash: contentHash(rawContent),
          },
          preparse: { status: 'ready', source: 'solar-harness' },
        },
      });
    }
  }
  return docs;
}

function buildPaperDocs(limits) {
  return [...buildPaperReportDocs(limits), ...buildPaperDbDocs(limits)];
}

function videoMarkdown(row) {
  const transcript = normalizeText(row.transcript_clean);
  return [
    `# ${row.title || row.video_id}`,
    '',
    `- Channel: ${row.channel_name}`,
    `- Published: ${row.published_at || 'N/A'}`,
    `- Duration seconds: ${row.duration_seconds || 0}`,
    `- Video: ${row.video_url}`,
    row.tags ? `- Tags: ${row.tags}` : '',
    '',
    '## Description',
    normalizeText(row.description || ''),
    '',
    '## Transcript',
    transcript,
  ]
    .filter(Boolean)
    .join('\n');
}

function buildYoutubeDocs(limits) {
  if (!fs.existsSync(SOLAR_TECH_DB)) return [];
  if (!sqliteTableExists('youtube_videos') || !sqliteTableExists('youtube_transcripts')) {
    return [];
  }
  const rows = sqliteJson(`
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
      t.transcript_clean,
      t.transcript_status,
      t.language,
      t.char_count,
      t.quality_tier
    from youtube_videos v
    join youtube_transcripts t on t.video_id = v.video_id
    where v.duration_seconds >= 600
      and length(t.transcript_clean) > 0
    order by v.published_at desc
    limit ${Number(limits.youtubeVideos) || 0}
  `);

  return rows.map((row) => {
    const rawContent = truncateContent(videoMarkdown(row), limits.maxDocumentChars);
    return {
      kbKey: 'youtube',
      title: row.title || row.video_id,
      sourceType: 'solar-harness:youtube-transcript',
      sourceId: `solar:youtube:${row.video_id}`,
      sourceUrl: row.video_url,
      mimeType: 'text/markdown',
      rawContent,
      metadata: {
        solar: {
          source: 'solar-harness:youtube-transcript',
          sourceTable: 'youtube_videos/youtube_transcripts',
          videoId: row.video_id,
          channelId: row.channel_id,
          channelName: row.channel_name,
          publishedAt: row.published_at,
          durationSeconds: Number(row.duration_seconds || 0),
          thumbnailUrl: row.thumbnail_url,
          transcriptStatus: row.transcript_status,
          transcriptLanguage: row.language,
          transcriptChars: Number(row.char_count || 0),
          transcriptQualityTier: row.quality_tier,
          contentHash: contentHash(rawContent),
        },
        preparse: {
          status: 'ready',
          source: 'solar-harness',
          mediaUrls: row.thumbnail_url ? [row.thumbnail_url] : [],
        },
      },
    };
  });
}

function reportFilesForInfluence(limits) {
  const files = [];
  const aiDigestRoot = path.join(KNOWLEDGE_ROOT, '_raw', 'ai-influence-daily-digest');
  for (const dir of dateDirs(aiDigestRoot)) {
    const file = path.join(dir, 'digest.md');
    if (fs.existsSync(file)) files.push(file);
  }

  const radarRoot = path.join(KNOWLEDGE_ROOT, '_raw', 'tech-hotspot-radar');
  const patterns = [
    /\/github-trend-report\.md$/,
    /\/social-big-name-report\.md$/,
    /\/three-source-radar-report\.md$/,
    /\/github-report\.md$/,
    /\/ai-influence-planned\/[^/]+\/reports\/[^/]+\/report\.md$/,
  ];
  for (const file of walkFiles(radarRoot, (item) => item.endsWith('.md'))) {
    const normalized = file.replace(/\\/g, '/');
    if (patterns.some((pattern) => pattern.test(normalized))) files.push(file);
  }

  return Array.from(new Set(files))
    .sort()
    .reverse()
    .slice(0, limits.reportFiles);
}

function buildReportDocs(limits) {
  return reportFilesForInfluence(limits).map((file) =>
    markdownDoc({
      kbKey: 'reports',
      file,
      sourceType: 'solar-harness:ai-influence-report',
      sourceIdPrefix: 'solar:ai-influence-report',
      maxChars: limits.maxDocumentChars,
    })
  );
}

function enabledKbKeys(args) {
  const all = Object.keys(KB_DEFINITIONS);
  if (!args.only.size) return all;
  return all.filter((key) => args.only.has(key));
}

function buildDocs(args) {
  const keys = new Set(enabledKbKeys(args));
  const docs = [];
  if (keys.has('core')) docs.push(...buildCoreDocs(args.limits));
  if (keys.has('papers')) docs.push(...buildPaperDocs(args.limits));
  if (keys.has('youtube')) docs.push(...buildYoutubeDocs(args.limits));
  if (keys.has('reports')) docs.push(...buildReportDocs(args.limits));
  return docs;
}

async function resolveUser(client, args) {
  if (args.userId) {
    const row = await client.query('select id, email from users where id = $1', [args.userId]);
    if (!row.rows[0]) throw new Error(`GenesisPod user id not found: ${args.userId}`);
    return row.rows[0];
  }
  if (args.userEmail) {
    const row = await client.query('select id, email from users where email = $1', [args.userEmail]);
    if (!row.rows[0]) throw new Error(`GenesisPod user email not found: ${args.userEmail}`);
    return row.rows[0];
  }
  const row = await client.query(`
    select id, email
    from users
    order by
      case when role = 'ADMIN' then 0 else 1 end,
      created_at asc
    limit 1
  `);
  if (!row.rows[0]) throw new Error('No GenesisPod users found; pass --user-id after creating a user.');
  return row.rows[0];
}

async function ensureKnowledgeBase(client, userId, key) {
  const def = key ? KB_DEFINITIONS[key] : SOLAR_KB_DEFINITION;
  const existing = await client.query(
    `select id from knowledge_bases where user_id = $1 and name = $2 order by created_at asc limit 1`,
    [userId, def.name]
  );
  const sourceTypes = JSON.stringify(def.sourceTypes);
  if (existing.rows[0]) {
    await client.query(
      `update knowledge_bases
       set description = $2,
           source_types = $3::jsonb,
           wiki_enabled = true,
           updated_at = now()
       where id = $1`,
      [existing.rows[0].id, def.description, sourceTypes]
    );
    return { id: existing.rows[0].id, created: false };
  }

  const id = crypto.randomUUID();
  await client.query(
    `insert into knowledge_bases (
      id, name, description, source_type, source_types, status,
      type, user_id, wiki_enabled, created_at, updated_at
    ) values (
      $1, $2, $3, 'MANUAL', $4::jsonb, 'PENDING',
      'PERSONAL', $5, true, now(), now()
    )`,
    [id, def.name, def.description, sourceTypes, userId]
  );
  return { id, created: true };
}

async function ensureSolarWikiConfig(client, knowledgeBaseId) {
  await client.query(
    `insert into wiki_knowledge_base_configs (
      knowledge_base_id,
      inline_page_count,
      inline_token_budget,
      ingest_max_tokens,
      cron_lint_enabled,
      cron_lint_daily_budget_calls,
      auto_ingest_enabled,
      auto_ingest_daily_budget_calls,
      auto_ingest_debounce_seconds,
      ingest_pass_mode,
      ingest_section_concurrency,
      ingest_section_failure_tolerance_ratio,
      ingest_outline_max_pages,
      auto_ingest_daily_chat_call_budget,
      enabled_locales,
      updated_at
    ) values (
      $1,
      200,
      500000,
      120000,
      true,
      50,
      false,
      20,
      300,
      'MULTI',
      2,
      0.3,
      40,
      50,
      array['zh'],
      now()
    )
    on conflict (knowledge_base_id) do update
    set ingest_pass_mode = 'MULTI',
        ingest_section_concurrency = 2,
        ingest_section_failure_tolerance_ratio = 0.3,
        ingest_outline_max_pages = 40,
        ingest_max_tokens = greatest(wiki_knowledge_base_configs.ingest_max_tokens, 120000),
        auto_ingest_enabled = false,
        enabled_locales = case
          when wiki_knowledge_base_configs.enabled_locales is null
            or cardinality(wiki_knowledge_base_configs.enabled_locales) = 0
          then array['zh']
          else wiki_knowledge_base_configs.enabled_locales
        end,
        updated_at = now()`,
    [knowledgeBaseId]
  );
}

function documentMetadata(doc) {
  return {
    ...(doc.metadata || {}),
    solar: {
      ...(doc.metadata?.solar || {}),
      kbKey: doc.kbKey,
      kbLabel: KB_DEFINITIONS[doc.kbKey]?.name || doc.kbKey,
    },
  };
}

async function upsertDocument(client, knowledgeBaseId, doc) {
  const hash = doc.metadata?.solar?.contentHash || contentHash(doc.rawContent);
  const existing = await client.query(
    `select id, metadata->'solar'->>'contentHash' as content_hash
     from knowledge_base_documents
     where knowledge_base_id = $1 and source_id = $2
     order by created_at asc
     limit 1`,
    [knowledgeBaseId, doc.sourceId]
  );

  if (existing.rows[0]) {
    const changed = existing.rows[0].content_hash !== hash;
    await client.query(
      `update knowledge_base_documents
       set title = $2,
           source_type = $3,
           source_url = $4,
           mime_type = $5,
           raw_content = $6,
           raw_content_uri = null,
          raw_content_size = $7,
          metadata = $8::jsonb,
           status = case when $9 then 'PENDING'::"KnowledgeBaseStatus" else status end,
           processed_at = case when $9 then null else processed_at end,
           chunk_count = case when $9 then 0 else chunk_count end,
           last_error = case when $9 then null else last_error end,
           updated_at = now()
       where id = $1`,
      [
        existing.rows[0].id,
        doc.title,
        doc.sourceType,
        doc.sourceUrl,
        doc.mimeType,
        doc.rawContent,
        Buffer.byteLength(doc.rawContent, 'utf8'),
        JSON.stringify(documentMetadata(doc)),
        changed,
      ]
    );
    return changed ? 'updated' : 'unchanged';
  }

  await client.query(
    `insert into knowledge_base_documents (
      id, knowledge_base_id, title, source_type, source_id, source_url,
      mime_type, raw_content, raw_content_size, status, metadata,
      created_at, updated_at
    ) values (
      $1, $2, $3, $4, $5, $6,
      $7, $8, $9, 'PENDING', $10::jsonb,
      now(), now()
    )`,
    [
      crypto.randomUUID(),
      knowledgeBaseId,
      doc.title,
      doc.sourceType,
      doc.sourceId,
      doc.sourceUrl,
      doc.mimeType,
      doc.rawContent,
      Buffer.byteLength(doc.rawContent, 'utf8'),
      JSON.stringify(documentMetadata(doc)),
    ]
  );
  return 'inserted';
}

function summarizeDocs(docs) {
  const summary = {};
  for (const key of Object.keys(KB_DEFINITIONS)) {
    const rows = docs.filter((doc) => doc.kbKey === key);
    summary[key] = {
      count: rows.length,
      chars: rows.reduce((sum, doc) => sum + doc.rawContent.length, 0),
      examples: rows.slice(0, 5).map((doc) => doc.title),
    };
  }
  return summary;
}

async function syncDocs(client, user, docs, args) {
  const summary = {};
  const kbIds = {};
  const solarKb = await ensureKnowledgeBase(client, user.id);
  await ensureSolarWikiConfig(client, solarKb.id);
  for (const key of enabledKbKeys(args)) {
    const rows = docs.filter((doc) => doc.kbKey === key);
    if (!rows.length) {
      summary[key] = { inserted: 0, updated: 0, unchanged: 0, kbCreated: false };
      continue;
    }
    kbIds[key] = solarKb.id;
    summary[key] = { inserted: 0, updated: 0, unchanged: 0, kbCreated: solarKb.created };
    for (const doc of rows) {
      const result = await upsertDocument(client, solarKb.id, doc);
      summary[key][result] += 1;
    }
  }
  return { summary, kbIds, solarKnowledgeBaseId: solarKb.id };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const docs = buildDocs(args);
  const candidateSummary = summarizeDocs(docs);

  if (args.dryRun) {
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'dry-run',
          knowledgeRoot: KNOWLEDGE_ROOT,
          solarTechDb: SOLAR_TECH_DB,
          limits: args.limits,
          summary: candidateSummary,
        },
        null,
        2
      )
    );
    return;
  }

  const env = readDotEnv(path.join(ROOT_DIR, '.env'));
  const databaseUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is missing');

  const client = new Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const user = await resolveUser(client, args);
    const result = await syncDocs(client, user, docs, args);
    console.log(
      JSON.stringify(
        {
          ok: true,
          mode: 'apply',
          user,
          knowledgeRoot: KNOWLEDGE_ROOT,
          solarTechDb: SOLAR_TECH_DB,
          limits: args.limits,
          candidates: candidateSummary,
          ...result,
          nextStep:
            'Run /rag/knowledge-bases/:id/process for changed KBs to build chunks and embeddings.',
        },
        null,
        2
      )
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
