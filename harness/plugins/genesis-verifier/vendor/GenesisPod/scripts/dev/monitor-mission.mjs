#!/usr/bin/env node
import { PrismaClient } from '@prisma/client';

const MID = process.argv[2] || 'f976eb07-4d34-411a-b852-fca9d27c58a1';
const p = new PrismaClient();
let lastTs = new Date(0);
let prevState = '';
let prevStage = '';

const fmt = (v) => v === null || v === undefined ? '-' : String(v);

async function poll() {
  const m = await p.$queryRawUnsafe(
    `SELECT status, error_message, leader_overall_score, final_score, leader_signed, tokens_used, cost_usd FROM agent_playground_missions WHERE id=$1`, MID
  );
  if (!m[0]) { console.log('[ERR] mission not found'); return true; }
  const cnt = await p.$queryRawUnsafe(
    `SELECT COUNT(*)::int AS n FROM agent_playground_mission_events WHERE mission_id=$1`, MID
  );
  const lastStageStarted = await p.$queryRawUnsafe(
    `SELECT payload, ts FROM agent_playground_mission_events WHERE mission_id=$1 AND type='agent-playground.stage:started' ORDER BY ts DESC LIMIT 1`, MID
  );
  const newEvents = await p.$queryRawUnsafe(
    `SELECT type, agent_id, ts, payload FROM agent_playground_mission_events WHERE mission_id=$1 AND ts > $2 AND type IN (
      'agent-playground.stage:started',
      'agent-playground.stage:completed',
      'agent-playground.stage:failed',
      'agent-playground.mission:failed',
      'agent-playground.tool:error',
      'agent-playground.agent:lifecycle',
      'agent-playground.agent:error',
      'agent-playground.dimension:degraded',
      'agent-playground.dimension:integrating:failed'
    ) ORDER BY ts ASC LIMIT 50`,
    MID, lastTs
  );
  // 单独抓 OpenAI 真实 error message — 现在 error-classifier 不再吞掉，可在 observation/error 事件 payload 里看到
  const openaiErrors = await p.$queryRawUnsafe(
    `SELECT type, agent_id, ts, payload FROM agent_playground_mission_events WHERE mission_id=$1 AND ts > $2 AND (
      payload::text ILIKE '%does not exist%' OR
      payload::text ILIKE '%do not have access%' OR
      payload::text ILIKE '%model_not_found%' OR
      payload::text ILIKE '%INVALID_MODEL%'
    ) ORDER BY ts ASC LIMIT 20`,
    MID, lastTs
  );

  const state = m[0].status;
  const tokens = fmt(m[0].tokens_used);
  const cost = fmt(m[0].cost_usd);
  const score = fmt(m[0].leader_overall_score);
  const signed = m[0].leader_signed === true ? 'yes' : m[0].leader_signed === false ? 'no' : '-';
  const finalScore = fmt(m[0].final_score);
  const err = m[0].error_message || '-';
  const stage = lastStageStarted[0] ? (lastStageStarted[0].payload?.stage || lastStageStarted[0].payload?.key || '?') : '-';

  if (state !== prevState) {
    console.log(`[STATE] ${prevState||'(init)'} -> ${state} | tokens=${tokens} cost=${cost} score=${score} signed=${signed} events=${cnt[0].n}`);
    prevState = state;
  }
  if (stage !== prevStage && stage !== '-') {
    console.log(`[STAGE] ${stage} | events=${cnt[0].n} tokens=${tokens}`);
    prevStage = stage;
  }
  for (const e of newEvents) {
    const tag = e.type.split('.').pop();
    const sn = e.payload?.stage || e.payload?.key || '';
    const errInfo = e.payload?.error ? ` err=${JSON.stringify(e.payload.error).slice(0,200)}` : '';
    const msg = e.payload?.message ? ` msg="${String(e.payload.message).slice(0,200)}"` : '';
    const lifecycle = e.payload?.phase || e.payload?.event || '';
    if (tag === 'lifecycle' && lifecycle !== 'started' && lifecycle !== 'completed') {
      console.log(`[EVT ${e.ts.toISOString()}] ${tag} ${e.agent_id||'-'} ${lifecycle}${errInfo}${msg}`);
    } else if (tag !== 'lifecycle') {
      console.log(`[EVT ${e.ts.toISOString()}] ${tag} ${e.agent_id||'-'} ${sn}${errInfo}${msg}`);
    }
    if (e.ts > lastTs) lastTs = e.ts;
  }
  // 高亮 OpenAI 真实 error
  for (const e of openaiErrors) {
    const blob = JSON.stringify(e.payload).slice(0, 400);
    console.log(`[!OPENAI_ERR ${e.ts.toISOString()}] ${e.agent_id||'-'} ${blob}`);
    if (e.ts > lastTs) lastTs = e.ts;
  }

  // 终态扩展 — 含 quality-failed / cancelled
  if (['completed','failed','quality-failed','cancelled'].includes(state)) {
    console.log(`[DONE] state=${state} final=${finalScore} score=${score} signed=${signed} tokens=${tokens} cost=${cost} err=${err}`);
    return true;
  }
  return false;
}

(async () => {
  while (true) {
    try {
      const done = await poll();
      if (done) break;
    } catch (e) {
      console.log(`[POLL_ERR] ${e.message}`);
    }
    await new Promise(r => setTimeout(r, 30000));
  }
  await p.$disconnect();
})();
