import { useState } from 'react';
import { ArrowRight, Dumbbell, ExternalLink, Play, Plus, Search } from 'lucide-react';
import { MARCOS_CHANNEL_URL, youtubeThumbnail, youtubeVideoId } from '../shared/youtube.mjs';
import { normalized } from './fitness-types';
import type { Exercise } from './fitness-types';
import { Empty } from './FitnessShared';

type Source = 'marcos' | 'base' | 'all';

export default function ExerciseLibrary({ exercises, onVideo, onUse, onChangeVideo, onImport, onCustom }: {
  exercises: Exercise[]; onVideo: (exercise: Exercise) => void; onUse: (exercise: Exercise) => void;
  onChangeVideo: (exercise: Exercise) => void; onImport: () => void; onCustom: () => void;
}) {
  const [source, setSource] = useState<Source>('marcos');
  const [query, setQuery] = useState(''); const [group, setGroup] = useState(''); const [limit, setLimit] = useState(24);
  const own = exercises.filter(exercise => exercise.collection === 'marcos-shorts');
  const pool = source === 'marcos' ? own : source === 'base' ? exercises.filter(exercise => exercise.collection !== 'marcos-shorts') : exercises;
  const filtered = pool.filter(exercise => (!group || exercise.category === group) && normalized(`${exercise.name} ${exercise.equipment} ${exercise.category} ${exercise.videoTitle || ''}`).includes(normalized(query)));
  const sources: { value: Source; label: string; count: number }[] = [
    { value: 'marcos', label: 'Shorts do Marcos', count: own.length },
    { value: 'base', label: 'Outros exercícios', count: exercises.length - own.length },
    { value: 'all', label: 'Todos', count: exercises.length },
  ];
  return <section className="fit-exercise-library" aria-label="Biblioteca de exercícios">
    <div className="fit-channel-banner"><div><span className="fit-kicker">SUA BIBLIOTECA · YOUTUBE SHORTS</span><h2>Seu jeito de ensinar. Em cada treino.</h2><p>Encontre o exercício, confira o movimento e prepare a ficha do aluno.</p><a href={MARCOS_CHANNEL_URL} target="_blank" rel="noreferrer">Abrir meu canal <ExternalLink size={13} /></a></div><div className="fit-channel-count"><Play size={22} /><strong>{own.length}</strong><span>Shorts na biblioteca</span></div></div>
    <div className="fit-library-sources" aria-label="Origem dos exercícios">{sources.map(item => <button key={item.value} type="button" aria-pressed={source === item.value} className={source === item.value ? 'active' : ''} onClick={() => { setSource(item.value); setGroup(''); setLimit(24); }}>{item.label}<span>{item.count}</span></button>)}</div>
    <div className="fit-toolbar fit-library-toolbar"><label className="fit-search"><Search size={17} /><input value={query} onChange={event => { setQuery(event.target.value); setLimit(24); }} aria-label="Buscar exercício" placeholder="Buscar exercício, grupo ou equipamento…" /></label><select aria-label="Filtrar grupo muscular" value={group} onChange={event => { setGroup(event.target.value); setLimit(24); }}><option value="">Todos os grupos</option>{[...new Set(pool.map(exercise => exercise.category))].sort((a, b) => a.localeCompare(b, 'pt-BR')).map(category => <option key={category}>{category}</option>)}</select><button type="button" className="fit-btn" onClick={onImport}><Plus size={16} /> Adicionar Shorts</button><button type="button" className="fit-btn secondary" onClick={onCustom}>Novo exercício</button></div>
    <div className="fit-library-meta"><span>{filtered.length} {filtered.length === 1 ? 'exercício encontrado' : 'exercícios encontrados'}</span><span>Escolha o vídeo antes de prescrever</span></div>
    <div className="fit-library-list">{filtered.slice(0, limit).map(exercise => {
      const isShort = exercise.collection === 'marcos-shorts';
      const thumbnail = youtubeThumbnail(exercise.videoUrl) || exercise.thumbnailUrl || (exercise.videoUrl.startsWith('/videos/') ? exercise.videoUrl.replace(/\.mp4$/, '.webp') : null);
      return <article className="fit-library-row" key={exercise.id}>
        <button type="button" className={`fit-library-thumb ${isShort ? 'portrait' : ''}`} onClick={() => onVideo(exercise)} aria-label={`Assistir ${exercise.name}`}><Dumbbell size={27} aria-hidden="true" />{thumbnail && <img src={thumbnail} alt="" loading="lazy" referrerPolicy="no-referrer" onError={event => { event.currentTarget.hidden = true; }} />}<span className="fit-thumb-play"><Play size={14} fill="currentColor" /></span></button>
        <div className="fit-library-description"><div className="fit-library-badges"><span>{exercise.category}</span><span>{isShort ? 'Short do Marcos' : youtubeVideoId(exercise.videoUrl) ? 'YouTube' : 'Biblioteca base'}</span></div><h3>{exercise.name}</h3><p>{exercise.equipment}</p><button type="button" className="fit-text-link" onClick={() => onVideo(exercise)}><Play size={13} /> {isShort ? 'Assistir Short' : 'Ver execução'}</button></div>
        <div className="fit-library-row-actions"><button type="button" className="fit-btn" onClick={() => onUse(exercise)}>Usar no treino <ArrowRight size={15} /></button><button type="button" className="fit-text-link" onClick={() => onChangeVideo(exercise)}>Trocar vídeo</button></div>
      </article>;
    })}</div>
    {!filtered.length && <Empty title={query || group ? 'Nenhum exercício encontrado' : source === 'marcos' ? 'Sua biblioteca de Shorts começa aqui' : 'Nenhum exercício nesta seleção'}>{query || group ? 'Tente outro nome ou grupo muscular.' : <>Adicione os links dos Shorts com o nome de cada exercício.<button type="button" className="fit-btn" onClick={onImport}>Adicionar Shorts</button></>}</Empty>}
    {filtered.length > limit && <button type="button" className="fit-btn secondary fit-wide" onClick={() => setLimit(current => current + 24)}>Carregar mais exercícios ({Math.min(limit, filtered.length)} de {filtered.length})</button>}
  </section>;
}
