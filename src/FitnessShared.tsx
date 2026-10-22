import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ArrowUpRight, Check, Clock3, Dumbbell, Play, Trophy, X, Flame, Utensils } from 'lucide-react';
import { fitnessApi, format, totals, week } from './fitness-types';
import type { Diet, Exercise, Food, Totals, Workout } from './fitness-types';

export function Empty({ icon = 'train', title, children }: { icon?: string; title: string; children: ReactNode }) {
  return <div className="fit-empty"><span>{icon === 'diet' ? <Utensils /> : icon === 'rank' ? <Trophy /> : <Dumbbell />}</span><h3>{title}</h3><p>{children}</p></div>;
}
export function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null); const titleId = useId(); const closeRef = useRef(close);
  useEffect(() => { closeRef.current = close; }, [close]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement;
    const oldOverflow = document.body.style.overflow; document.body.style.overflow = 'hidden';
    ref.current?.focus();
    function key(e: KeyboardEvent) {
      if (e.key === 'Escape') closeRef.current();
      if (e.key !== 'Tab') return;
      const all = Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select,textarea,[tabindex="0"]') || []).filter(x => x.getClientRects().length);
      const first = all[0], last = all.at(-1);
      if (!first) { e.preventDefault(); return; }
      if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) { e.preventDefault(); last?.focus(); }
      else if (!e.shiftKey && (document.activeElement === last || document.activeElement === ref.current)) { e.preventDefault(); first.focus(); }
    }
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = oldOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="fit-modal-backdrop" onClick={e => { if (e.target === e.currentTarget) close(); }}><div className="fit-modal" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={ref}><header><h2 id={titleId}>{title}</h2><button className="fit-icon-btn" aria-label="Fechar" onClick={close}><X /></button></header>{children}</div></div>;
}
export function ExerciseVideo({ exercise, close }: { exercise: Exercise; close: () => void }) {
  const [failed, setFailed] = useState(false);
  let youtubeId = '';
  if (exercise.videoUrl.startsWith('https:')) {
    const url = new URL(exercise.videoUrl);
    if (['youtube.com', 'www.youtube.com', 'youtu.be'].includes(url.hostname)) youtubeId = url.hostname === 'youtu.be' ? url.pathname.slice(1) : url.searchParams.get('v') || url.pathname.split('/').at(-1) || '';
  }
  return <Modal title={exercise.name} close={close}><div className="fit-video">
    {youtubeId && /^[\w-]{11}$/.test(youtubeId) ? <iframe title={exercise.name} src={`https://www.youtube-nocookie.com/embed/${youtubeId}`} allowFullScreen /> : <video controls playsInline autoPlay preload="metadata" src={exercise.videoUrl} onError={() => setFailed(true)} />}
  </div><div className="fit-modal-body"><div className="fit-tags"><span>{exercise.category}</span><span>{exercise.equipment}</span></div><h3>Como executar</h3><p className="fit-instructions">{exercise.instructions}</p>{failed && <p role="alert" className="fit-error">Não foi possível reproduzir aqui. Use o link abaixo para abrir o vídeo.</p>}<a className="fit-text-link" href={exercise.videoUrl} target="_blank" rel="noreferrer">Abrir vídeo <ArrowUpRight size={14} /></a><p className="fit-credit">Vídeo: {exercise.author}{exercise.license && <> · <a href={exercise.licenseUrl} target="_blank" rel="noreferrer">{exercise.license}</a> · wger<br />{exercise.changes} {exercise.sourceUrl && <a href={exercise.sourceUrl} target="_blank" rel="noreferrer">Vídeo original no wger</a>}</>}</p></div></Modal>;
}
export function MacroBar({ value, compact = false }: { value: Totals; compact?: boolean }) {
  return <div className={`fit-macros ${compact ? 'compact' : ''}`}><div><Flame size={18} /><strong>{format(value.kcal, 0)} <small>kcal</small></strong><span>Energia</span></div>{([['protein', 'Proteínas'], ['carbs', 'Carboidratos'], ['fat', 'Gorduras']] as const).map(([key, label]) => <div key={key}><strong>{format(value[key])}<small> g</small></strong><span>{label}</span></div>)}</div>;
}
export function DietView({ diet, foods }: { diet: Diet | null; foods: Food[] }) {
  if (!diet) return <Empty icon="diet" title="Seu plano alimentar está a caminho">O professor disponibilizará suas refeições por aqui.</Empty>;
  const partial = diet.meals.some(m => m.items.some(i => foods.find(f => f.id === i.foodId)?.traceFields?.length));
  return <div className="fit-diet-view"><div className="fit-section-head"><div><span className="fit-kicker">SEU PLANO ALIMENTAR</span><h2>{diet.name}</h2></div><span className="fit-badge">Quantidades em gramas</span></div><MacroBar value={diet.totals || totals(diet.meals.flatMap(m => m.items), foods)} />{partial && <p className="fit-muted">Macros parciais: alguns valores não foram informados na fonte do alimento.</p>}{diet.notes && <p className="fit-note">{diet.notes}</p>}<div className="fit-meals">{diet.meals.map((meal, i) => <article className="fit-panel fit-meal" key={i}><header><span className="fit-meal-index">{String(i + 1).padStart(2, '0')}</span><div><h3>{meal.name}</h3>{meal.time && <span><Clock3 size={13} /> {meal.time}</span>}</div><strong>{format(totals(meal.items, foods).kcal, 0)} <small>kcal</small></strong></header>{meal.items.map((item, j) => { const food = foods.find(f => f.id === item.foodId); return <div className="fit-food-line" key={j}><span>{food?.name || 'Alimento'}<small>{format((food?.kcal || 0) * item.grams / 100, 0)} kcal</small></span><strong>{format(item.grams)} g</strong></div>; })}<div className="fit-meal-footer">P {format(totals(meal.items, foods).protein)} g <span>·</span> C {format(totals(meal.items, foods).carbs)} g <span>·</span> G {format(totals(meal.items, foods).fat)} g</div></article>)}</div><p className="fit-credit">TACO · NEPA/UNICAMP, 4ª edição. Valores aproximados por parte comestível. Respeite a indicação de alimento cru ou cozido. Alimentos personalizados usam os valores cadastrados pelo professor.</p></div>;
}
export function WorkoutCard({ workout, exercises, onVideo, children }: { workout: Workout; exercises: Exercise[]; onVideo: (e: Exercise) => void; children?: ReactNode }) {
  return <article className="fit-panel fit-workout"><header><span className="fit-workout-icon"><Dumbbell /></span><div><h3>{workout.name}</h3><p>{workout.items.length} exercícios · {workout.days.length ? workout.days.map(d => week[d]).join(' / ') : 'Dias livres'}</p></div></header>{workout.items.map((item, i) => { const ex = exercises.find(e => e.id === item.exerciseId); return <div className="fit-exercise-line" key={i}><span className="fit-index">{String(i + 1).padStart(2, '0')}</span><div><strong>{ex?.name}</strong><p>{item.sets} × {item.reps} <span>·</span> {item.rest}s descanso</p>{item.load && <small>{item.load}</small>}</div>{ex && <button className="fit-play-btn" title={`Ver execução: ${ex.name}`} aria-label={`Ver execução: ${ex.name}`} onClick={() => onVideo(ex)}><Play size={16} /></button>}</div>; })}{workout.notes && <p className="fit-note">{workout.notes}</p>}{children && <footer>{children}</footer>}</article>;
}
export function Ranking() {
  const [result, setResult] = useState<{ ranking: { name: string; days: number; own: number }[]; month: string; rule: string } | null>(null);
  const [error, setError] = useState(''); const [attempt, setAttempt] = useState(0);
  useEffect(() => { let alive = true; fitnessApi<typeof result>('/ranking').then(r => { if (alive) { setResult(r); setError(''); } }).catch(e => { if (alive) setError(e.message); }); return () => { alive = false; }; }, [attempt]);
  return <section className="fit-panel fit-ranking"><div className="fit-section-head"><div><span className="fit-kicker">CONSTÂNCIA EM PRIMEIRO LUGAR</span><h2><Trophy size={22} /> Top 5 do Squad</h2></div><span className="fit-badge">{result ? new Date(`${result.month}-01T12:00:00`).toLocaleDateString('pt-BR', { month: 'long' }) : 'Este mês'}</span></div>{error ? <div className="fit-error" role="alert">{error}<button onClick={() => setAttempt(x => x + 1)}>Tentar novamente</button></div> : !result ? <p className="fit-muted">Carregando ranking…</p> : !result.ranking.length ? <Empty icon="rank" title="O próximo destaque pode ser você">Os alunos que participam da comunidade aparecem aqui ao concluir o primeiro treino do mês.</Empty> : result.ranking.map((entry, i) => <div className={`fit-rank-row ${i === 0 ? 'winner' : ''}`} key={i}><span className="fit-rank-position">{i === 0 ? <Trophy size={23} /> : String(i + 1).padStart(2, '0')}</span><span className="fit-avatar">{entry.name.slice(0, 2).toUpperCase()}</span><div><strong>{entry.name} {entry.own ? <small>você</small> : null}</strong><span>{i === 0 ? 'Liderando pelo exemplo' : 'Cada treino conta'}</span></div><strong>{entry.days} <small>{entry.days === 1 ? 'dia' : 'dias'}</small></strong></div>)}<p className="fit-credit"><Check size={13} /> {result?.rule || 'Um ponto por dia com treino concluído.'} Só aparecem alunos que ativaram a participação na comunidade.</p></section>;
}
