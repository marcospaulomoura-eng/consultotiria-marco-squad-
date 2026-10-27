import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, CheckCheck, ChevronRight, Clock3, Dumbbell, Flame, Home, KeyRound, LogOut, Play, RefreshCw, Timer, Users, Utensils, X } from 'lucide-react';
import { fitnessApi, dateLabel, initials, week } from './fitness-types';
import type { Catalog, Exercise, StudentData, Workout } from './fitness-types';
import { DietView, Empty, ExerciseVideo, Ranking, WorkoutCard } from './FitnessShared';
import Community from './Community';
import './fitness.css';

export default function StudentApp() {
  const [data, setData] = useState<StudentData | null>(null); const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [checking, setChecking] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [code, setCode] = useState('');
  const [page, setPage] = useState('home'); const [video, setVideo] = useState<Exercise | null>(null); const [activeWorkout, setActiveWorkout] = useState<Workout | null>(null);
  const [checked, setChecked] = useState<number[]>([]); const [notice, setNotice] = useState(''); const [timerEnd, setTimerEnd] = useState(0); const [seconds, setSeconds] = useState(0);
  const activeWorkoutRef = useRef<Workout | null>(null);
  const sessionGeneration = useRef(0);
  const selectWorkout = useCallback((workout: Workout | null) => {
    activeWorkoutRef.current = workout; setActiveWorkout(workout); setChecked([]); setTimerEnd(0); setSeconds(0);
  }, []);
  const invalidateSession = useCallback(() => { sessionGeneration.current++; }, []);
  const load = useCallback(async () => {
    const generation = sessionGeneration.current;
    const previous = activeWorkoutRef.current;
    try {
      const [value, library] = await Promise.all([fitnessApi<StudentData>('/me'), fitnessApi<Catalog>('/catalog')]);
      if (generation !== sessionGeneration.current) return;
      setData(value); setCatalog(library);
      if (previous && activeWorkoutRef.current === previous) {
        const current = value.workouts.find(workout => workout.id === previous.id);
        if (!current || current.updatedAt !== previous.updatedAt) {
          selectWorkout(current || null);
          setNotice(current ? 'Seu professor atualizou este treino. Carregamos a versão atual; confira os exercícios e marque-os novamente.' : 'Este treino foi removido pelo professor. Sua lista de treinos foi atualizada.');
        }
      }
    } catch (e) { if (generation === sessionGeneration.current) throw e; }
  }, [selectWorkout]);
  const initialize = useCallback(async () => {
    const generation = sessionGeneration.current;
    try {
      const status = await fitnessApi<{ student: StudentData['student'] | null }>('/auth/status');
      if (generation !== sessionGeneration.current) return;
      if (status.student) {
        const [value, library] = await Promise.all([fitnessApi<StudentData>('/me'), fitnessApi<Catalog>('/catalog')]);
        if (generation !== sessionGeneration.current) return;
        setData(value); setCatalog(library);
      }
    } catch (e) { if (generation === sessionGeneration.current) throw e; }
  }, []);
  useEffect(() => {
    let alive = true;
    const timer = setTimeout(() => initialize().catch(e => { if (alive) setError(e.message); }).finally(() => { if (alive) setChecking(false); }), 0);
    const expire = () => { invalidateSession(); setData(null); setCatalog(null); selectWorkout(null); setVideo(null); setCode(''); setNotice(''); setChecking(false); setError('Seu acesso expirou. Entre novamente.'); };
    window.addEventListener('student-auth-expired', expire);
    return () => { alive = false; invalidateSession(); clearTimeout(timer); window.removeEventListener('student-auth-expired', expire); };
  }, [initialize, selectWorkout, invalidateSession]);
  useEffect(() => {
    if (!timerEnd) return;
    const update = () => setSeconds(Math.max(0, Math.ceil((timerEnd - Date.now()) / 1000)));
    const timer = setInterval(update, 250); return () => clearInterval(timer);
  }, [timerEnd]);
  async function action(work: () => Promise<void>) { if (busy) return; setBusy(true); setError(''); setNotice(''); try { await work(); } catch (e) { setError(e instanceof Error ? e.message : 'Tente novamente.'); } finally { setBusy(false); } }
  function navigate(next: string) { setPage(next); setNotice(''); window.scrollTo({ top: 0, behavior: 'smooth' }); }
  if (!data || !catalog) return <div className="student-login fitness-root"><section className="student-login-art"><img src="/brand/marcos-squad-logo.png" alt="Marcos Squad — Treino, Nutrição e Resultados" /><div><span className="fit-kicker">SUA EVOLUÇÃO COMEÇA AQUI</span><h1>Um treino.<br />Uma escolha.<br /><em>Uma nova versão.</em></h1><p>Seu treino, sua alimentação e um Squad inteiro para evoluir com você.</p></div><span className="student-art-footer">TREINO <b>•</b> NUTRIÇÃO <b>•</b> RESULTADOS</span></section><section className="student-login-form"><div><span className="fit-login-icon"><KeyRound /></span><span className="fit-kicker">ÁREA DO ALUNO</span><h2>Vamos evoluir juntos.</h2><p>Use o código individual que seu professor compartilhou com você.</p>{checking ? <p role="status">Preparando seu espaço…</p> : <form onSubmit={e => { e.preventDefault(); void action(async () => { invalidateSession(); await fitnessApi('/auth/login', 'POST', { code: code.trim() }); setCode(''); await initialize(); }); }}><label>Código de acesso<input type="password" autoComplete="current-password" value={code} onChange={e => setCode(e.target.value)} maxLength={64} placeholder="Seu código pessoal" required /></label>{error && <p className="fit-error" role="alert">{error}</p>}<button className="fit-btn fit-wide" disabled={busy || !code.trim()}>{busy ? 'Entrando…' : 'Entrar no meu Squad'}<ArrowRight size={18} /></button></form>}<p className="fit-login-help">Ainda não tem um código? Peça ao Marcos para liberar seu acesso.</p><a href="/" className="fit-text-link">Sou professor · acessar gestão <ChevronRight size={14} /></a></div></section></div>;
  const trainingDays = data.trainingDays;
  const todayIndex = new Date(`${data.today}T12:00:00`).getDay();
  const todayWorkouts = data.workouts.filter(w => !w.days.length || w.days.includes(todayIndex));
  const nav = [{ id: 'home', label: 'Meu dia', icon: Home }, { id: 'workouts', label: 'Treinos', icon: Dumbbell }, { id: 'diet', label: 'Minha dieta', icon: Utensils }, { id: 'squad', label: 'Squad', icon: Users }];
  return <div className="student-shell fitness-root"><header className="student-header"><a href="/aluno" aria-label="Início Marcos Squad"><img src="/brand/marcos-squad-logo.png" alt="Marcos Squad" /></a><nav aria-label="Área do aluno">{nav.map(item => <button key={item.id} onClick={() => navigate(item.id)} className={page === item.id ? 'active' : ''}><item.icon size={18} /><span>{item.label}</span></button>)}</nav><div className="student-user"><span className="fit-avatar">{initials(data.student.name)}</span><span>{data.student.name}</span><button className="fit-icon-btn" aria-label="Sair da área do aluno" disabled={busy} onClick={() => void action(async () => { await fitnessApi('/auth/logout', 'POST'); invalidateSession(); setData(null); setCatalog(null); selectWorkout(null); setPage('home'); })}><LogOut size={18} /></button></div></header><main className="student-main">
    {error && <div role="alert" className="fit-error">{error}{activeWorkout && <button disabled={busy} onClick={() => void action(load)}>Atualizar treino</button>}</div>}{notice && <p role="status" className="fit-success">{notice}</p>}
    {page === 'home' && <><section className="student-hero"><div><span className="fit-kicker">O SEU COMPROMISSO É COM VOCÊ</span><h1>Vamos pra cima,<br /><em>{data.student.name.split(' ')[0]}.</em></h1><p>A evolução acontece nas escolhas de todos os dias.<br />O próximo passo está aqui.</p><button className="fit-btn" onClick={() => navigate('workouts')}>Ir para o meu treino <ArrowRight size={18} /></button></div><div className="student-hero-mark"><img src="/brand/marcos-squad-logo.png" alt="" /><span>CONSTÂNCIA TRANSFORMA.</span></div></section><div className="student-stats"><div><span><Dumbbell /> Treinos disponíveis</span><strong>{String(data.workouts.length).padStart(2, '0')}</strong><small>Prescritos pelo seu professor</small></div><div><span><Flame /> Dias treinados no mês</span><strong>{String(trainingDays).padStart(2, '0')}</strong><small>Cada dia é um passo a mais</small></div><div><span><Utensils /> Refeições no seu plano</span><strong>{String(data.diet?.meals.length || 0).padStart(2, '0')}</strong><small>Quantidades prontas em gramas</small></div></div><div className="student-home-grid"><section><div className="fit-section-head"><div><span className="fit-kicker">{week[todayIndex].toUpperCase()} · {dateLabel(data.today)}</span><h2>Seu movimento de hoje</h2></div><button className="fit-text-link" onClick={() => navigate('workouts')}>Ver todos <ArrowRight size={15} /></button></div>{todayWorkouts.length ? todayWorkouts.map(w => <button className="fit-today-workout" key={w.id} onClick={() => { navigate('workouts'); selectWorkout(w); }}><Dumbbell /><div><strong>{w.name}</strong><span>{w.items.length} exercícios · pronto para você</span></div>{data.history.some(h => h.workoutId === w.id && h.day === data.today) ? <CheckCheck /> : <ArrowUpRightIcon />}</button>) : <Empty title={data.workouts.length ? 'Hoje pode ser dia de recuperar' : 'Seu treino está a caminho'}>{data.workouts.length ? 'Consulte todos os treinos para ver sua programação.' : 'Assim que o professor liberar, sua programação aparece aqui.'}</Empty>}<div className="fit-panel student-plan"><span>Seu acompanhamento</span><strong>Marcos Squad</strong><p>Vencimento do plano: {dateLabel(data.student.endDate)}</p></div></section><Ranking /></div></>}
    {page === 'workouts' && <><div className="student-page-title"><span className="fit-kicker">FOCO NA EXECUÇÃO. CONSTÂNCIA NO PROCESSO.</span><h1>Seu próximo nível.</h1><p>Treinos preparados para você, com vídeos de cada movimento.</p></div>{activeWorkout ? <section className="fit-panel student-active-workout"><div className="fit-section-head"><div><span className="fit-kicker">TREINO EM ANDAMENTO</span><h2>{activeWorkout.name}</h2></div><button className="fit-btn secondary" onClick={() => { selectWorkout(null); }}>Voltar aos treinos</button></div><div className="fit-progress"><span style={{ width: `${checked.length / activeWorkout.items.length * 100}%` }} /></div><p className="fit-muted">{checked.length} de {activeWorkout.items.length} exercícios concluídos</p>{activeWorkout.items.map((item, i) => { const exercise = catalog.exercises.find(e => e.id === item.exerciseId); return <article className={`student-check-exercise ${checked.includes(i) ? 'done' : ''}`} key={i}><label><input type="checkbox" aria-label={`Concluir exercício ${i + 1}: ${exercise?.name || 'Exercício'}`} disabled={busy} checked={checked.includes(i)} onChange={e => setChecked(old => e.target.checked ? [...old, i] : old.filter(x => x !== i))} /><span>{checked.includes(i) ? <Check size={18} /> : String(i + 1).padStart(2, '0')}</span></label><div><h3>{exercise?.name}</h3><p>{item.sets} séries × {item.reps} · {item.rest}s descanso</p>{item.load && <p className="fit-muted">{item.load}</p>}<div className="student-exercise-buttons">{exercise && <button className="fit-text-link" onClick={() => setVideo(exercise)}><Play size={14} /> Ver execução</button>}{item.rest > 0 && <button className="fit-text-link" onClick={() => { setTimerEnd(Date.now() + item.rest * 1000); setSeconds(item.rest); }}><Timer size={14} /> Descansar {item.rest}s</button>}</div></div></article>; })}{activeWorkout.notes && <p className="fit-note">{activeWorkout.notes}</p>}<button className="fit-btn fit-wide" disabled={busy || checked.length !== activeWorkout.items.length || data.history.some(h => h.workoutId === activeWorkout.id && h.day === data.today)} onClick={() => void action(async () => { await fitnessApi('/me/complete', 'POST', { workoutId: activeWorkout.id, completed: checked, updatedAt: activeWorkout.updatedAt }); await load(); selectWorkout(null); setNotice('Treino concluído! Mais um dia de compromisso com você.'); })}><CheckCheck size={18} /> {data.history.some(h => h.workoutId === activeWorkout.id && h.day === data.today) ? 'Treino já registrado hoje' : 'Concluir e registrar treino'}</button></section> : <div className="fit-workout-grid">{data.workouts.length ? data.workouts.map(w => <WorkoutCard key={w.id} workout={w} exercises={catalog.exercises} onVideo={setVideo}><button className="fit-btn fit-wide" onClick={() => { selectWorkout(w); }}><Play size={16} /> {data.history.some(h => h.workoutId === w.id && h.day === data.today) ? 'Concluído hoje · ver treino' : 'Iniciar treino'}</button></WorkoutCard>) : <Empty title="Seu treino está a caminho">O professor está preparando sua rotina. Volte para conferir.</Empty>}</div>}<section className="fit-panel student-history"><div className="fit-section-head"><h2><Clock3 size={20} /> Histórico de treinos</h2><button className="fit-text-link" disabled={busy} onClick={() => void action(load)}><RefreshCw size={14} /> Atualizar</button></div>{data.history.length ? data.history.map(h => <div className="fit-history-row" key={h.id}><CheckCheck size={17} /><strong>{h.name}</strong><span>{dateLabel(h.day)}</span></div>) : <p className="fit-muted">Seus treinos concluídos ficam registrados aqui.</p>}</section></>}
    {page === 'diet' && <><div className="student-page-title"><span className="fit-kicker">NUTRIÇÃO QUE ACOMPANHA SUA EVOLUÇÃO</span><h1>Alimente seus resultados.</h1><p>Seu plano, refeição por refeição. Todas as porções em gramas.</p></div><DietView diet={data.diet} foods={catalog.foods} /></>}
    {page === 'squad' && <><div className="student-page-title"><span className="fit-kicker">NINGUÉM EVOLUI SOZINHO</span><h1>O seu Squad está aqui.</h1><p>Conquistas, conexão e uma dose extra de motivação.</p></div><Community student={data.student} onProfile={load} /></>}
    <footer className="student-footer"><span>MARCOS SQUAD</span> Treino · Nutrição · Resultados</footer>
  </main>{timerEnd > 0 && <div className="student-rest" role="status"><Timer size={21} /><div><small>{seconds > 0 ? 'RECUPERE O FÔLEGO' : 'DESCANSO CONCLUÍDO'}</small><strong>{seconds > 0 ? `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` : 'Próxima série!'}</strong></div><button className="fit-icon-btn" aria-label="Fechar descanso" onClick={() => { setTimerEnd(0); setSeconds(0); }}><X size={18} /></button></div>}{video && <ExerciseVideo exercise={video} close={() => setVideo(null)} />}</div>;
}
function ArrowUpRightIcon() { return <ArrowRight size={22} />; }
