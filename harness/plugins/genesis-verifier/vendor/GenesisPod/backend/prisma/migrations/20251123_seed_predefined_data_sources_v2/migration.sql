-- Insert predefined data sources using raw SQL (industry best practice)
-- This avoids Prisma serialization issues with complex JSON fields

-- Insert arXiv
INSERT INTO "data_sources" (
  id, name, description, type, category, base_url, api_endpoint,
  crawler_type, crawler_config, rate_limit, keywords, categories,
  min_quality_score, status, is_verified, deduplication_config,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'arXiv',
  'arXiv is a free distribution service and an open-access archive for scholarly articles',
  'ARXIV',
  'PAPER',
  'http://export.arxiv.org',
  '/api/query',
  'API',
  '{"searchParams": "search_query=cat:cs.AI+OR+cat:cs.LG+OR+cat:cs.CL", "sortBy": "submittedDate", "sortOrder": "descending"}'::jsonb,
  3,
  ARRAY['AI', 'machine learning', 'deep learning', 'neural networks']::text[],
  ARRAY['cs.AI', 'cs.LG', 'cs.CL', 'cs.CV']::text[],
  7.0,
  'ACTIVE',
  true,
  '{"checkUrl": true, "checkTitle": true, "titleSimilarityThreshold": 0.85}'::jsonb,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "data_sources" WHERE name = 'arXiv'
);

-- Insert Google AI Blog
INSERT INTO "data_sources" (
  id, name, description, type, category, base_url, api_endpoint,
  crawler_type, crawler_config, rate_limit, keywords,
  min_quality_score, status, is_verified, deduplication_config,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'Google AI Blog',
  'Latest news and updates from Google AI',
  'RSS',
  'BLOG',
  'https://blog.google',
  '/technology/ai/rss',
  'RSS',
  '{"rssUrl": "https://blog.google/technology/ai/rss/"}'::jsonb,
  60,
  ARRAY['AI', 'Google', 'research', 'machine learning']::text[],
  8.0,
  'ACTIVE',
  true,
  '{"checkUrl": true, "checkTitle": true, "titleSimilarityThreshold": 0.85}'::jsonb,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "data_sources" WHERE name = 'Google AI Blog'
);

-- Insert OpenAI Blog
INSERT INTO "data_sources" (
  id, name, description, type, category, base_url, api_endpoint,
  crawler_type, crawler_config, rate_limit, keywords,
  min_quality_score, status, is_verified, deduplication_config,
  created_at, updated_at
)
SELECT
  gen_random_uuid(),
  'OpenAI Blog',
  'Official blog from OpenAI with research updates and announcements',
  'RSS',
  'BLOG',
  'https://openai.com',
  '/blog/rss.xml',
  'RSS',
  '{"rssUrl": "https://openai.com/blog/rss.xml"}'::jsonb,
  60,
  ARRAY['AI', 'OpenAI', 'GPT', 'ChatGPT', 'research']::text[],
  9.0,
  'ACTIVE',
  true,
  '{"checkUrl": true, "checkTitle": true, "titleSimilarityThreshold": 0.85}'::jsonb,
  NOW(),
  NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM "data_sources" WHERE name = 'OpenAI Blog'
);
