const { Client } = require('pg');

const client = new Client({ connectionString: process.env.DATABASE_URL });

async function main() {
  await client.connect();

  console.log('=== SLIDES SESSIONS ===');
  const sessions = await client.query(`
    SELECT id, title, status, updated_at
    FROM slides_sessions
    ORDER BY updated_at DESC
    LIMIT 10
  `);
  sessions.rows.forEach(s => console.log(s.id?.slice(0,8), '|', (s.title || 'N/A').slice(0,35).padEnd(35), '|', s.status));

  console.log('\n=== SLIDES CHECKPOINTS (Latest 15) ===');
  const checkpoints = await client.query(`
    SELECT
      c.id, c.name, c.type, c.session_id,
      CASE WHEN jsonb_typeof(c.state_json->'pages') = 'array' THEN jsonb_array_length(c.state_json->'pages') ELSE 0 END as pages_count,
      c.state_json->'outlinePlan'->>'title' as outline_title,
      s.title as session_title
    FROM slides_checkpoints c
    LEFT JOIN slides_sessions s ON s.id = c.session_id
    ORDER BY c.created_at DESC
    LIMIT 15
  `);
  checkpoints.rows.forEach(c => {
    console.log(
      c.id?.slice(0,8), '|',
      (c.session_title || 'N/A').slice(0,20).padEnd(20), '|',
      c.type?.padEnd(18), '|',
      'pages:', String(c.pages_count).padStart(2), '|',
      'outline:', (c.outline_title || 'N/A').slice(0,20)
    );
  });

  console.log('\n=== KANATA SEARCH ===');
  const kanata = await client.query(`
    SELECT s.id, s.title, c.id as cp_id, c.name as cp_name,
      CASE WHEN jsonb_typeof(c.state_json->'pages') = 'array' THEN jsonb_array_length(c.state_json->'pages') ELSE 0 END as pages_count,
      c.state_json->'outlinePlan'->>'title' as outline_title
    FROM slides_sessions s
    LEFT JOIN slides_checkpoints c ON c.session_id = s.id
    WHERE s.title ILIKE '%KANATA%'
    ORDER BY c.created_at DESC
  `);
  if (kanata.rows.length > 0) {
    console.log('Found KANATA sessions:');
    kanata.rows.forEach(r => {
      console.log('  Session:', r.title);
      console.log('    CP:', r.cp_id?.slice(0,8), '|', r.cp_name?.slice(0,35), '| Pages:', r.pages_count, '| Outline:', r.outline_title?.slice(0,25) || 'N/A');
    });
  } else {
    console.log('No KANATA sessions found');
  }

  await client.end();
}

main().catch(e => { console.error('Error:', e.message); process.exit(1); });
