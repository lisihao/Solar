-- Add CHAT_FAST tier to AIModelType enum
-- This tier is for low-cost, fast models used for simple tasks like classification, translation, summary extraction

-- PostgreSQL requires altering the enum type
ALTER TYPE "AIModelType" ADD VALUE IF NOT EXISTS 'CHAT_FAST';

-- Note: Existing models remain unchanged (backward compatible)
-- Users can now configure CHAT_FAST models in Settings -> AI Modules
-- And set a default model for CHAT_FAST tier for use in classification, translation, etc.
