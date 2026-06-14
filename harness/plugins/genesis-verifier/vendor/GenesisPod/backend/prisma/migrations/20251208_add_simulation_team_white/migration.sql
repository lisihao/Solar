-- Add WHITE value to SimulationTeam enum
-- This adds the "白方 - 裁判控制组/监管机构/政策制定者" team type

ALTER TYPE "SimulationTeam" ADD VALUE IF NOT EXISTS 'WHITE';
