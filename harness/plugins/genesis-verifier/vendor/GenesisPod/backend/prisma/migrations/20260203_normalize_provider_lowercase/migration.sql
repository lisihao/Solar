-- Normalize ai_models.provider to lowercase to match user_api_keys.provider
UPDATE ai_models SET provider = LOWER(provider) WHERE provider != LOWER(provider);
