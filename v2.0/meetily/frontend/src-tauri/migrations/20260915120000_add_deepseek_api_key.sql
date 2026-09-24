-- Migration: Add DeepSeek API key column for the DeepSeek provider
ALTER TABLE settings ADD COLUMN deepseekApiKey TEXT;
