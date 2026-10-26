import catalog from './fitness-catalog.json' with { type: 'json' };
import marcosShorts from './marcos-shorts.json' with { type: 'json' };
import { HttpError, assertSameOrigin } from '../cloudflare/auth.mjs';
import { todayInSaoPaulo } from './domain.mjs';
import { MARCOS_CHANNEL_URL, canonicalYoutubeUrl, youtubeVideoId } from '../shared/youtube.mjs';

const enc = new TextEncoder();
const DAY = 86400000;
const cookieName = 'ms_student';
const json = (body, status = 200, headers = {}) => new Response(body === null ? null : JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers },
});
const fail = (message, status = 400) => { throw new HttpError(status, message); };
const object = (value) => { if (!value || typeof value !== 'object' || Array.isArray(value)) fail('Confira os dados da prescrição.'); return value; };
const uid = () => crypto.randomUUID();
const randomToken = () => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24)))).replaceAll('+', '-').replaceAll('/', '_');
const hash = async (text) => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(text))), b => b.toString(16).padStart(2, '0')).join('');
const text = (value, label, max = 120, optional = false) => {
  if (typeof value !== 'string' || value.trim().length > max || (!optional && !value.trim())) fail(`Confira ${label}.`);
  return value.trim();
};
const num = (value, label, min, max) => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) fail(`Confira ${label}.`);
  return value;
};
const list = (value, label, max, min = 1) => {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(`Confira ${label}.`);
  return value;
};
const cookie = (request, token, age = 30 * 86400) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
function readCookie(request) {
  const values = (request.headers.get('cookie') || '').split(';').map(x => x.trim()).filter(x => x.startsWith(`${cookieName}=`));
  const token = values.length === 1 ? values[0].slice(cookieName.length + 1) : '';
  return /^[A-Za-z0-9_-]{32}$/.test(token) ? token : '';
}
async function readBody(request, limit = 32768) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') || '')) fail('Envie os dados em JSON.', 415);
  const reader = request.body?.getReader();
  if (!reader) fail('Envie os dados do formulário.');
  let size = 0; const chunks = [];
  try {
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.length; if (size > limit) { await reader.cancel(); fail('A foto ou os dados ultrapassam o limite permitido.', 413); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { const value = JSON.parse(new TextDecoder().decode(bytes)); if (!value || Array.isArray(value) || typeof value !== 'object') throw new Error(); return value; }
  catch { fail('Dados inválidos. Confira o formulário.'); }
}

export async function getFitnessCatalog(db) {
  const custom = (await db.prepare('SELECT kind, data FROM fitness_catalog ORDER BY id').all()).results;
  const exercises = [...new Map([
    ...marcosShorts.exercises, ...catalog.exercises,
    ...custom.filter(x => x.kind === 'exercise').map(x => JSON.parse(x.data)),
  ].map(x => [x.id, x])).values()];
  return {
    exercises: [...exercises.filter(x => x.collection === 'marcos-shorts'), ...exercises.filter(x => x.collection !== 'marcos-shorts')],
    foods: [...catalog.foods, ...custom.filter(x => x.kind === 'food').map(x => JSON.parse(x.data))],
    youtubeChannel: { url: MARCOS_CHANNEL_URL, name: marcosShorts.name },
  };
}
export function normalizeVideoUrl(value) {
  const supplied = text(value, 'o endereço HTTPS do vídeo', 500);
  let url; try { url = new URL(supplied); } catch { fail('Informe um endereço HTTPS de vídeo.'); }
  if (url.protocol !== 'https:' || url.username || url.password) fail('Use um endereço HTTPS de vídeo.');
  if (['youtube.com', 'www.youtube.com', 'm.youtube.com', 'youtu.be', 'www.youtube-nocookie.com'].includes(url.hostname)) {
    const normalized = canonicalYoutubeUrl(supplied);
    if (!normalized) fail('Cole o link de um vídeo específico do YouTube, em vez do canal ou da busca.');
    return normalized;
  }
  if (!/\.(mp4|webm)$/i.test(url.pathname)) fail('Use um vídeo MP4/WebM HTTPS ou um link do YouTube.');
  return url.href;
}
function shortExercise(value) {
  object(value);
  const videoUrl = canonicalYoutubeUrl(text(value.videoUrl, 'o link do Short', 500));
  if (!videoUrl) fail('Cole o link HTTPS de um vídeo específico do YouTube.');
  const videoId = youtubeVideoId(videoUrl);
  const optional = (field, label, max, fallback) => text(field ?? '', label, max, true) || fallback;
  return {
    id: `marcos-youtube-${videoId}`,
    name: text(value.name, 'o nome do exercício'),
    category: optional(value.category, 'o grupo muscular', 60, 'Não classificado'),
    equipment: optional(value.equipment, 'o equipamento', 80, 'A confirmar'),
    instructions: optional(value.instructions, 'as orientações', 2000, 'Assista à demonstração do professor e siga a prescrição individual.'),
    videoUrl, sourceUrl: `https://www.youtube.com/shorts/${videoId}`,
    author: 'Marcos Squad', license: '', licenseUrl: '',
    collection: 'marcos-shorts', channelUrl: MARCOS_CHANNEL_URL,
  };
}

async function importShorts(db, input) {
  // Validate every row before the batch can write any record.
  const rows = list(input.items, 'a lista de Shorts (1 a 50)', 50).map(shortExercise);
  const current = await getFitnessCatalog(db);
  const existingById = new Map(current.exercises.map(exercise => [exercise.id, exercise]));
  const existingByVideo = new Map(current.exercises.filter(exercise => exercise.collection === 'marcos-shorts')
    .map(exercise => [youtubeVideoId(exercise.videoUrl), exercise]));
  const requestedIds = new Set(); const pending = [];
  for (const exercise of rows) {
    const existing = existingById.get(exercise.id) || existingByVideo.get(youtubeVideoId(exercise.videoUrl));
    if (existing) { requestedIds.add(existing.id); continue; }
    // Also deduplicate alternate share links inside the submitted batch.
    existingById.set(exercise.id, exercise);
    existingByVideo.set(youtubeVideoId(exercise.videoUrl), exercise);
    requestedIds.add(exercise.id); pending.push(exercise);
  }
  let created = 0;
  if (pending.length) {
    // The stable ID and conflict rule make concurrent/repeated imports safe,
    // while the atomic batch prevents partially inserted libraries.
    const results = await db.batch(pending.map(exercise => db.prepare(
      "INSERT INTO fitness_catalog (id, kind, data) VALUES (?, 'exercise', ?) ON CONFLICT(id) DO NOTHING",
    ).bind(exercise.id, JSON.stringify(exercise))));
    created = results.reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
  }
  const saved = await getFitnessCatalog(db);
  return json({ created, skipped: rows.length - created, exercises: saved.exercises.filter(exercise => requestedIds.has(exercise.id)) }, created ? 201 : 200);
}
export function nutrition(items, foods) {
  const totals = { kcal: 0, protein: 0, carbs: 0, fat: 0 };
  for (const item of items) {
    const food = foods.find(x => x.id === item.foodId);
    if (!food) fail('Um alimento não foi encontrado. Atualize o catálogo.');
    for (const key of Object.keys(totals)) totals[key] += food[key] * item.grams / 100;
  }
  return Object.fromEntries(Object.entries(totals).map(([key, value]) => [key, Math.round(value * 10) / 10]));
}
export function validateWorkout(input, exercises) {
  object(input);
  const days = list(input.days, 'os dias de treino', 7, 0).map(x => num(x, 'o dia de treino', 0, 6));
  if (days.some(x => !Number.isInteger(x)) || new Set(days).size !== days.length) fail('Selecione dias diferentes.');
  return {
    name: text(input.name, 'o nome do treino'), days, notes: text(input.notes ?? '', 'as observações', 2000, true),
    items: list(input.items, 'os exercícios (1 a 30)', 30).map(item => {
      object(item);
      if (!exercises.some(x => x.id === item.exerciseId)) fail('Selecione um exercício do catálogo.');
      const sets = num(item.sets, 'as séries (1 a 20)', 1, 20);
      if (!Number.isInteger(sets)) fail('Informe um número inteiro de séries.');
      return { exerciseId: item.exerciseId, sets, reps: text(item.reps, 'as repetições', 40),
        rest: num(item.rest, 'o descanso em segundos', 0, 600), load: text(item.load ?? '', 'a carga / orientação', 120, true) };
    }),
  };
}
export function validateDiet(input, foods) {
  object(input);
  return {
    name: text(input.name, 'o nome do plano alimentar'), notes: text(input.notes ?? '', 'as orientações', 2000, true),
    meals: list(input.meals, 'as refeições (1 a 12)', 12).map(meal => {
      object(meal);
      const time = text(meal.time ?? '', 'o horário', 5, true);
      if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) fail('Informe um horário válido.');
      return { name: text(meal.name, 'o nome da refeição', 80), time,
        items: list(meal.items, 'os alimentos por refeição (1 a 20)', 20).map(item => {
          object(item);
          if (!foods.some(x => x.id === item.foodId)) fail('Selecione um alimento do catálogo.');
          return { foodId: item.foodId, grams: num(item.grams, 'a quantidade em gramas (0,1 a 5.000)', 0.1, 5000) };
        }) };
    }),
  };
}

async function studentSession(request, db) {
  const token = readCookie(request); if (!token) return null;
  return db.prepare(`SELECT a.client_id AS id, a.display_name AS name, a.community, c.end_date AS endDate
    FROM fitness_sessions s JOIN fitness_access a ON a.client_id = s.client_id
    JOIN clients c ON c.id = a.client_id WHERE s.token_hash = ? AND s.expires_at > ?`)
    .bind(await hash(token), Date.now()).first();
}
async function profileData(db, clientId, foods) {
  const workouts = (await db.prepare('SELECT id, data, updated_at FROM fitness_workouts WHERE client_id = ? ORDER BY updated_at, id').bind(clientId).all()).results
    .map(row => ({ ...JSON.parse(row.data), id: row.id, updatedAt: row.updated_at }));
  const dietRow = await db.prepare('SELECT data, updated_at FROM fitness_diets WHERE client_id = ?').bind(clientId).first();
  let diet = null;
  if (dietRow) {
    diet = { ...JSON.parse(dietRow.data), updatedAt: dietRow.updated_at };
    diet.meals = diet.meals.map(meal => ({ ...meal, totals: nutrition(meal.items, foods) }));
    diet.totals = nutrition(diet.meals.flatMap(x => x.items), foods);
  }
  const history = (await db.prepare('SELECT id, workout_id AS workoutId, workout_name AS name, day FROM fitness_logs WHERE client_id = ? ORDER BY created_at DESC LIMIT 60').bind(clientId).all()).results;
  return { workouts, diet, history };
}
function communityCursor(before) {
  if (!before) return { createdAt: '', id: '' };
  if (before.length > 200) fail('Atualize a comunidade para carregar as publicações.');
  // Accept the timestamp-only cursor issued by previous versions as well.
  let value = [before, ''];
  if (before.startsWith('[')) {
    try { value = JSON.parse(before); } catch { fail('Atualize a comunidade para carregar as publicações.'); }
  }
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value[0])
    || !Number.isFinite(Date.parse(value[0])) || typeof value[1] !== 'string' || value[1].length > 120) {
    fail('Atualize a comunidade para carregar as publicações.');
  }
  return { createdAt: value[0], id: value[1] };
}
async function communityData(db, studentId = '', before = '') {
  const cursor = communityCursor(before);
  const posts = (await db.prepare(`SELECT p.id, p.caption, p.created_at AS createdAt, a.display_name AS name,
    CASE WHEN length(p.image) > 0 THEN 1 ELSE 0 END AS hasImage, p.client_id AS authorId,
    (SELECT COUNT(*) FROM fitness_likes l JOIN fitness_access la ON la.client_id = l.client_id WHERE l.post_id = p.id AND la.community = 1) AS likes,
    EXISTS(SELECT 1 FROM fitness_likes WHERE post_id = p.id AND client_id = ?) AS liked
    FROM fitness_posts p JOIN fitness_access a ON a.client_id = p.client_id
    WHERE a.community = 1 AND (? = '' OR p.created_at < ? OR (p.created_at = ? AND p.id < ?))
    ORDER BY p.created_at DESC, p.id DESC LIMIT 21`)
    .bind(studentId, cursor.createdAt, cursor.createdAt, cursor.createdAt, cursor.id).all()).results;
  const hasMore = posts.length > 20;
  if (hasMore) posts.pop();
  for (const post of posts) {
    post.canDelete = !studentId || post.authorId === studentId;
    delete post.authorId;
    post.comments = (await db.prepare(`SELECT c.id, c.text, c.created_at AS createdAt, a.display_name AS name,
      CASE WHEN c.client_id = ? THEN 1 ELSE 0 END AS own FROM fitness_comments c
      JOIN fitness_access a ON a.client_id = c.client_id WHERE c.post_id = ? AND a.community = 1 ORDER BY c.created_at LIMIT 50`).bind(studentId, post.id).all()).results;
  }
  const last = posts.at(-1);
  return { posts, next: hasMore ? JSON.stringify([last.createdAt, last.id]) : null };
}

export async function handleFitness(request, env, { isAdmin = false, now = new Date() } = {}) {
  assertSameOrigin(request);
  const db = env.DB; const url = new URL(request.url); const path = url.pathname.replace(/^\/api\/fitness/, '');
  const method = request.method; const today = todayInSaoPaulo(now); const timestamp = now.toISOString();
  let student = await studentSession(request, db);
  if (path === '/auth/status' && method === 'GET') return json({ student });
  if (path === '/auth/login' && method === 'POST') {
    const ip = await hash(request.headers.get('CF-Connecting-IP') || 'unknown'); const time = Date.now();
    const results = await db.batch([
      db.prepare('DELETE FROM fitness_attempts WHERE reset_at <= ?').bind(time),
      db.prepare(`INSERT INTO fitness_attempts (ip_key, count, reset_at) VALUES (?, 1, ?)
        ON CONFLICT(ip_key) DO UPDATE SET count = MIN(count + 1, 11)`).bind(ip, time + 900000),
      db.prepare('SELECT count FROM fitness_attempts WHERE ip_key = ?').bind(ip),
    ]);
    if (results[2].results[0].count > 10) fail('Muitas tentativas. Tente novamente em 15 minutos.', 429);
    const input = await readBody(request);
    const supplied = text(input.code, 'o código de acesso', 64);
    const account = await db.prepare('SELECT client_id FROM fitness_access WHERE code_hash = ?').bind(await hash(supplied)).first();
    if (!account) fail('Código inválido. Solicite seu acesso ao professor.', 401);
    const token = randomToken();
    await db.batch([
      db.prepare('DELETE FROM fitness_sessions WHERE expires_at <= ?').bind(time),
      db.prepare('INSERT INTO fitness_sessions (token_hash, client_id, expires_at) VALUES (?, ?, ?)').bind(await hash(token), account.client_id, time + 30 * DAY),
    ]);
    return json({ authenticated: true }, 200, { 'Set-Cookie': cookie(request, token) });
  }
  if (path === '/auth/logout' && method === 'POST') {
    const token = readCookie(request);
    if (token) await db.prepare('DELETE FROM fitness_sessions WHERE token_hash = ?').bind(await hash(token)).run();
    return json(null, 204, { 'Set-Cookie': cookie(request, '', 0) });
  }
  const adminRoute = path.startsWith('/coach');
  if (adminRoute && !isAdmin) fail('Entre como consultor para gerenciar os alunos.', 401);
  if (!adminRoute && !isAdmin && !student) fail('Entre com seu código de aluno.', 401);
  const requireStudent = () => { if (!student) fail('Esta ação é exclusiva da área do aluno.', 403); return student; };
  const requireCommunity = () => { requireStudent(); if (!student.community) fail('Ative sua participação na comunidade para publicar e interagir.'); };
  if (path === '/catalog' && method === 'GET') return json(await getFitnessCatalog(db));
  if (path === '/coach/overview' && method === 'GET') {
    const clients = (await db.prepare(`SELECT c.id, c.name, c.end_date AS endDate, a.created_at AS accessCreated,
      (SELECT COUNT(*) FROM fitness_workouts w WHERE w.client_id = c.id) AS workouts,
      EXISTS(SELECT 1 FROM fitness_diets d WHERE d.client_id = c.id) AS hasDiet,
      (SELECT COUNT(DISTINCT day) FROM fitness_logs l WHERE l.client_id = c.id AND day >= ?) AS trainingDays
      FROM clients c LEFT JOIN fitness_access a ON a.client_id = c.id ORDER BY c.name`).bind(today.slice(0, 7) + '-01').all()).results;
    return json({ clients, today });
  }
  const accessRoute = path.match(/^\/coach\/clients\/([^/]+)\/access$/);
  if (accessRoute) {
    const client = await db.prepare('SELECT id, name FROM clients WHERE id = ?').bind(accessRoute[1]).first();
    if (!client) fail('Aluno não encontrado.', 404);
    if (method === 'POST') {
      const code = randomToken();
      await db.batch([
        db.prepare('DELETE FROM fitness_sessions WHERE client_id = ?').bind(client.id),
        db.prepare(`INSERT INTO fitness_access (client_id, code_hash, display_name, created_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(client_id) DO UPDATE SET code_hash = excluded.code_hash, created_at = excluded.created_at`)
          .bind(client.id, await hash(code), client.name.split(' ')[0], timestamp),
      ]);
      return json({ code, url: `${url.origin}/aluno` });
    }
    if (method === 'DELETE') {
      // Keep the student's history and posts; revoke the credential and all sessions.
      await db.batch([
        db.prepare('DELETE FROM fitness_sessions WHERE client_id = ?').bind(client.id),
        db.prepare('UPDATE fitness_access SET code_hash = ?, created_at = ? WHERE client_id = ?').bind(await hash(randomToken()), '', client.id),
      ]);
      return json(null, 204);
    }
  }
  const profileRoute = path.match(/^\/coach\/clients\/([^/]+)$/);
  if (profileRoute && method === 'GET') {
    if (!await db.prepare('SELECT id FROM clients WHERE id = ?').bind(profileRoute[1]).first()) fail('Aluno não encontrado.', 404);
    return json(await profileData(db, profileRoute[1], (await getFitnessCatalog(db)).foods));
  }
  if (path === '/me' && method === 'GET') {
    requireStudent();
    const { trainingDays } = await db.prepare('SELECT COUNT(DISTINCT day) AS trainingDays FROM fitness_logs WHERE client_id = ? AND day >= ? AND day <= ?').bind(student.id, today.slice(0, 7) + '-01', today).first();
    return json({ student, today, trainingDays, ...await profileData(db, student.id, (await getFitnessCatalog(db)).foods) });
  }
  if (path === '/me/profile' && method === 'PUT') {
    requireStudent(); const input = await readBody(request);
    if (typeof input.community !== 'boolean') fail('Escolha se deseja participar da comunidade.');
    await db.prepare('UPDATE fitness_access SET display_name = ?, community = ? WHERE client_id = ?')
      .bind(text(input.name, 'o nome na comunidade', 50), input.community ? 1 : 0, student.id).run();
    return json({ saved: true });
  }
  if (path === '/coach/shorts/import' && method === 'POST') {
    return importShorts(db, await readBody(request));
  }
  if (path === '/coach/catalog' && method === 'POST') {
    const input = await readBody(request); let item; const id = uid();
    if (input.kind === 'food') {
      item = { id, name: text(input.name, 'o nome do alimento'), category: text(input.category, 'a categoria', 80),
        kcal: num(input.kcal, 'as kcal por 100 g', 0, 1000), protein: num(input.protein, 'as proteínas por 100 g', 0, 100),
        carbs: num(input.carbs, 'os carboidratos por 100 g', 0, 100), fat: num(input.fat, 'as gorduras por 100 g', 0, 100),
        source: 'Cadastro da consultoria' };
    } else if (input.kind === 'exercise') {
      const videoUrl = normalizeVideoUrl(input.videoUrl);
      item = { id, name: text(input.name, 'o nome do exercício'), category: text(input.category, 'o grupo muscular', 60),
        equipment: text(input.equipment, 'o equipamento', 80), instructions: text(input.instructions, 'a execução', 2000),
        videoUrl, author: 'Consultoria Marcos Squad', license: '', licenseUrl: '' };
    } else fail('Selecione alimento ou exercício.');
    await db.prepare('INSERT INTO fitness_catalog (id, kind, data) VALUES (?, ?, ?)').bind(id, input.kind, JSON.stringify(item)).run();
    return json(item, 201);
  }
  const exerciseVideoRoute = path.match(/^\/coach\/catalog\/([^/]+)\/video$/);
  if (exerciseVideoRoute && method === 'PUT') {
    const exercise = (await getFitnessCatalog(db)).exercises.find(x => x.id === exerciseVideoRoute[1]);
    if (!exercise) fail('Exercício não encontrado.', 404);
    const input = await readBody(request);
    let updated;
    if (input.restore === true) {
      updated = catalog.exercises.find(x => x.id === exercise.id);
      if (!updated) fail('Este exercício não tem vídeo original da biblioteca.');
    } else {
      updated = { ...exercise, videoUrl: normalizeVideoUrl(input.videoUrl), author: 'Vídeo selecionado pelo professor', license: '', licenseUrl: '', changes: '', sourceUrl: '' };
    }
    await db.prepare(`INSERT INTO fitness_catalog (id,kind,data) VALUES (?,'exercise',?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`)
      .bind(exercise.id, JSON.stringify(updated)).run();
    return json(updated);
  }
  const workoutRoute = path.match(/^\/coach\/clients\/([^/]+)\/workouts(?:\/([^/]+))?$/);
  if (workoutRoute) {
    const [, clientId, id] = workoutRoute;
    if (!await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) fail('Aluno não encontrado.', 404);
    if (id && !await db.prepare('SELECT id FROM fitness_workouts WHERE id = ? AND client_id = ?').bind(id, clientId).first()) fail('Treino não encontrado.', 404);
    if (method === 'DELETE' && id) { await db.prepare('DELETE FROM fitness_workouts WHERE id = ? AND client_id = ?').bind(id, clientId).run(); return json(null, 204); }
    if ((method === 'POST' && !id) || (method === 'PUT' && id)) {
      const data = validateWorkout(await readBody(request), (await getFitnessCatalog(db)).exercises); const workoutId = id || uid();
      if (!id && (await db.prepare('SELECT COUNT(*) AS n FROM fitness_workouts WHERE client_id = ?').bind(clientId).first()).n >= 30) fail('Limite de 30 treinos por aluno.');
      await db.prepare(`INSERT INTO fitness_workouts (id, client_id, data, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`)
        .bind(workoutId, clientId, JSON.stringify(data), timestamp).run();
      return json({ id: workoutId, ...data }, id ? 200 : 201);
    }
  }
  const dietRoute = path.match(/^\/coach\/clients\/([^/]+)\/diet$/);
  if (dietRoute) {
    const clientId = dietRoute[1];
    if (!await db.prepare('SELECT id FROM clients WHERE id = ?').bind(clientId).first()) fail('Aluno não encontrado.', 404);
    if (method === 'PUT') {
      const data = validateDiet(await readBody(request), (await getFitnessCatalog(db)).foods);
      await db.prepare(`INSERT INTO fitness_diets (client_id, data, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(client_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`).bind(clientId, JSON.stringify(data), timestamp).run();
      return json(data);
    }
    if (method === 'DELETE') { await db.prepare('DELETE FROM fitness_diets WHERE client_id = ?').bind(clientId).run(); return json(null, 204); }
  }
  if (path === '/me/complete' && method === 'POST') {
    requireStudent(); const input = await readBody(request);
    const row = await db.prepare('SELECT data, updated_at FROM fitness_workouts WHERE id = ? AND client_id = ?').bind(text(input.workoutId, 'o treino', 60), student.id).first();
    if (!row) fail('Este treino não está atribuído a você.', 404);
    const workout = JSON.parse(row.data);
    if (input.updatedAt !== row.updated_at) fail('O professor atualizou este treino. Atualize a página para continuar.', 409);
    const completed = list(input.completed, 'os exercícios concluídos', 30);
    if (new Set(completed).size !== workout.items.length || completed.length !== workout.items.length || completed.some(x => !Number.isInteger(x) || x < 0 || x >= workout.items.length)) fail('Marque todos os exercícios antes de concluir.');
    await db.prepare('INSERT OR IGNORE INTO fitness_logs (id, client_id, workout_id, workout_name, day, created_at) VALUES (?, ?, ?, ?, ?, ?)')
      .bind(uid(), student.id, input.workoutId, workout.name, today, timestamp).run();
    return json({ saved: true, day: today });
  }
  if (path === '/ranking' && method === 'GET') {
    const monthStart = today.slice(0, 7) + '-01';
    const ranking = (await db.prepare(`SELECT a.display_name AS name, COUNT(DISTINCT l.day) AS days,
      CASE WHEN a.client_id = ? THEN 1 ELSE 0 END AS own
      FROM fitness_logs l JOIN fitness_access a ON a.client_id = l.client_id
      WHERE a.community = 1 AND l.day >= ? AND l.day <= ? GROUP BY a.client_id
      ORDER BY days DESC, MIN(l.created_at), a.display_name, a.client_id LIMIT 5`).bind(student?.id || '', monthStart, today).all()).results;
    return json({ ranking, month: today.slice(0, 7), rule: 'Um ponto por dia com treino concluído. Empates: quem começou antes no mês.' });
  }
  if (path === '/feed' && method === 'GET') return json(await communityData(db, isAdmin ? '' : student.id, url.searchParams.get('before') || ''));
  if (path === '/feed' && method === 'POST') {
    requireCommunity(); const input = await readBody(request, 300000);
    const caption = text(input.caption ?? '', 'a legenda', 2000, true); let image = input.image ?? '';
    if (typeof image !== 'string' || image.length > 250000) fail('A foto deve ter até 180 KB após compressão.');
    if (image) {
      if (!/^data:image\/jpeg;base64,\/9j\/[A-Za-z0-9+/=]+$/.test(image)) fail('Use uma foto JPEG válida.');
      let bytes; try { bytes = atob(image.split(',')[1]); } catch { fail('A foto é inválida.'); }
      if (bytes.length > 180000 || bytes.length < 100 || bytes.charCodeAt(bytes.length - 2) !== 255 || bytes.charCodeAt(bytes.length - 1) !== 217) fail('A foto é inválida ou grande demais.');
    }
    if (!caption && !image) fail('Adicione uma foto ou escreva uma mensagem.');
    const cutoff = new Date(now.getTime() - DAY).toISOString();
    const id = uid();
    const result = await db.prepare(`INSERT INTO fitness_posts (id, client_id, caption, image, created_at)
      SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM fitness_posts WHERE client_id = ? AND created_at > ?) < 5`)
      .bind(id, student.id, caption, image, timestamp, student.id, cutoff).run();
    if (!result.meta.changes) fail('Você pode publicar até 5 vezes a cada 24 horas.', 429);
    return json({ id }, 201);
  }
  const postRoute = path.match(/^\/feed\/([^/]+)(?:\/(like|comments))?$/);
  if (postRoute) {
    const [, id, action] = postRoute;
    const post = await db.prepare(`SELECT p.client_id FROM fitness_posts p JOIN fitness_access a ON a.client_id = p.client_id WHERE p.id = ? AND a.community = 1`).bind(id).first();
    if (!post) fail('Publicação não encontrada.', 404);
    if (!action && method === 'DELETE') {
      if (!isAdmin && post.client_id !== student.id) fail('Você só pode excluir suas publicações.', 403);
      await db.prepare('DELETE FROM fitness_posts WHERE id = ?').bind(id).run(); return json(null, 204);
    }
    if (action === 'like' && ['PUT', 'DELETE'].includes(method)) {
      requireCommunity();
      await db.prepare(method === 'PUT' ? 'INSERT OR IGNORE INTO fitness_likes (post_id, client_id) VALUES (?, ?)' : 'DELETE FROM fitness_likes WHERE post_id = ? AND client_id = ?').bind(id, student.id).run();
      return json({ liked: method === 'PUT' });
    }
    if (action === 'comments' && method === 'POST') {
      requireCommunity(); const input = await readBody(request); const comment = text(input.text, 'o comentário', 500);
      const result = await db.prepare(`INSERT INTO fitness_comments (id, post_id, client_id, text, created_at)
        SELECT ?, ?, ?, ?, ? WHERE (SELECT COUNT(*) FROM fitness_comments WHERE post_id = ?) < 50
        AND (SELECT COUNT(*) FROM fitness_comments WHERE client_id = ? AND created_at > ?) < 30`)
        .bind(uid(), id, student.id, comment, timestamp, id, student.id, new Date(now.getTime() - DAY).toISOString()).run();
      if (!result.meta.changes) fail('Limite de comentários atingido.', 429);
      return json({ saved: true }, 201);
    }
  }
  const commentRoute = path.match(/^\/comments\/([^/]+)$/);
  if (commentRoute && method === 'DELETE') {
    const comment = await db.prepare('SELECT client_id FROM fitness_comments WHERE id = ?').bind(commentRoute[1]).first();
    if (!comment) fail('Comentário não encontrado.', 404);
    if (!isAdmin && comment.client_id !== student.id) fail('Você só pode excluir seus comentários.', 403);
    await db.prepare('DELETE FROM fitness_comments WHERE id = ?').bind(commentRoute[1]).run();
    return json(null, 204);
  }
  const mediaRoute = path.match(/^\/media\/([^/]+)$/);
  if (mediaRoute && method === 'GET') {
    const row = await db.prepare(`SELECT p.image FROM fitness_posts p JOIN fitness_access a ON a.client_id = p.client_id WHERE p.id = ? AND a.community = 1`).bind(mediaRoute[1]).first();
    if (!row?.image) fail('Foto não encontrada.', 404);
    const bytes = Uint8Array.from(atob(row.image.split(',')[1]), c => c.charCodeAt(0));
    return new Response(bytes, { headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'" } });
  }
  fail('Rota não encontrada.', 404);
}
