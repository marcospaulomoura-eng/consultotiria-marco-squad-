import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../cloudflare/worker.mjs';
import { fitnessDatabase } from './fitness-local.mjs';
import { getFitnessCatalog, handleFitness } from './fitness-api.mjs';
import { createPostgresDatabase } from './postgres.mjs';
import { MARCOS_CHANNEL_URL, youtubeVideoId } from '../shared/youtube.mjs';
import marcosShorts from './marcos-shorts.json' with { type: 'json' };

const importPath = '/fitness/coach/shorts/import';
const videoIds = Array.from({ length: 2 }, () => randomBytes(9).toString('base64url').slice(0, 11));
const exercise = (index = 0, extra = {}) => ({ name: `Exercício de demonstração ${index + 1}`, videoUrl: `https://www.youtube.com/shorts/${videoIds[index]}`, ...extra });

async function fixture(t) {
  const sqlite = new DatabaseSync(':memory:');
  const migrations = new URL('../cloudflare/migrations/', import.meta.url);
  for (const file of readdirSync(migrations).filter(name => name.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, migrations), 'utf8'));
  t.after(() => sqlite.close());
  const DB = fitnessDatabase(sqlite); const env = { DB, DASHBOARD_PASSWORD: randomBytes(24).toString('hex') };
  async function request(path, { cookie, method = 'GET', data, headers = {} } = {}) {
    const response = await worker.fetch(new Request(`https://shorts-test.example/api${path}`, {
      method, headers: { ...(cookie ? { Cookie: cookie } : {}), ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: data === undefined ? undefined : JSON.stringify(data),
    }), env);
    return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
  }
  const logged = await request('/auth/login', { method: 'POST', data: { password: env.DASHBOARD_PASSWORD } }); assert.equal(logged.status, 200);
  const admin = logged.headers.get('set-cookie').split(';')[0];
  async function student(id = 'shorts-student') {
    sqlite.prepare(`INSERT INTO clients (id, name, plan, service, amount_cents, start_date, end_date, created_at, updated_at)
      VALUES (?, 'Aluno de demonstração', 'Mensal', 'Treino', 10000, '2026-01-01', '2099-01-01', '2026-01-01', '2026-01-01')`).run(id);
    const access = await request(`/fitness/coach/clients/${id}/access`, { cookie: admin, method: 'POST', data: {} }); assert.equal(access.status, 200);
    const login = await request('/fitness/auth/login', { method: 'POST', data: { code: access.data.code } }); assert.equal(login.status, 200);
    return { id, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  return { sqlite, DB, admin, request, student };
}

test('Shorts: seed mantém IDs únicos e links individuais válidos, sem substituir os 45 vídeos locais', async t => {
  const api = await fixture(t); const library = await getFitnessCatalog(api.DB);
  assert.equal(library.exercises.length, 45 + marcosShorts.exercises.length);
  assert.equal(library.exercises.filter(item => item.id.startsWith('wger-')).length, 45);
  assert.equal(library.foods.length, 591); assert.equal(library.youtubeChannel.url, MARCOS_CHANNEL_URL);
  assert.equal(new Set(marcosShorts.exercises.map(item => item.id)).size, marcosShorts.exercises.length);
  for (const item of marcosShorts.exercises) {
    const id = youtubeVideoId(item.videoUrl); assert.ok(id);
    assert.equal(item.id, `marcos-youtube-${id}`); assert.equal(item.collection, 'marcos-shorts');
    assert.equal(item.channelUrl, MARCOS_CHANNEL_URL); assert.equal(youtubeVideoId(item.sourceUrl), id);
    assert.ok(typeof item.name === 'string' && item.name.trim().length > 0 && item.name.length <= 120);
  }
});

test('Shorts: importação exige professor e protege a mesma origem', async t => {
  const api = await fixture(t); const student = await api.student(); const data = { items: [exercise()] };
  assert.equal((await api.request(importPath, { method: 'POST', data })).status, 401);
  assert.equal((await api.request(importPath, { cookie: student.cookie, method: 'POST', data })).status, 401);
  assert.equal((await api.request(importPath, { cookie: api.admin, method: 'POST', data, headers: { Origin: 'https://other.example' } })).status, 403);
  assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 0);
});

test('Shorts: lote valida todos os campos antes de qualquer gravação', async t => {
  const api = await fixture(t);
  const invalid = [
    { items: [] }, { items: Array.from({ length: 51 }, () => exercise()) }, { items: [exercise(), null] },
    { items: [exercise(), exercise(1, { videoUrl: MARCOS_CHANNEL_URL })] },
    { items: [exercise(), exercise(1, { videoUrl: 'https://media.example/video.mp4' })] },
    { items: [exercise(), exercise(1, { videoUrl: `http://youtube.com/shorts/${videoIds[1]}` })] },
    { items: [exercise(), exercise(1, { name: ' ' })] }, { items: [exercise(), exercise(1, { name: 'x'.repeat(121) })] },
    { items: [exercise(), exercise(1, { category: 'x'.repeat(61) })] }, { items: [exercise(), exercise(1, { equipment: false })] },
    { items: [exercise(), exercise(1, { instructions: 'x'.repeat(2001) })] },
  ];
  for (const data of invalid) {
    assert.equal((await api.request(importPath, { cookie: api.admin, method: 'POST', data })).status, 400);
    assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 0);
  }
  const oversized = { items: Array.from({ length: 20 }, () => exercise(0, { instructions: 'x'.repeat(2000) })) };
  assert.equal((await api.request(importPath, { cookie: api.admin, method: 'POST', data: oversized })).status, 413);
  assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 0);
});

test('Shorts: importação é idempotente e preserva catálogo, nomes e alimentos anteriores', async t => {
  const api = await fixture(t); const before = await getFitnessCatalog(api.DB);
  const data = { items: [exercise(0, { category: 'Pernas', equipment: 'Halteres', instructions: 'Orientação cadastrada pelo professor.' }), exercise(1),
    exercise(0, { name: 'Outro título da mesma demonstração', videoUrl: `https://youtu.be/${videoIds[0]}?si=share` })] };
  const imported = await api.request(importPath, { cookie: api.admin, method: 'POST', data });
  assert.equal(imported.status, 201); assert.equal(imported.data.created, 2); assert.equal(imported.data.skipped, 1); assert.equal(imported.data.exercises.length, 2);
  const first = imported.data.exercises.find(item => item.id === `marcos-youtube-${videoIds[0]}`);
  assert.equal(first.videoUrl, `https://www.youtube.com/watch?v=${videoIds[0]}`); assert.equal(first.sourceUrl, `https://www.youtube.com/shorts/${videoIds[0]}`);
  assert.equal(first.channelUrl, MARCOS_CHANNEL_URL); assert.equal(first.collection, 'marcos-shorts'); assert.equal(first.author, 'Marcos Squad'); assert.equal(first.license, '');
  const defaulted = imported.data.exercises.find(item => item.id === `marcos-youtube-${videoIds[1]}`);
  assert.equal(defaulted.category, 'Não classificado'); assert.equal(defaulted.equipment, 'A confirmar');
  assert.equal(defaulted.instructions, 'Assista à demonstração do professor e siga a prescrição individual.');
  const repeat = await api.request(importPath, { cookie: api.admin, method: 'POST', data: { items: [exercise(0, { name: 'Título que não deve substituir o anterior' })] } });
  assert.equal(repeat.status, 200); assert.equal(repeat.data.created, 0); assert.equal(repeat.data.skipped, 1); assert.equal(repeat.data.exercises[0].name, first.name);
  const after = await getFitnessCatalog(api.DB); assert.equal(after.exercises.length, before.exercises.length + 2);
  for (const item of before.exercises) assert.deepEqual(after.exercises.find(saved => saved.id === item.id), item);
  assert.deepEqual(after.foods, before.foods);
});

test('Shorts: duplicata já cadastrada na coleção não cria outro ID nem altera o exercício', async t => {
  const api = await fixture(t);
  const saved = { ...exercise(), id: 'custom-preserved-id', collection: 'marcos-shorts', channelUrl: MARCOS_CHANNEL_URL, category: 'Ombros', equipment: 'Halteres', instructions: '', author: 'Marcos Squad', license: '', licenseUrl: '' };
  api.sqlite.prepare("INSERT INTO fitness_catalog (id, kind, data) VALUES (?, 'exercise', ?)").run(saved.id, JSON.stringify(saved));
  const result = await api.request(importPath, { cookie: api.admin, method: 'POST', data: { items: [exercise(0, { name: 'Nome que não substitui o cadastro' })] } });
  assert.equal(result.status, 200); assert.equal(result.data.created, 0); assert.equal(result.data.skipped, 1); assert.deepEqual(result.data.exercises, [saved]);
  assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 1);
});

test('Shorts: lote faz rollback se uma inserção falha e importações concorrentes não duplicam', async t => {
  const api = await fixture(t);
  api.sqlite.exec(`CREATE TRIGGER reject_short BEFORE INSERT ON fitness_catalog WHEN NEW.id = 'marcos-youtube-${videoIds[1]}'
    BEGIN SELECT RAISE(ABORT, 'fixture import failure'); END;`);
  assert.equal((await api.request(importPath, { cookie: api.admin, method: 'POST', data: { items: [exercise(), exercise(1)] } })).status, 500);
  assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 0); api.sqlite.exec('DROP TRIGGER reject_short');
  const concurrent = await Promise.all(Array.from({ length: 2 }, () => api.request(importPath, { cookie: api.admin, method: 'POST', data: { items: [exercise()] } })));
  assert.deepEqual(concurrent.map(result => result.data.created).sort(), [0, 1]); assert.deepEqual(concurrent.map(result => result.status).sort(), [200, 201]);
  assert.equal(api.sqlite.prepare('SELECT count(*) AS n FROM fitness_catalog').get().n, 1);
});

test('Shorts: exercício importado pode ser prescrito e exibido ao aluno pelo mesmo ID', async t => {
  const api = await fixture(t); const student = await api.student();
  const imported = await api.request(importPath, { cookie: api.admin, method: 'POST', data: { items: [exercise()] } }); const item = imported.data.exercises[0];
  const saved = await api.request(`/fitness/coach/clients/${student.id}/workouts`, { cookie: api.admin, method: 'POST', data: {
    name: 'Treino de demonstração', days: [], notes: '', items: [{ exerciseId: item.id, sets: 3, reps: '10–12', rest: 60, load: '' }],
  } });
  assert.equal(saved.status, 201); const own = await api.request('/fitness/me', { cookie: student.cookie });
  assert.equal(own.data.workouts[0].items[0].exerciseId, item.id);
  const visible = await api.request('/fitness/catalog', { cookie: student.cookie }); assert.deepEqual(visible.data.exercises.find(exercise => exercise.id === item.id), item);
});

test('Shorts: mesmas consultas importam e repetem o lote em PostgreSQL real em memória', async t => {
  const { PGlite } = await import('@electric-sql/pglite'); const pg = new PGlite(); await pg.waitReady; t.after(() => pg.close());
  await pg.exec(`BEGIN; ${readFileSync(new URL('../supabase/migrations/202610220001_marcos_squad.sql', import.meta.url), 'utf8')} COMMIT;`);
  const DB = createPostgresDatabase({ pool: { async connect() { return {
    async query(sql, values = []) { const result = await pg.query(sql, values); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; }, release() {},
  }; } } });
  async function run() {
    const response = await handleFitness(new Request('https://shorts-test.example/api/fitness/coach/shorts/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ items: [exercise(), exercise(1)] }),
    }), { DB }, { isAdmin: true }); return { status: response.status, data: await response.json() };
  }
  const first = await run(); assert.equal(first.status, 201); assert.equal(first.data.created, 2);
  const second = await run(); assert.equal(second.status, 200); assert.equal(second.data.created, 0); assert.equal(second.data.skipped, 2);
  assert.equal((await pg.query('SELECT count(*)::integer AS n FROM marcos_squad.fitness_catalog')).rows[0].n, 2);
});
