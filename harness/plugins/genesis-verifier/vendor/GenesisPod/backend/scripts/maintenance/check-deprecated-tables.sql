-- ============================================================
-- Deprecated Tables Detection Script
-- Run this on Railway PostgreSQL to identify orphaned tables
-- Date: 2026-01-24
-- ============================================================

-- ============================================================
-- PART 1: List All Tables with Status
-- ============================================================

WITH valid_tables AS (
    SELECT unnest(ARRAY[
        -- User & Auth
        'users', 'login_history', 'user_interests', 'user_activities',
        -- Resources & Collections
        'resources', 'resource_upvotes', 'resource_translations',
        'collections', 'collection_items',
        -- Learning
        'learning_paths', 'learning_path_steps',
        -- Notes & Comments
        'notes', 'comments',
        -- Reports
        'reports', 'report_templates', 'report_publishers', 'collected_reports',
        -- Workspaces
        'workspaces', 'workspace_resources', 'workspace_tasks',
        -- YouTube
        'youtube_videos', 'youtube_transcript_cache',
        -- Data Collection
        'source_whitelist', 'collection_rules', 'import_tasks', 'parsed_metadata',
        'data_quality_metrics', 'collection_statistics', 'collection_configurations',
        'data_sources', 'collection_tasks', 'deduplication_records',
        -- Topics (AI Teams)
        'topics', 'topic_members', 'topic_ai_members', 'topic_messages',
        'topic_message_embeddings', 'topic_message_mentions', 'topic_message_attachments',
        'topic_message_reactions', 'topic_resources', 'topic_summaries',
        'topic_message_forwards', 'topic_message_bookmarks', 'topic_join_requests',
        'topic_knowledge_bases', 'topic_invitations',
        -- Team Missions
        'team_missions', 'agent_tasks', 'mission_logs', 'vote_proposals', 'vote_records',
        -- Research Projects
        'research_projects', 'research_project_sources', 'research_project_notes',
        'research_project_chats', 'research_project_outputs', 'research_project_knowledge_bases',
        -- System
        'system_settings', 'ai_models',
        -- Debate
        'debate_sessions', 'debate_agents', 'debate_messages',
        -- Data & Images
        'raw_data', 'generated_images', 'brand_kits',
        -- Office Documents
        'office_documents', 'office_document_versions', 'office_document_resource_refs',
        'office_document_templates', 'office_document_knowledge_bases',
        'office_agent_tasks', 'office_agent_artifacts', 'office_agent_tool_logs',
        -- Ask Sessions
        'ask_sessions', 'ask_messages', 'ask_session_knowledge_bases',
        -- Simulation
        'simulation_scenarios', 'simulation_companies', 'simulation_agents',
        'simulation_runs', 'simulation_turns',
        -- Feedback
        'feedbacks', 'feedback_replies',
        -- Notion
        'notion_connections', 'notion_pages', 'notion_databases',
        'notion_block_versions', 'notion_sync_history',
        -- AI Coding
        'ai_coding_projects', 'ai_coding_files', 'ai_coding_agent_logs',
        'ai_coding_iterations', 'ai_coding_standards', 'ai_coding_compliance_reports',
        'github_connections', 'ai_coding_github_repos', 'ai_coding_pull_requests',
        'ai_coding_documents', 'coding_team_members', 'coding_missions',
        'coding_agent_tasks', 'coding_team_messages', 'coding_mission_logs',
        -- Deep Research
        'deep_research_sessions',
        -- Export
        'export_jobs', 'export_templates',
        -- Google Drive
        'google_drive_connections', 'google_drive_sync_history', 'google_drive_imported_files',
        -- Knowledge Base
        'knowledge_bases', 'knowledge_base_members', 'knowledge_base_documents',
        'parent_chunks', 'child_chunks', 'child_embeddings',
        'user_data_sources', 'knowledge_base_sources',
        -- Credits
        'credit_accounts', 'credit_transactions', 'credit_rules', 'daily_checkins',
        -- Slides
        'slides_sessions', 'slides_checkpoints', 'slides_team_executions', 'slides_team_logs',
        'slides_missions', 'slides_tasks', 'slides_mission_events',
        'slides_team_member_configs', 'slides_proposals', 'slides_votes',
        -- Webhooks
        'webhook_subscriptions', 'webhook_deliveries',
        -- WeChat
        'wechat_items',
        -- Writing
        'writing_projects', 'writing_style_templates', 'story_bibles',
        'writing_characters', 'character_relationships', 'world_settings',
        'factions', 'terminologies', 'timeline_events', 'story_bible_audit_logs',
        'writing_volumes', 'writing_chapters', 'writing_scenes', 'scene_appearances',
        'consistency_checks', 'writing_missions', 'writing_mission_logs',
        'writing_expression_memories', 'writing_character_personalities',
        'writing_plot_patterns', 'writing_quality_scores', 'writing_historical_knowledge',
        'writing_quality_issue_patterns', 'chapter_revisions', 'chapter_annotations',
        'chapter_imports',
        -- AI Team Templates
        'ai_team_templates', 'ai_team_member_templates',
        'tool_configs', 'skill_configs', 'mcp_server_configs',
        -- AI Usage
        'ai_usage_logs',
        -- Research Topics
        'research_topics', 'research_topic_collaborators', 'topic_dimensions',
        'dimension_analyses', 'topic_reports', 'topic_evidences', 'topic_schedules',
        'topic_refresh_logs', 'research_missions', 'research_tasks', 'leader_decisions',
        'topic_report_revisions', 'report_changes', 'report_annotations',
        'research_team_messages', 'research_agent_activities', 'credibility_reports',
        'dimension_freshness', 'review_tasks', 'research_histories', 'research_todos',
        -- Secrets
        'secrets', 'secret_versions', 'secret_access_logs',
        -- Notifications
        'notifications', 'notification_preferences',
        -- Social
        'social_platform_connections', 'social_contents', 'social_publish_logs',
        -- Other
        'provider_quota_cache', 'prompt_templates'
    ]) AS table_name
),
system_tables AS (
    SELECT unnest(ARRAY[
        '_prisma_migrations',  -- Prisma system table
        '_TurnAgents'          -- Prisma implicit many-to-many relation table
    ]) AS table_name
)
SELECT
    t.table_name,
    CASE
        WHEN t.table_name IN (SELECT table_name FROM valid_tables) THEN '✅ Active (in Prisma Schema)'
        WHEN t.table_name IN (SELECT table_name FROM system_tables) THEN '⚙️ System/Prisma Table'
        WHEN t.table_name LIKE '\_%' THEN '🔗 Prisma Relation Table'
        ELSE '❌ DEPRECATED/ORPHANED'
    END AS status,
    pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS total_size,
    (SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name) AS estimated_rows
FROM information_schema.tables t
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
ORDER BY
    CASE
        WHEN t.table_name IN (SELECT table_name FROM valid_tables) THEN 0
        WHEN t.table_name IN (SELECT table_name FROM system_tables) THEN 1
        WHEN t.table_name LIKE '\_%' THEN 2
        ELSE 3
    END,
    t.table_name;

-- ============================================================
-- PART 2: Only Deprecated Tables (Quick View)
-- ============================================================

SELECT '===== DEPRECATED TABLES =====' AS info;

WITH valid_tables AS (
    SELECT unnest(ARRAY[
        'users', 'login_history', 'user_interests', 'user_activities',
        'resources', 'resource_upvotes', 'resource_translations',
        'collections', 'collection_items', 'learning_paths', 'learning_path_steps',
        'notes', 'comments', 'reports', 'report_templates', 'report_publishers',
        'collected_reports', 'workspaces', 'workspace_resources', 'workspace_tasks',
        'youtube_videos', 'youtube_transcript_cache', 'source_whitelist',
        'collection_rules', 'import_tasks', 'parsed_metadata', 'data_quality_metrics',
        'collection_statistics', 'collection_configurations', 'data_sources',
        'collection_tasks', 'deduplication_records', 'topics', 'topic_members',
        'topic_ai_members', 'topic_messages', 'topic_message_embeddings',
        'topic_message_mentions', 'topic_message_attachments', 'topic_message_reactions',
        'topic_resources', 'topic_summaries', 'topic_message_forwards',
        'topic_message_bookmarks', 'topic_join_requests', 'topic_knowledge_bases',
        'topic_invitations', 'team_missions', 'agent_tasks', 'mission_logs',
        'vote_proposals', 'vote_records', 'research_projects', 'research_project_sources',
        'research_project_notes', 'research_project_chats', 'research_project_outputs',
        'research_project_knowledge_bases', 'system_settings', 'ai_models',
        'debate_sessions', 'debate_agents', 'debate_messages', 'raw_data',
        'generated_images', 'brand_kits', 'office_documents', 'office_document_versions',
        'office_document_resource_refs', 'office_document_templates',
        'office_document_knowledge_bases', 'office_agent_tasks', 'office_agent_artifacts',
        'office_agent_tool_logs', 'ask_sessions', 'ask_messages',
        'ask_session_knowledge_bases', 'simulation_scenarios', 'simulation_companies',
        'simulation_agents', 'simulation_runs', 'simulation_turns', 'feedbacks',
        'feedback_replies', 'notion_connections', 'notion_pages', 'notion_databases',
        'notion_block_versions', 'notion_sync_history', 'ai_coding_projects',
        'ai_coding_files', 'ai_coding_agent_logs', 'ai_coding_iterations',
        'ai_coding_standards', 'ai_coding_compliance_reports', 'github_connections',
        'ai_coding_github_repos', 'ai_coding_pull_requests', 'ai_coding_documents',
        'coding_team_members', 'coding_missions', 'coding_agent_tasks',
        'coding_team_messages', 'coding_mission_logs', 'deep_research_sessions',
        'export_jobs', 'export_templates', 'google_drive_connections',
        'google_drive_sync_history', 'google_drive_imported_files', 'knowledge_bases',
        'knowledge_base_members', 'knowledge_base_documents', 'parent_chunks',
        'child_chunks', 'child_embeddings', 'user_data_sources', 'knowledge_base_sources',
        'credit_accounts', 'credit_transactions', 'credit_rules', 'daily_checkins',
        'slides_sessions', 'slides_checkpoints', 'slides_team_executions',
        'slides_team_logs', 'slides_missions', 'slides_tasks', 'slides_mission_events',
        'slides_team_member_configs', 'slides_proposals', 'slides_votes',
        'webhook_subscriptions', 'webhook_deliveries', 'wechat_items',
        'writing_projects', 'writing_style_templates', 'story_bibles',
        'writing_characters', 'character_relationships', 'world_settings', 'factions',
        'terminologies', 'timeline_events', 'story_bible_audit_logs', 'writing_volumes',
        'writing_chapters', 'writing_scenes', 'scene_appearances', 'consistency_checks',
        'writing_missions', 'writing_mission_logs', 'writing_expression_memories',
        'writing_character_personalities', 'writing_plot_patterns', 'writing_quality_scores',
        'writing_historical_knowledge', 'writing_quality_issue_patterns',
        'chapter_revisions', 'chapter_annotations', 'chapter_imports',
        'ai_team_templates', 'ai_team_member_templates', 'tool_configs', 'skill_configs',
        'mcp_server_configs', 'ai_usage_logs', 'research_topics',
        'research_topic_collaborators', 'topic_dimensions', 'dimension_analyses',
        'topic_reports', 'topic_evidences', 'topic_schedules', 'topic_refresh_logs',
        'research_missions', 'research_tasks', 'leader_decisions', 'topic_report_revisions',
        'report_changes', 'report_annotations', 'research_team_messages',
        'research_agent_activities', 'credibility_reports', 'dimension_freshness',
        'review_tasks', 'research_histories', 'research_todos', 'secrets',
        'secret_versions', 'secret_access_logs', 'notifications', 'notification_preferences',
        'social_platform_connections', 'social_contents', 'social_publish_logs',
        'provider_quota_cache', 'prompt_templates',
        -- System tables
        '_prisma_migrations', '_TurnAgents'
    ]) AS table_name
)
SELECT
    t.table_name AS "Deprecated Table",
    pg_size_pretty(pg_total_relation_size(quote_ident(t.table_name))) AS "Size",
    (SELECT reltuples::bigint FROM pg_class WHERE relname = t.table_name) AS "Est. Rows"
FROM information_schema.tables t
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT IN (SELECT table_name FROM valid_tables)
    AND t.table_name NOT LIKE '\_%'
ORDER BY t.table_name;

-- ============================================================
-- PART 3: Drop Commands (Review Before Running!)
-- ============================================================

SELECT '===== DROP COMMANDS (REVIEW CAREFULLY!) =====' AS info;

WITH valid_tables AS (
    SELECT unnest(ARRAY[
        'users', 'login_history', 'user_interests', 'user_activities',
        'resources', 'resource_upvotes', 'resource_translations',
        'collections', 'collection_items', 'learning_paths', 'learning_path_steps',
        'notes', 'comments', 'reports', 'report_templates', 'report_publishers',
        'collected_reports', 'workspaces', 'workspace_resources', 'workspace_tasks',
        'youtube_videos', 'youtube_transcript_cache', 'source_whitelist',
        'collection_rules', 'import_tasks', 'parsed_metadata', 'data_quality_metrics',
        'collection_statistics', 'collection_configurations', 'data_sources',
        'collection_tasks', 'deduplication_records', 'topics', 'topic_members',
        'topic_ai_members', 'topic_messages', 'topic_message_embeddings',
        'topic_message_mentions', 'topic_message_attachments', 'topic_message_reactions',
        'topic_resources', 'topic_summaries', 'topic_message_forwards',
        'topic_message_bookmarks', 'topic_join_requests', 'topic_knowledge_bases',
        'topic_invitations', 'team_missions', 'agent_tasks', 'mission_logs',
        'vote_proposals', 'vote_records', 'research_projects', 'research_project_sources',
        'research_project_notes', 'research_project_chats', 'research_project_outputs',
        'research_project_knowledge_bases', 'system_settings', 'ai_models',
        'debate_sessions', 'debate_agents', 'debate_messages', 'raw_data',
        'generated_images', 'brand_kits', 'office_documents', 'office_document_versions',
        'office_document_resource_refs', 'office_document_templates',
        'office_document_knowledge_bases', 'office_agent_tasks', 'office_agent_artifacts',
        'office_agent_tool_logs', 'ask_sessions', 'ask_messages',
        'ask_session_knowledge_bases', 'simulation_scenarios', 'simulation_companies',
        'simulation_agents', 'simulation_runs', 'simulation_turns', 'feedbacks',
        'feedback_replies', 'notion_connections', 'notion_pages', 'notion_databases',
        'notion_block_versions', 'notion_sync_history', 'ai_coding_projects',
        'ai_coding_files', 'ai_coding_agent_logs', 'ai_coding_iterations',
        'ai_coding_standards', 'ai_coding_compliance_reports', 'github_connections',
        'ai_coding_github_repos', 'ai_coding_pull_requests', 'ai_coding_documents',
        'coding_team_members', 'coding_missions', 'coding_agent_tasks',
        'coding_team_messages', 'coding_mission_logs', 'deep_research_sessions',
        'export_jobs', 'export_templates', 'google_drive_connections',
        'google_drive_sync_history', 'google_drive_imported_files', 'knowledge_bases',
        'knowledge_base_members', 'knowledge_base_documents', 'parent_chunks',
        'child_chunks', 'child_embeddings', 'user_data_sources', 'knowledge_base_sources',
        'credit_accounts', 'credit_transactions', 'credit_rules', 'daily_checkins',
        'slides_sessions', 'slides_checkpoints', 'slides_team_executions',
        'slides_team_logs', 'slides_missions', 'slides_tasks', 'slides_mission_events',
        'slides_team_member_configs', 'slides_proposals', 'slides_votes',
        'webhook_subscriptions', 'webhook_deliveries', 'wechat_items',
        'writing_projects', 'writing_style_templates', 'story_bibles',
        'writing_characters', 'character_relationships', 'world_settings', 'factions',
        'terminologies', 'timeline_events', 'story_bible_audit_logs', 'writing_volumes',
        'writing_chapters', 'writing_scenes', 'scene_appearances', 'consistency_checks',
        'writing_missions', 'writing_mission_logs', 'writing_expression_memories',
        'writing_character_personalities', 'writing_plot_patterns', 'writing_quality_scores',
        'writing_historical_knowledge', 'writing_quality_issue_patterns',
        'chapter_revisions', 'chapter_annotations', 'chapter_imports',
        'ai_team_templates', 'ai_team_member_templates', 'tool_configs', 'skill_configs',
        'mcp_server_configs', 'ai_usage_logs', 'research_topics',
        'research_topic_collaborators', 'topic_dimensions', 'dimension_analyses',
        'topic_reports', 'topic_evidences', 'topic_schedules', 'topic_refresh_logs',
        'research_missions', 'research_tasks', 'leader_decisions', 'topic_report_revisions',
        'report_changes', 'report_annotations', 'research_team_messages',
        'research_agent_activities', 'credibility_reports', 'dimension_freshness',
        'review_tasks', 'research_histories', 'research_todos', 'secrets',
        'secret_versions', 'secret_access_logs', 'notifications', 'notification_preferences',
        'social_platform_connections', 'social_contents', 'social_publish_logs',
        'provider_quota_cache', 'prompt_templates',
        '_prisma_migrations', '_TurnAgents'
    ]) AS table_name
)
SELECT
    'DROP TABLE IF EXISTS "' || t.table_name || '" CASCADE;' AS "Drop Command"
FROM information_schema.tables t
WHERE t.table_schema = 'public'
    AND t.table_type = 'BASE TABLE'
    AND t.table_name NOT IN (SELECT table_name FROM valid_tables)
    AND t.table_name NOT LIKE '\_%'
ORDER BY t.table_name;
