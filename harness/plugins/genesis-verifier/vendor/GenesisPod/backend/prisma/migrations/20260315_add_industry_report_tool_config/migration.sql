-- Add Industry Report Sources tool config
-- Provides curated industry report and analysis sources for deep research
-- Sources include: SemiAnalysis, Stratechery, The Gradient, ARK Invest, a16z,
--                  Stanford HAI, MIT Tech Review, CB Insights, McKinsey, Economist Impact

INSERT INTO tool_configs (id, tool_id, enabled, display_name, description, config, category, tags, created_at, updated_at)
VALUES (
  gen_random_uuid(),
  'industry-report',
  true,
  'Industry Report Sources',
  'Curated industry report and analysis sources for deep research',
  '{"sources":[{"id":"semianalysis","name":"SemiAnalysis","domain":"semianalysis.com","category":"semiconductor","credibilityScore":0.9,"enabled":true,"topicTypes":["TECHNOLOGY","MACRO","EVENT"]},{"id":"stratechery","name":"Stratechery","domain":"stratechery.com","category":"tech-strategy","credibilityScore":0.88,"enabled":true,"topicTypes":["TECHNOLOGY","COMPANY","EVENT"]},{"id":"thegradient","name":"The Gradient","domain":"thegradient.pub","category":"ai-ml","credibilityScore":0.85,"enabled":true,"topicTypes":["TECHNOLOGY"]},{"id":"ark-invest","name":"ARK Invest","domain":"ark-invest.com","category":"investment","credibilityScore":0.82,"enabled":true,"topicTypes":["MACRO","COMPANY"]},{"id":"a16z","name":"a16z","domain":"a16z.com","category":"venture","credibilityScore":0.82,"enabled":true,"topicTypes":["TECHNOLOGY","COMPANY"]},{"id":"stanford-hai","name":"Stanford HAI","domain":"hai.stanford.edu","category":"ai-academic","credibilityScore":0.92,"enabled":true,"topicTypes":["TECHNOLOGY","MACRO"]},{"id":"mit-tech-review","name":"MIT Tech Review","domain":"technologyreview.com","category":"tech-review","credibilityScore":0.88,"enabled":true,"topicTypes":["TECHNOLOGY","MACRO","EVENT"]},{"id":"cb-insights","name":"CB Insights","domain":"cbinsights.com","category":"industry-data","credibilityScore":0.85,"enabled":true,"topicTypes":["MACRO","COMPANY"]},{"id":"mckinsey","name":"McKinsey Insights","domain":"mckinsey.com","category":"consulting","credibilityScore":0.88,"enabled":true,"topicTypes":["MACRO","COMPANY"]},{"id":"economist-impact","name":"Economist Impact","domain":"impact.economist.com","category":"economics","credibilityScore":0.88,"enabled":true,"topicTypes":["MACRO"]}]}'::jsonb,
  'Industry Research',
  ARRAY['industry', 'reports', 'research', 'analysis'],
  NOW(),
  NOW()
)
ON CONFLICT (tool_id) DO NOTHING;
