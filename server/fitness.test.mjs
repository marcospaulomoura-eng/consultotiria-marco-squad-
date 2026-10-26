import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import worker from '../cloudflare/worker.mjs';
import { fitnessDatabase } from './fitness-local.mjs';
import { createApp } from './app.mjs';
import { getFitnessCatalog, normalizeVideoUrl, nutrition, validateDiet, validateWorkout } from './fitness-api.mjs';
import marcosShorts from './marcos-shorts.json' with { type: 'json' };

function setup(t) {
  const sqlite = new DatabaseSync(':memory:');
  const root = new URL('../cloudflare/migrations/', import.meta.url);
  for (const file of readdirSync(root).filter(x => x.endsWith('.sql')).sort()) sqlite.exec(readFileSync(new URL(file, root), 'utf8'));
  const DB = fitnessDatabase(sqlite); const env = { DB, DASHBOARD_PASSWORD: randomBytes(24).toString('hex') };
  t.after(() => sqlite.close());
  async function request(path, { cookie, data, method = 'GET', headers = {} } = {}) {
    const response = await worker.fetch(new Request(`https://squad.example/api${path}`, { method,
      headers: { ...headers, ...(cookie ? { cookie } : {}), ...(data !== undefined ? { 'content-type': 'application/json' } : {}) },
      body: data === undefined ? undefined : JSON.stringify(data),
    }), env);
    return { status: response.status, headers: response.headers, data: await response.json().catch(() => null) };
  }
  async function coach() { return (await request('/auth/login', { method: 'POST', data: { password: env.DASHBOARD_PASSWORD } })).headers.get('set-cookie').split(';')[0]; }
  function client(id) {
    sqlite.prepare(`INSERT INTO clients (id,name,plan,service,amount_cents,start_date,end_date,created_at,updated_at,phone,notes)
      VALUES (?,?,'Semestral','Treino + dieta',99790,'2026-01-01','2099-01-01','2026-01-01','2026-01-01','+5511999999999','private health note')`).run(id, `Aluno ${id}`);
  }
  async function access(id, admin) {
    const credential = await request(`/fitness/coach/clients/${id}/access`, { method: 'POST', cookie: admin, data: {} });
    assert.equal(credential.status, 200, JSON.stringify(credential.data));
    const login = await request('/fitness/auth/login', { method: 'POST', data: { code: credential.data.code } });
    assert.equal(login.status, 200); return { code: credential.data.code, cookie: login.headers.get('set-cookie').split(';')[0] };
  }
  return { sqlite, DB, env, request, coach, client, access };
}
const workout = { name: 'A · Inferiores', days: [1, 3, 5], notes: 'Controle a descida.', items: [{ exerciseId: 'wger-371', sets: 3, reps: '10–12', rest: 60, load: '20 kg' }] };
const diet = { name: 'Plano individual', notes: '', meals: [{ name: 'Almoço', time: '12:30', items: [{ foodId: 'taco-3', grams: 150 }] }] };

test('catálogo inclui vídeos locais e TACO; cálculo em gramas e validação impedem prescrição inválida', async t => {
  const api = setup(t); const catalog = await getFitnessCatalog(api.DB);
  assert.equal(catalog.exercises.length, 45 + marcosShorts.exercises.length); assert.equal(catalog.foods.length, 591);
  const localExercises = catalog.exercises.filter(exercise => exercise.id.startsWith('wger-'));
  assert.equal(localExercises.length, 45);
  for (const ex of localExercises) {
    assert.match(ex.videoUrl, /^\/videos\/wger-\d+\.mp4$/);
    assert.ok(readFileSync(new URL(`../public${ex.videoUrl}`, import.meta.url)).length > 100);
    assert.equal(ex.license, 'CC BY-SA 4.0');
  }
  assert.deepEqual(nutrition(diet.meals[0].items, catalog.foods), { kcal: 192, protein: 3.8, carbs: 42.2, fat: 0.3 });
  assert.throws(() => validateDiet({ ...diet, meals: [{ ...diet.meals[0], items: [{ foodId: 'taco-3', grams: -1 }] }] }, catalog.foods));
  assert.throws(() => validateDiet({ ...diet, meals: [null] }, catalog.foods));
  assert.throws(() => validateDiet({ ...diet, meals: [{ ...diet.meals[0], time: '99:90' }] }, catalog.foods));
  assert.throws(() => validateWorkout({ ...workout, days: [1, 1] }, catalog.exercises));
  assert.throws(() => validateWorkout({ ...workout, items: [null] }, catalog.exercises));
});

test('aluno só acessa suas prescrições; código é armazenado como hash e redefinir revoga sessões', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); api.client('b');
  const a = await api.access('a', admin); const b = await api.access('b', admin);
  assert.notEqual(api.sqlite.prepare('SELECT code_hash FROM fitness_access WHERE client_id = ?').get('a').code_hash, a.code);
  assert.equal((await api.request('/fitness/catalog')).status, 401);
  assert.equal((await api.request('/dashboard', { cookie: a.cookie })).status, 401);
  assert.equal((await api.request('/fitness/coach/overview', { cookie: a.cookie })).status, 401);
  assert.equal((await api.request('/fitness/coach/clients/b', { cookie: a.cookie })).status, 401);
  await api.request('/fitness/coach/clients/a/workouts', { cookie: admin, method: 'POST', data: workout });
  await api.request('/fitness/coach/clients/a/diet', { cookie: admin, method: 'PUT', data: diet });
  const own = await api.request('/fitness/me', { cookie: a.cookie });
  assert.equal(own.data.workouts.length, 1); assert.equal(own.data.diet.totals.kcal, 192);
  assert.doesNotMatch(JSON.stringify(own.data), /private health note|phone|amount_cents|code_hash|99790/);
  assert.equal((await api.request('/fitness/me', { cookie: b.cookie })).data.workouts.length, 0);
  const otherComplete = await api.request('/fitness/me/complete', { cookie: b.cookie, method: 'POST', data: { workoutId: own.data.workouts[0].id, completed: [0], updatedAt: own.data.workouts[0].updatedAt } });
  assert.equal(otherComplete.status, 404);
  const newAccess = await api.request('/fitness/coach/clients/a/access', { cookie: admin, method: 'POST', data: {} });
  assert.notEqual(newAccess.data.code, a.code);
  assert.equal((await api.request('/fitness/me', { cookie: a.cookie })).status, 401);
  assert.equal((await api.request('/fitness/auth/login', { method: 'POST', data: { code: a.code } })).status, 401);
  const again = await api.access('a', admin);
  await api.request('/fitness/coach/clients/a/access', { cookie: admin, method: 'DELETE' });
  assert.equal((await api.request('/fitness/me', { cookie: again.cookie })).status, 401);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS n FROM fitness_workouts WHERE client_id = ?').get('a').n, 1);
});

test('conclusão exige todos os exercícios e versão atual; ranking usa dias distintos, mês corrente e no máximo cinco', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); const a = await api.access('a', admin);
  const saved = await api.request('/fitness/coach/clients/a/workouts', { cookie: admin, method: 'POST', data: workout });
  const me = (await api.request('/fitness/me', { cookie: a.cookie })).data;
  const complete = { workoutId: saved.data.id, completed: [0], updatedAt: me.workouts[0].updatedAt };
  assert.equal((await api.request('/fitness/me/complete', { cookie: a.cookie, method: 'POST', data: { ...complete, completed: [] } })).status, 400);
  assert.equal((await api.request('/fitness/me/complete', { cookie: a.cookie, method: 'POST', data: { ...complete, updatedAt: 'old' } })).status, 409);
  for (let i = 0; i < 3; i++) assert.equal((await api.request('/fitness/me/complete', { cookie: a.cookie, method: 'POST', data: complete })).status, 200);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS n FROM fitness_logs').get().n, 1);
  assert.equal((await api.request('/fitness/ranking', { cookie: a.cookie })).data.ranking.length, 0);
  await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Ana', community: true } });
  const today = me.today;
  api.sqlite.prepare(`INSERT INTO fitness_logs VALUES ('second','a','other','B',?,?)`).run(today, `${today}T13:00:00Z`);
  assert.equal((await api.request('/fitness/ranking', { cookie: a.cookie })).data.ranking[0].days, 1);
  for (let i = 0; i < 7; i++) {
    const id = `rank-${i}`; api.client(id);
    api.sqlite.prepare('INSERT INTO fitness_access (client_id,code_hash,display_name,created_at,community) VALUES (?,?,?,?,1)').run(id, id, `Aluno ${i}`, today);
    api.sqlite.prepare('INSERT INTO fitness_logs VALUES (?,?,?,?,?,?)').run(id, id, 'x', 'A', today, `${today}T12:00:00Z`);
  }
  api.sqlite.prepare('INSERT INTO fitness_logs VALUES (?,?,?,?,?,?)').run('old', 'a', 'old', 'A', '2000-01-01', '2000-01-01');
  const rank = (await api.request('/fitness/ranking', { cookie: a.cookie })).data;
  assert.equal(rank.ranking.length, 5); assert.ok(rank.ranking.every(x => x.days === 1));
});

test('feed exige participação, limita posts, protege fotos, comentários e exclusões; professor pode moderar', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); api.client('b');
  const a = await api.access('a', admin); const b = await api.access('b', admin);
  assert.equal((await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: 'Treinei!' } })).status, 400);
  for (const user of [a, b]) await api.request('/fitness/me/profile', { cookie: user.cookie, method: 'PUT', data: { name: user === a ? 'Ana' : 'Bia', community: true } });
  assert.equal((await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: 'teste', image: 'data:image/svg+xml;base64,abc' } })).status, 400);
  const made = await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: 'Primeiro treino!' } });
  assert.equal(made.status, 201);
  const id = made.data.id;
  for (let i = 0; i < 2; i++) await api.request(`/fitness/feed/${id}/like`, { cookie: b.cookie, method: 'PUT' });
  await api.request(`/fitness/feed/${id}/comments`, { cookie: b.cookie, method: 'POST', data: { text: 'Vamos!' } });
  const feed = (await api.request('/fitness/feed', { cookie: a.cookie })).data;
  assert.equal(feed.posts[0].likes, 1); assert.equal(feed.posts[0].comments.length, 1);
  assert.equal((await api.request(`/fitness/comments/${feed.posts[0].comments[0].id}`, { cookie: a.cookie, method: 'DELETE' })).status, 403);
  assert.equal((await api.request(`/fitness/feed/${id}`, { cookie: b.cookie, method: 'DELETE' })).status, 403);
  for (let i = 1; i < 5; i++) assert.equal((await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: `Post ${i}` } })).status, 201);
  assert.equal((await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: 'Sexto' } })).status, 429);
  await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Ana', community: false } });
  assert.equal((await api.request('/fitness/feed', { cookie: b.cookie })).data.posts.length, 0);
  await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Ana', community: true } });
  assert.equal((await api.request(`/fitness/feed/${id}`, { cookie: admin, method: 'DELETE' })).status, 204);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS n FROM fitness_comments').get().n, 0);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS n FROM fitness_likes').get().n, 0);
});

for (const sameTimestamp of [true, false]) test(`feed pagina sem perder ou repetir publicações com ${sameTimestamp ? 'horários iguais' : 'horários diferentes'}`, async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); const a = await api.access('a', admin);
  await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Ana', community: true } });
  // Insert fixtures directly: pagination must cover more than the daily posting limit.
  const insert = api.sqlite.prepare('INSERT INTO fitness_posts (id, client_id, caption, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 41; i++) insert.run(`post-${String(i).padStart(2, '0')}`, 'a', `Post ${i}`,
    new Date(Date.UTC(2026, 9, 20, 12, sameTimestamp ? 0 : i)).toISOString());
  const expected = api.sqlite.prepare('SELECT id FROM fitness_posts ORDER BY created_at DESC, id DESC').all().map(row => row.id);
  const seen = []; let before = ''; const sizes = [];
  for (let page = 0; page < 3; page++) {
    const result = await api.request(`/fitness/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`, { cookie: page === 1 ? admin : a.cookie });
    assert.equal(result.status, 200);
    sizes.push(result.data.posts.length); seen.push(...result.data.posts.map(post => post.id));
    if (page < 2) assert.equal(typeof result.data.next, 'string');
    else assert.equal(result.data.next, null);
    before = result.data.next;
  }
  assert.deepEqual(sizes, [20, 20, 1]);
  assert.deepEqual(seen, expected);
  assert.equal(new Set(seen).size, seen.length);
});

test('feed só oferece próxima página quando existe e aceita o cursor anterior por data', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); await api.access('a', admin);
  api.sqlite.prepare('UPDATE fitness_access SET community = 1 WHERE client_id = ?').run('a');
  assert.deepEqual((await api.request('/fitness/feed', { cookie: admin })).data, { posts: [], next: null });
  const createdAt = '2026-10-20T12:00:00.000Z';
  const insert = api.sqlite.prepare('INSERT INTO fitness_posts (id, client_id, caption, created_at) VALUES (?, ?, ?, ?)');
  for (let i = 0; i < 20; i++) insert.run(`post-${i}`, 'a', `Post ${i}`, createdAt);
  const full = await api.request('/fitness/feed', { cookie: admin });
  assert.equal(full.data.posts.length, 20); assert.equal(full.data.next, null);
  insert.run('older', 'a', 'Post anterior', '2026-10-19T12:00:00.000Z');
  const oldCursor = await api.request(`/fitness/feed?before=${encodeURIComponent(createdAt)}`, { cookie: admin });
  assert.equal(oldCursor.status, 200); assert.deepEqual(oldCursor.data.posts.map(post => post.id), ['older']);
  const first = (await api.request('/fitness/feed', { cookie: admin })).data;
  api.sqlite.prepare('DELETE FROM fitness_posts WHERE id = ?').run(first.posts.at(-1).id);
  const afterDeleted = await api.request(`/fitness/feed?before=${encodeURIComponent(first.next)}`, { cookie: admin });
  assert.equal(afterDeleted.status, 200); assert.deepEqual(afterDeleted.data.posts.map(post => post.id), ['older']);
  for (const invalid of ['invalid', '["2026-10-20T12:00:00.000Z"]', '["2026-10-20T12:00:00.000Z",null]', 'x'.repeat(201)]) {
    assert.equal((await api.request(`/fitness/feed?before=${encodeURIComponent(invalid)}`, { cookie: admin })).status, 400);
  }
});

test('acesso do aluno rejeita CSRF, limita tentativas e exclusão de cliente remove sessões e dados associados', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); const a = await api.access('a', admin);
  const blocked = await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Invadido', community: true }, headers: { Origin: 'https://evil.example' } });
  assert.equal(blocked.status, 403);
  for (let i = 0; i < 10; i++) await api.request('/fitness/auth/login', { method: 'POST', data: { code: 'wrong' }, headers: { 'CF-Connecting-IP': '192.0.2.22' } });
  assert.equal((await api.request('/fitness/auth/login', { method: 'POST', data: { code: a.code }, headers: { 'CF-Connecting-IP': '192.0.2.22' } })).status, 429);
  api.sqlite.prepare('DELETE FROM clients WHERE id = ?').run('a');
  assert.equal((await api.request('/fitness/me', { cookie: a.cookie })).status, 401);
  assert.equal(api.sqlite.prepare('SELECT COUNT(*) AS n FROM fitness_sessions').get().n, 0);
});

test('foto JPEG é persistida e só pode ser lida por pessoas autenticadas da consultoria', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); const a = await api.access('a', admin);
  await api.request('/fitness/me/profile', { cookie: a.cookie, method: 'PUT', data: { name: 'Ana', community: true } });
  // Minimal JPEG envelope; actual image decoding is exercised in the browser test.
  const bytes = Buffer.concat([Buffer.from([255,216,255]), Buffer.alloc(120), Buffer.from([255,217])]);
  const result = await api.request('/fitness/feed', { cookie: a.cookie, method: 'POST', data: { caption: 'Foto', image: `data:image/jpeg;base64,${bytes.toString('base64')}` } });
  assert.equal(result.status, 201);
  const path = `/api/fitness/media/${result.data.id}`;
  assert.equal((await worker.fetch(new Request(`https://squad.example${path}`), api.env)).status, 401);
  const image = await worker.fetch(new Request(`https://squad.example${path}`, { headers: { Cookie: a.cookie } }), api.env);
  assert.equal(image.headers.get('content-type'), 'image/jpeg'); assert.equal(image.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), bytes);
});

test('professor pode usar YouTube em exercícios existentes sem duplicá-los e restaurar o vídeo original', async t => {
  const api = setup(t); const admin = await api.coach(); api.client('a'); const a = await api.access('a', admin);
  const testId = 'abcdefghijk';
  for (const url of [`https://youtu.be/${testId}?si=share`, `https://youtube.com/shorts/${testId}`, `https://www.youtube.com/watch?v=${testId}&t=4`]) assert.equal(normalizeVideoUrl(url), `https://www.youtube.com/watch?v=${testId}`);
  for (const url of ['javascript:alert(1)', 'https://youtube.com/results?search_query=treino', 'https://youtube.com/@canal', 'https://evil.example/video', 'https://youtube.com/watch?v=wrong']) assert.throws(() => normalizeVideoUrl(url));
  const path = '/fitness/coach/catalog/wger-371/video';
  assert.equal((await api.request(path, { cookie: a.cookie, method: 'PUT', data: { videoUrl: `https://youtu.be/${testId}` } })).status, 401);
  const updated = await api.request(path, { cookie: admin, method: 'PUT', data: { videoUrl: `https://youtu.be/${testId}` } });
  assert.equal(updated.status, 200);
  const library = (await api.request('/fitness/catalog', { cookie: a.cookie })).data;
  assert.equal(library.exercises.length, 45 + marcosShorts.exercises.length); assert.equal(library.exercises.find(x => x.id === 'wger-371').videoUrl, `https://www.youtube.com/watch?v=${testId}`);
  assert.equal(library.exercises.find(x => x.id === 'wger-371').license, '');
  assert.equal((await api.request(path, { cookie: admin, method: 'PUT', data: { restore: true } })).data.videoUrl, '/videos/wger-371.mp4');
});

test('adapter local mantém os mesmos acessos e prescrições do Worker', async t => {
  const password = randomBytes(24).toString('hex');
  const local = createApp({ databasePath: ':memory:', seedDemo: false, serveFrontend: false, authOptions: { password, required: true } });
  const server = local.app.listen(0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); local.close(); });
  const url = `http://127.0.0.1:${server.address().port}`;
  const anonymous = await fetch(`${url}/api/fitness/catalog`); assert.equal(anonymous.status, 401);
  const login = await fetch(`${url}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password }) });
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const result = await fetch(`${url}/api/fitness/coach/overview`, { headers: { cookie } });
  assert.equal(result.status, 200); assert.deepEqual((await result.json()).clients, []);
  const catalog = await fetch(`${url}/api/fitness/catalog`, { headers: { cookie } }); assert.equal((await catalog.json()).foods.length, 591);
});
