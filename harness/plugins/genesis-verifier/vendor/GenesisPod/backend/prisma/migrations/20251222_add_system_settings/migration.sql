-- System Settings table for admin-configurable settings
-- 创建时间: 2025-12-22

-- Add encrypted column if it doesn't exist (table may already exist from earlier migration)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'system_settings' AND column_name = 'encrypted'
    ) THEN
        ALTER TABLE "system_settings" ADD COLUMN "encrypted" BOOLEAN NOT NULL DEFAULT false;
    END IF;
END $$;

-- Make value nullable if it isn't already
DO $$
BEGIN
    ALTER TABLE "system_settings" ALTER COLUMN "value" DROP NOT NULL;
EXCEPTION
    WHEN others THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "system_settings_category_idx" ON "system_settings"("category");
CREATE INDEX IF NOT EXISTS "system_settings_key_idx" ON "system_settings"("key");

-- Insert default settings with explicit UUIDs and timestamps
INSERT INTO "system_settings" ("id", "key", "value", "description", "category", "created_at", "updated_at", "encrypted") VALUES
    -- Email Settings
    (gen_random_uuid()::text, 'smtp_host', '', 'SMTP server host (e.g., smtp.gmail.com)', 'email', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'smtp_port', '587', 'SMTP server port (587 for TLS, 465 for SSL)', 'email', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'smtp_user', '', 'SMTP username/email address', 'email', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'smtp_pass', '', 'SMTP password (App Password for Gmail)', 'email', NOW(), NOW(), true),
    (gen_random_uuid()::text, 'smtp_from', 'Genesis <noreply@genesis.ai>', 'Default sender address', 'email', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'smtp_enabled', 'false', 'Enable email notifications', 'email', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'admin_email', '', 'Admin email for system notifications', 'email', NOW(), NOW(), false),
    -- Site Settings
    (gen_random_uuid()::text, 'site_name', 'DeepDive', 'Site display name', 'site', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'site_description', 'AI-Driven Knowledge Discovery Platform', 'Site description', 'site', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'maintenance_mode', 'false', 'Enable maintenance mode', 'site', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'maintenance_message', 'System is under maintenance. Please try again later.', 'Maintenance mode message', 'site', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'allow_registration', 'true', 'Allow new user registration', 'site', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'require_email_verification', 'false', 'Require email verification for new users', 'site', NOW(), NOW(), false),
    -- AI Settings
    (gen_random_uuid()::text, 'default_ai_model', 'gpt-4o-mini', 'Default AI model for chat', 'ai', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'ai_max_tokens', '4096', 'Maximum tokens for AI responses', 'ai', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'ai_temperature', '0.7', 'Default temperature for AI (0-1)', 'ai', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'ai_rate_limit_per_minute', '20', 'AI requests per minute per user', 'ai', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'ai_rate_limit_per_day', '500', 'AI requests per day per user', 'ai', NOW(), NOW(), false),
    -- Security Settings
    (gen_random_uuid()::text, 'session_timeout_hours', '24', 'Session timeout in hours', 'security', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'max_login_attempts', '5', 'Max failed login attempts before lockout', 'security', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'lockout_duration_minutes', '15', 'Account lockout duration in minutes', 'security', NOW(), NOW(), false),
    -- Storage Settings
    (gen_random_uuid()::text, 'max_upload_size_mb', '10', 'Maximum file upload size in MB', 'storage', NOW(), NOW(), false),
    (gen_random_uuid()::text, 'allowed_file_types', 'image/*,application/pdf,.doc,.docx,.xls,.xlsx', 'Allowed file types for upload', 'storage', NOW(), NOW(), false)
ON CONFLICT ("key") DO NOTHING;
