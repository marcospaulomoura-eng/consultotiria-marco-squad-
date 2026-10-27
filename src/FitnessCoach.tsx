import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowRight, BookOpen, Check, Copy, Dumbbell, ExternalLink, KeyRound, Pencil, Plus, Search, Trash2, Users, Utensils, X } from 'lucide-react';
import { fitnessApi, format, initials, normalized } from './fitness-types';
import type { Catalog, CoachClient, Diet, Exercise, Prescription, Workout } from './fitness-types';
import { DietView, Empty, ExerciseVideo, Modal, WorkoutCard } from './FitnessShared';
import Community from './Community';
import ExerciseLibrary from './ExerciseLibrary';
import ShortsImport from './ShortsImport';
import { WorkoutEditor, DietEditor } from './PrescriptionEditors';
import './fitness.css';

const blankWorkout = (): Workout => ({ name: '', days: [], notes: '', items: [] });
const blankDiet = (): Diet => ({ name: 'Plano alimentar', notes: '', meals: [] });
type ClientSelection = { id: string };
type StudentAccess = { code: string; url: string };

export default function FitnessCoach({ section }: { section: 'training' | 'nutrition' | 'community' }) {
  const [catalog, setCatalog] = useState<Catalog | null>(null); const [clients, setClients] = useState<CoachClient[]>([]);
  const [selection, setSelection] = useState<ClientSelection>({ id: '' });
  const selectionRef = useRef(selection); const overviewRequest = useRef(0); const prescriptionRequest = useRef(0);
  const clientId = selection.id;
  const [loadedPrescription, setPrescription] = useState<{ selection: ClientSelection; value: Prescription } | null>(null);
  const prescription = loadedPrescription?.selection === selection ? loadedPrescription.value : null;
  const [tab, setTab] = useState(section === 'training' ? 'library' : 'plans'); const [query, setQuery] = useState(''); const [group, setGroup] = useState('');
  const [error, setError] = useState(''); const [notice, setNotice] = useState(''); const [busy, setBusy] = useState(false); const [loading, setLoading] = useState(true);
  const [video, setVideo] = useState<Exercise | null>(null); const [workout, setWorkout] = useState<Workout | null>(null); const [diet, setDiet] = useState<Diet | null>(null);
  const [custom, setCustom] = useState(false); const [loadedAccess, setAccess] = useState<(StudentAccess & { selection: ClientSelection }) | null>(null); const [grams, setGrams] = useState(100);
  const access = loadedAccess?.selection === selection ? loadedAccess : null;
  const [foodLimit, setFoodLimit] = useState(40); const [copied, setCopied] = useState(false);
  const [youtube, setYoutube] = useState<Exercise | null>(null);
  const [shortsImport, setShortsImport] = useState(false);
  const [pendingExercise, setPendingExercise] = useState<Exercise | null>(null);
  const reload = useCallback(async () => {
    const request = ++overviewRequest.current;
    const [library, overview] = await Promise.all([fitnessApi<Catalog>('/catalog'), fitnessApi<{ clients: CoachClient[] }>('/coach/overview')]);
    if (request === overviewRequest.current) { setCatalog(library); setClients(overview.clients); }
  }, []);
  const loadPrescription = useCallback(async (target: ClientSelection) => {
    const request = ++prescriptionRequest.current;
    try {
      const value = await fitnessApi<Prescription>(`/coach/clients/${target.id}`);
      if (selectionRef.current === target && request === prescriptionRequest.current) setPrescription({ selection: target, value });
    } catch (e) {
      if (selectionRef.current === target && request === prescriptionRequest.current) throw e;
    }
  }, []);
  useEffect(() => { let live = true; const timer = setTimeout(() => reload().catch(e => { if (live) setError(e.message); }).finally(() => { if (live) setLoading(false); }), 0); return () => { live = false; clearTimeout(timer); }; }, [reload]);
  async function refreshClient(target = selection) { await reload(); if (target.id && selectionRef.current === target) await loadPrescription(target); }
  async function refreshAfterSave(message: string, refresh: () => Promise<void> = reload, target = selection) {
    if (selectionRef.current === target) { setError(''); setNotice(message); }
    try { await refresh(); } catch {
      if (selectionRef.current === target) setError('A alteração foi salva, mas não foi possível atualizar a tela. Use Atualizar para carregar os dados salvos.');
    }
  }
  async function action(work: () => Promise<void>) {
    const target = selection;
    if (busy) return; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { if (selectionRef.current === target) setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } finally { setBusy(false); }
  }
  function selectClient(id: string) {
    // A new selection identity also invalidates an earlier A → B → A request.
    const next = { id }; selectionRef.current = next; setSelection(next);
    setPrescription(null); setAccess(null); setWorkout(null); setDiet(null); setNotice(''); setError(''); setCopied(false);
    if (id && pendingExercise) { setWorkout(workoutWithExercise(pendingExercise)); setPendingExercise(null); }
    if (id) void loadPrescription(next).catch(e => { if (selectionRef.current === next) setError(e.message); });
  }
  function updateClientAccess(target: ClientSelection, enabled: boolean) {
    setClients(current => current.map(client => client.id === target.id ? { ...client, accessCreated: enabled ? new Date().toISOString() : null } : client));
  }
  async function grantAccess(target: ClientSelection, rotating: boolean) {
    const value = await fitnessApi<StudentAccess>(`/coach/clients/${target.id}/access`, 'POST');
    updateClientAccess(target, true);
    if (selectionRef.current === target) { setAccess({ ...value, selection: target }); setCopied(false); }
    await refreshAfterSave(rotating ? 'Novo código gerado. Os acessos anteriores foram encerrados.' : 'Acesso liberado. Compartilhe o código individual com o aluno.', reload, target);
  }
  async function revokeAccess(target: ClientSelection) {
    await fitnessApi(`/coach/clients/${target.id}/access`, 'DELETE');
    updateClientAccess(target, false);
    if (selectionRef.current === target) setAccess(null);
    await refreshAfterSave('Acesso revogado.', reload, target);
  }
  async function copyAccess(target: ClientSelection, name: string, value: StudentAccess) {
    if (selectionRef.current === target) setCopied(false);
    try {
      await navigator.clipboard.writeText(`Olá, ${name.split(' ')[0]}! Seu acesso ao Marcos Squad está pronto.\n${value.url}\nCódigo individual: ${value.code}\nGuarde seu código e não compartilhe com outras pessoas.`);
    } catch { throw new Error('Não foi possível copiar automaticamente. Selecione e copie o código e o endereço exibidos no cartão.'); }
    if (selectionRef.current === target) setCopied(true);
  }
  const client = clients.find(c => c.id === clientId);
  function workoutWithExercise(exercise: Exercise): Workout {
    return { ...blankWorkout(), items: [{ exerciseId: exercise.id, sets: 3, reps: '10–12', rest: 60, load: '' }] };
  }
  function useExercise(exercise: Exercise) {
    setTab('plans'); setQuery(''); setGroup(''); setError(''); setNotice('');
    if (client) { setWorkout(workoutWithExercise(exercise)); setPendingExercise(null); }
    else setPendingExercise(exercise);
  }

  const filteredFoods = catalog?.foods.filter(f => (!group || f.category === group) && normalized(f.name).includes(normalized(query))) || [];
  if (section === 'community') return <div className="fitness-root"><Community /></div>;
  const isTraining = section === 'training';
  return <div className="fitness-root fit-coach">
    {(!isTraining || tab !== 'library') && <section className="fit-coach-banner"><div><span className="fit-kicker">MARCOS SQUAD · {isTraining ? 'PERFORMANCE' : 'NUTRIÇÃO'}</span><h2>{isTraining ? 'Planeje. Acompanhe. Evolua.' : 'Precisão em cada refeição.'}</h2><p>{isTraining ? 'Da prescrição ao último movimento, tudo conectado ao seu aluno.' : 'Monte planos em gramas e acompanhe calorias e macronutrientes.'}</p></div><div className="fit-banner-stat">{isTraining ? <Dumbbell /> : <Utensils />}<strong>{catalog ? isTraining ? catalog.exercises.length : catalog.foods.length : '—'}</strong><span>{isTraining ? 'exercícios com vídeo' : 'alimentos no catálogo'}</span></div></section>}
    <div className="fit-tabs"><button className={tab === 'plans' ? 'active' : ''} onClick={() => { setTab('plans'); setQuery(''); setGroup(''); }}><Users size={16} /> {isTraining ? 'Treinos dos alunos' : 'Planos alimentares'}</button><button className={tab === 'library' ? 'active' : ''} onClick={() => { setTab('library'); setQuery(''); setGroup(''); }}><BookOpen size={16} /> {isTraining ? 'Biblioteca de exercícios' : 'Tabela de alimentos'}</button></div>
    {error && <div className="fit-error" role="alert">{error}<button onClick={() => void action(refreshClient)}>Atualizar</button></div>}{notice && <p className="fit-success" role="status">{notice}</p>}
    {loading ? <p className="fit-muted">Preparando sua biblioteca…</p> : !catalog ? <Empty title="Não foi possível carregar">Use Atualizar para tentar novamente.</Empty> : tab === 'library' ? <>
      {isTraining ? <ExerciseLibrary exercises={catalog.exercises} onVideo={setVideo} onUse={useExercise} onChangeVideo={setYoutube} onImport={() => setShortsImport(true)} onCustom={() => setCustom(true)} /> : <>
      <div className="fit-toolbar"><label className="fit-search"><Search size={17} /><input placeholder="Buscar alimento, ex.: arroz cozido…" aria-label="Buscar na biblioteca" value={query} onChange={e => { setQuery(e.target.value); setFoodLimit(40); }} /></label><select aria-label="Filtrar categoria" value={group} onChange={e => { setGroup(e.target.value); setFoodLimit(40); }}><option value="">Todas as categorias</option>{[...new Set(catalog.foods.map(food => food.category))].sort().map(category => <option key={category}>{category}</option>)}</select><button className="fit-btn" onClick={() => setCustom(true)}><Plus size={17} /> Novo alimento</button></div>
        <div className="fit-food-reference"><div><strong>Tabela nutricional em gramas</strong><p>Base TACO / NEPA–UNICAMP, 4ª edição. Cadastre também alimentos e suplementos do seu dia a dia.</p></div><label>Simular porção<input type="number" min="0.1" max="5000" step="0.1" value={grams} onChange={e => setGrams(Math.min(5000, Math.max(0, Number(e.target.value))))} /><span>g</span></label></div>
        <div className="fit-table-wrap"><table className="fit-table"><thead><tr><th>Alimento / preparo</th><th>Energia</th><th>Proteínas</th><th>Carboidratos</th><th>Gorduras</th></tr></thead><tbody>{filteredFoods.slice(0, foodLimit).map(food => <tr key={food.id}><td><strong>{food.name}</strong><small>{food.category}</small></td>{(['kcal', 'protein', 'carbs', 'fat'] as const).map(k => <td key={k} className={k === 'kcal' ? 'fit-kcal-cell' : ''}>{food.traceFields?.includes(k) ? '—' : `${format(food[k] * grams / 100)} ${k === 'kcal' ? 'kcal' : 'g'}`}</td>)}</tr>)}</tbody></table></div><div className="fit-library-meta"><span>{Math.min(foodLimit, filteredFoods.length)} de {filteredFoods.length} alimentos · porção de {format(grams)} g</span>{foodLimit < filteredFoods.length && <button className="fit-btn secondary" onClick={() => setFoodLimit(n => n + 80)}>Carregar mais alimentos</button>}</div><p className="fit-credit">Valores aproximados por parte comestível. “—” indica valor não informado na fonte. Confira se o alimento está cru ou cozido antes de prescrever. <a href="https://www.nepa.unicamp.br/taco/" target="_blank" rel="noreferrer">Consultar a fonte TACO ↗</a></p>{!filteredFoods.length && <Empty icon="diet" title="Nenhum alimento encontrado">Tente outro termo ou cadastre um alimento personalizado.</Empty>}
      </>}
    </> : <>
      {pendingExercise && <div className="fit-pending-exercise" role="status"><span><strong>{pendingExercise.name}</strong>Selecione o aluno para montar um treino com este exercício.</span><button type="button" onClick={() => setPendingExercise(null)}>Cancelar</button></div>}
      <div className="fit-toolbar"><label className="fit-client-select"><Users size={17} /><select aria-label="Selecionar aluno" value={clientId} onChange={e => selectClient(e.target.value)}><option value="">Selecione um aluno para {isTraining ? 'montar o treino' : 'montar a dieta'}</option>{clients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label><a className="fit-btn secondary" href="/aluno" target="_blank" rel="noreferrer">Área do aluno <ExternalLink size={15} /></a></div>
      {!client ? <><div className="fit-section-head"><div><h2>Seus alunos, seu acompanhamento.</h2><p>Selecione um aluno para prescrever e liberar o acesso individual.</p></div><span className="fit-badge">{clients.length} alunos</span></div><div className="fit-client-grid">{clients.map(c => <button className="fit-client-card" key={c.id} onClick={() => selectClient(c.id)}><span className="fit-avatar">{initials(c.name)}</span><strong>{c.name}</strong><span>{isTraining ? `${c.workouts} treino(s) prescrito(s)` : c.hasDiet ? 'Plano alimentar disponível' : 'Sem plano alimentar'}</span><div><small>{c.trainingDays} dias treinados no mês</small><ArrowRight size={17} /></div></button>)}</div>{!clients.length && <Empty title="Cadastre seu primeiro aluno">Use a aba Clientes do painel. O cadastro aparecerá aqui para receber treinos, dieta e acesso individual.</Empty>}</> : <>
        <div className="fit-student-heading"><span className="fit-avatar">{initials(client.name)}</span><div><h2>{client.name}</h2><p>{client.trainingDays} dias treinados neste mês · {client.accessCreated ? 'Acesso do aluno liberado' : 'Acesso ainda não liberado'}</p></div><div className="fit-student-actions"><button className="fit-btn secondary" disabled={busy} onClick={() => { if (!client.accessCreated || confirm('Gerar um novo código encerra os acessos anteriores deste aluno. Continuar?')) void action(() => grantAccess(selection, !!client.accessCreated)); }}><KeyRound size={16} /> {client.accessCreated ? 'Novo código' : 'Liberar acesso'}</button>{client.accessCreated && <button className="fit-icon-btn" title="Revogar acesso do aluno" aria-label="Revogar acesso do aluno" disabled={busy} onClick={() => { if (confirm('Revogar o acesso deste aluno? Os treinos e o histórico serão mantidos.')) void action(() => revokeAccess(selection)); }}><X size={18} /></button>}</div></div>
        {access && <div className="fit-access-card"><KeyRound /><div><strong>Código pessoal de {client.name}</strong><p>Compartilhe individualmente. Este código só é exibido agora.</p><code>{access.code}</code><a href={access.url} target="_blank" rel="noreferrer">{access.url}</a></div><button className="fit-btn" onClick={() => void action(() => copyAccess(selection, client.name, access))}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? 'Copiado' : 'Copiar acesso'}</button></div>}
        {!prescription ? <p className="fit-muted">Carregando a prescrição…</p> : isTraining ? <><div className="fit-section-head"><h2>Programação de treinos</h2><button className="fit-btn" onClick={() => setWorkout(blankWorkout())}><Plus size={17} /> Novo treino</button></div><div className="fit-workout-grid">{prescription.workouts.map(w => <WorkoutCard key={w.id} workout={w} exercises={catalog.exercises} onVideo={setVideo}><button className="fit-btn secondary" onClick={() => setWorkout(structuredClone(w))}><Pencil size={15} /> Editar</button><button className="fit-icon-btn" aria-label={`Excluir ${w.name}`} disabled={busy} onClick={() => { if (confirm(`Excluir o treino ${w.name}? O histórico será preservado.`)) void action(async () => { const target = selection; await fitnessApi(`/coach/clients/${target.id}/workouts/${w.id}`, 'DELETE'); await refreshClient(target); }); }}><Trash2 size={16} /></button></WorkoutCard>)}</div>{!prescription.workouts.length && <Empty title="O próximo treino começa aqui">Crie uma ficha com exercícios, séries, repetições, carga e descanso. O aluno recebe a atualização no próprio acesso.</Empty>}<section className="fit-panel fit-coach-history"><h3>Últimos treinos registrados</h3>{prescription.history.length ? prescription.history.slice(0, 10).map(h => <div className="fit-history-row" key={h.id}><Check size={16} /><strong>{h.name}</strong><span>{new Date(`${h.day}T12:00:00`).toLocaleDateString('pt-BR')}</span></div>) : <p className="fit-muted">O aluno ainda não registrou um treino.</p>}</section></> : <><div className="fit-section-head"><h2>Prescrição alimentar</h2><div className="fit-inline-actions"><button className="fit-btn" onClick={() => setDiet(prescription.diet ? structuredClone(prescription.diet) : blankDiet())}>{prescription.diet ? <Pencil size={16} /> : <Plus size={16} />}{prescription.diet ? 'Editar plano' : 'Montar plano alimentar'}</button>{prescription.diet && <button className="fit-icon-btn" aria-label="Excluir plano alimentar" onClick={() => { if (confirm('Remover o plano alimentar deste aluno?')) void action(async () => { const target = selection; await fitnessApi(`/coach/clients/${target.id}/diet`, 'DELETE'); await refreshClient(target); }); }}><Trash2 size={16} /></button>}</div></div><DietView diet={prescription.diet} foods={catalog.foods} /></>}
      </>}
    </>}
    {shortsImport && <ShortsImport close={() => setShortsImport(false)} onImported={reload} />}
    {video && <ExerciseVideo exercise={video} close={() => setVideo(null)} />}
    {youtube && <YouTubeEditor exercise={youtube} close={() => setYoutube(null)} save={async input => { await fitnessApi(`/coach/catalog/${youtube.id}/video`, 'PUT', input); setYoutube(null); await refreshAfterSave('Vídeo atualizado em todos os treinos que usam este exercício.'); }} />}
    {workout && catalog && <WorkoutEditor value={workout} setValue={setWorkout} exercises={catalog.exercises} close={() => setWorkout(null)} save={async () => { const target = selection; await fitnessApi(`/coach/clients/${target.id}/workouts${workout.id ? `/${workout.id}` : ''}`, workout.id ? 'PUT' : 'POST', workout); if (selectionRef.current === target) setWorkout(null); await refreshAfterSave('Treino salvo e disponível para o aluno.', () => refreshClient(target), target); }} />}
    {diet && catalog && <DietEditor value={diet} setValue={setDiet} foods={catalog.foods} close={() => setDiet(null)} save={async () => { const target = selection; await fitnessApi(`/coach/clients/${target.id}/diet`, 'PUT', diet); if (selectionRef.current === target) setDiet(null); await refreshAfterSave('Plano alimentar salvo e disponível para o aluno.', () => refreshClient(target), target); }} />}
    {custom && <CatalogEditor kind={isTraining ? 'exercise' : 'food'} close={() => setCustom(false)} save={async input => { await fitnessApi('/coach/catalog', 'POST', input); setCustom(false); await refreshAfterSave(isTraining ? 'Exercício adicionado à biblioteca.' : 'Alimento adicionado ao catálogo.'); }} />}
  </div>;
}

function CatalogEditor({ kind, close, save }: { kind: 'food' | 'exercise'; close: () => void; save: (input: Record<string, unknown>) => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(e: FormEvent<HTMLFormElement>) { e.preventDefault(); if (busy) return; const values: Record<string, unknown> = Object.fromEntries(new FormData(e.currentTarget)); if (kind === 'food') for (const k of ['kcal', 'protein', 'carbs', 'fat']) values[k] = Number(values[k]); setBusy(true); try { await save({ ...values, kind }); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setBusy(false); } }
  return <Modal title={kind === 'food' ? 'Cadastrar alimento' : 'Cadastrar exercício'} close={() => { if (!busy) close(); }}><form className="fit-editor" onSubmit={submit}><label>Nome<input disabled={busy} name="name" required maxLength={120} placeholder={kind === 'food' ? 'Nome, marca e preparo' : 'Nome do exercício'} /></label><label>{kind === 'food' ? 'Categoria' : 'Grupo muscular'}<input disabled={busy} name="category" required maxLength={60} placeholder={kind === 'food' ? 'Ex.: Suplementos' : 'Ex.: Abdômen'} /></label>{kind === 'food' ? <><p className="fit-note">Preencha os valores para 100 g, conforme o rótulo ou a referência utilizada. O plano calcula as porções automaticamente.</p><div className="fit-form-grid">{[['kcal', 'Energia (kcal)', 1000], ['protein', 'Proteínas (g)', 100], ['carbs', 'Carboidratos (g)', 100], ['fat', 'Gorduras (g)', 100]].map(([name, label, max]) => <label key={String(name)}>{label}<input disabled={busy} name={String(name)} type="number" min={0} max={Number(max)} step="0.1" required /></label>)}</div></> : <><label>Equipamento<input disabled={busy} name="equipment" required maxLength={80} placeholder="Ex.: Peso corporal" /></label><label>Vídeo de execução<input disabled={busy} name="videoUrl" type="url" required maxLength={500} placeholder="https://… (MP4, WebM ou YouTube)" /></label><label>Como executar<textarea disabled={busy} name="instructions" required maxLength={2000} rows={4} placeholder="Explique o movimento e os principais cuidados…" /></label></>}{error && <p role="alert" className="fit-error">{error}</p>}<footer><button className="fit-btn secondary" type="button" onClick={close} disabled={busy}>Cancelar</button><button className="fit-btn" disabled={busy}>{busy ? 'Salvando…' : 'Adicionar ao catálogo'}</button></footer></form></Modal>;
}

function YouTubeEditor({ exercise, close, save }: { exercise: Exercise; close: () => void; save: (input: { videoUrl?: string; restore?: boolean }) => Promise<void> }) {
  const [url, setUrl] = useState(exercise.videoUrl.startsWith('https://www.youtube.com/') ? exercise.videoUrl : '');
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  async function submit(input: { videoUrl?: string; restore?: boolean }) { if (busy) return; setBusy(true); setError(''); try { await save(input); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setBusy(false); } }
  return <Modal title={`Vídeo · ${exercise.name}`} close={() => { if (!busy) close(); }}><form className="fit-editor" onSubmit={e => { e.preventDefault(); void submit({ videoUrl: url }); }}><div className="fit-youtube-help"><span className="fit-kicker">EXPLICAÇÃO DO MOVIMENTO</span><h3>Escolha a explicação que você recomenda.</h3><p>Busque no YouTube, copie o link do vídeo e cole abaixo. O aluno poderá assistir dentro do próprio treino.</p><a className="fit-btn secondary" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${exercise.name} execução correta explicação`)}`} target="_blank" rel="noreferrer"><Search size={16} /> Buscar este exercício no YouTube <ExternalLink size={14} /></a></div><label>Link do vídeo do YouTube<input disabled={busy} type="url" value={url} onChange={e => setUrl(e.target.value)} required placeholder="https://www.youtube.com/watch?v=…" maxLength={500} /></label><p className="fit-muted">Aceita links de vídeos, Shorts e links compartilhados pelo app. Este vídeo será usado em todos os treinos com este exercício. A reprodução depende das permissões definidas pelo canal; o aluno também terá o link para abrir no YouTube.</p>{error && <p className="fit-error" role="alert">{error}</p>}<footer>{exercise.id.startsWith('wger-') && !exercise.videoUrl.startsWith('/videos/') && <button type="button" className="fit-btn secondary" disabled={busy} onClick={() => void submit({ restore: true })}>Restaurar vídeo original</button>}<button type="button" className="fit-btn secondary" onClick={close} disabled={busy}>Cancelar</button><button className="fit-btn" disabled={busy || !url}>{busy ? 'Salvando…' : 'Usar este vídeo'}</button></footer></form></Modal>;
}
