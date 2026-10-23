import { useCallback, useEffect, useRef, useState } from 'react';
import { Heart, ImagePlus, MessageCircle, Send, Trash2, Users, X } from 'lucide-react';
import { fitnessApi, initials, photoData } from './fitness-types';
import type { Post, Student } from './fitness-types';
import { Empty, Ranking } from './FitnessShared';

export default function Community({ student, onProfile }: { student?: Student; onProfile?: () => Promise<void> }) {
  const [tab, setTab] = useState('feed'); const [posts, setPosts] = useState<Post[]>([]); const [next, setNext] = useState<string | null>(null);
  const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [caption, setCaption] = useState(''); const [image, setImage] = useState(''); const [comment, setComment] = useState<Record<string, string>>({});
  const [name, setName] = useState(student?.name || ''); const fileRef = useRef<HTMLInputElement>(null);
  const lifecycle = useRef({ mounted: true, request: 0 }); const actionPending = useRef(false);
  const load = useCallback(async (before = '') => {
    const state = lifecycle.current;
    if (!state.mounted) return;
    const request = ++state.request;
    try {
      const result = await fitnessApi<{ posts: Post[]; next: string | null }>(`/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`);
      if (!state.mounted || request !== state.request) return;
      setPosts(old => before ? [...old, ...result.posts.filter(p => !old.some(o => o.id === p.id))] : result.posts); setNext(result.next); setError('');
    } catch (e) {
      if (state.mounted && request === state.request) throw e;
    } finally {
      if (state.mounted && request === state.request) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const state = lifecycle.current; state.mounted = true;
    const timer = setTimeout(() => { void load().catch(e => { if (state.mounted) setError(e.message); }); }, 0);
    return () => { state.mounted = false; state.request++; clearTimeout(timer); };
  }, [load]);
  async function action(work: () => Promise<void>) {
    if (actionPending.current) return; actionPending.current = true; setBusy(true); setError(''); setNotice('');
    try { await work(); } catch (e) { if (lifecycle.current.mounted) setError(e instanceof Error ? e.message : 'Não foi possível concluir.'); } finally { actionPending.current = false; if (lifecycle.current.mounted) setBusy(false); }
  }
  async function publish() {
    const submittedCaption = caption; const submittedImage = image;
    await fitnessApi('/feed', 'POST', { caption: submittedCaption, image: submittedImage });
    setCaption(current => current === submittedCaption ? '' : current); setImage(current => current === submittedImage ? '' : current);
    if (fileRef.current) fileRef.current.value = '';
    await load(); if (lifecycle.current.mounted) setNotice('Publicação compartilhada com o Squad.');
  }
  async function sendComment(postId: string) {
    const submitted = comment[postId];
    await fitnessApi(`/feed/${postId}/comments`, 'POST', { text: submitted });
    setComment(current => current[postId] === submitted ? { ...current, [postId]: '' } : current);
    await load();
  }
  async function profile(community: boolean) {
    await fitnessApi('/me/profile', 'PUT', { name, community }); await onProfile?.(); await load(); setNotice(community ? 'Você entrou para a comunidade!' : 'Seu perfil saiu do feed e do ranking. Seus treinos continuam salvos.');
  }
  return <div className="fit-community"><div className="fit-tabs"><button className={tab === 'feed' ? 'active' : ''} onClick={() => setTab('feed')}><Users size={16} /> Feed do Squad</button><button className={tab === 'ranking' ? 'active' : ''} onClick={() => setTab('ranking')}>Top 5 do mês</button></div>
    {error && <div className="fit-error" role="alert">{error}<button onClick={() => void action(() => load())}>Atualizar</button></div>}{notice && <p role="status" className="fit-success">{notice}</p>}
    {student && <form className="fit-panel fit-community-profile" onSubmit={e => { e.preventDefault(); void action(() => profile(!student.community)); }}><div><strong>{student.community ? 'Você faz parte do Squad' : 'Evoluir fica melhor em equipe'}</strong><p>Ao participar, seu nome, publicações e dias de treino no ranking ficam visíveis aos alunos e ao professor.</p></div><label>Nome na comunidade<input value={name} onChange={e => setName(e.target.value)} required maxLength={50} /></label><button className={student.community ? 'fit-btn secondary' : 'fit-btn'} disabled={busy}>{student.community ? 'Sair da comunidade' : 'Participar da comunidade'}</button>{!!student.community && name !== student.name && <button type="button" className="fit-btn secondary" disabled={busy} onClick={() => void action(() => profile(true))}>Salvar nome</button>}</form>}
    {tab === 'ranking' ? <Ranking key={String(student?.community)} /> : <div className="fit-feed-layout"><div>
      {student && !!student.community && <form className="fit-panel fit-composer" onSubmit={e => { e.preventDefault(); void action(publish); }}><div className="fit-composer-top"><span className="fit-avatar">{initials(student.name)}</span><textarea aria-label="Texto da publicação" value={caption} onChange={e => setCaption(e.target.value)} maxLength={2000} placeholder="Qual foi a sua conquista de hoje?" rows={3} /></div>{image && <div className="fit-image-preview"><img src={image} alt="Prévia da sua foto" /><button type="button" aria-label="Remover foto" className="fit-icon-btn" onClick={() => setImage('')}><X size={18} /></button></div>}<footer><input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={e => { const file = e.target.files?.[0]; if (file) void action(async () => setImage(await photoData(file))); e.target.value = ''; }} /><button type="button" className="fit-btn secondary" disabled={busy} onClick={() => fileRef.current?.click()}><ImagePlus size={17} /> Adicionar foto</button><button className="fit-btn" disabled={busy || (!caption.trim() && !image)}><Send size={16} /> {busy ? 'Aguarde…' : 'Publicar'}</button></footer><small className="fit-muted">Compartilhe suas próprias fotos. Até 5 publicações por dia.</small></form>}
      {!student && <p className="fit-note">Comunidade dos seus alunos. Você pode acompanhar e remover publicações ou comentários quando necessário.</p>}
      {loading ? <p className="fit-muted">Carregando a comunidade…</p> : !posts.length && !error ? <Empty title="Toda evolução merece ser compartilhada">O feed está pronto para as primeiras conquistas do Squad.</Empty> : posts.map(post => <article className="fit-panel fit-post" key={post.id}><header><span className="fit-avatar">{initials(post.name)}</span><div><strong>{post.name}</strong><time>{new Date(post.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' })}</time></div>{post.canDelete && <button className="fit-icon-btn" aria-label="Excluir publicação" disabled={busy} onClick={() => { if (confirm('Excluir esta publicação e seus comentários?')) void action(async () => { await fitnessApi(`/feed/${post.id}`, 'DELETE'); await load(); }); }}><Trash2 size={16} /></button>}</header>{post.caption && <p className="fit-post-caption">{post.caption}</p>}{!!post.hasImage && <img className="fit-post-photo" src={`/api/fitness/media/${post.id}`} alt={`Foto compartilhada por ${post.name}`} loading="lazy" />}<div className="fit-post-actions"><button disabled={busy || !student?.community} className={post.liked ? 'liked' : ''} onClick={() => void action(async () => { await fitnessApi(`/feed/${post.id}/like`, post.liked ? 'DELETE' : 'PUT'); await load(); })} aria-label={post.liked ? 'Remover curtida' : 'Curtir'} aria-pressed={!!post.liked}><Heart size={19} fill={post.liked ? 'currentColor' : 'none'} /> {post.likes} <span>curtidas</span></button><span><MessageCircle size={18} /> {post.comments.length} comentários</span></div><div className="fit-comments">{post.comments.map(c => <div className="fit-comment" key={c.id}><p><strong>{c.name}</strong> {c.text}</p>{(!student || !!c.own) && <button className="fit-icon-btn" aria-label="Excluir comentário" disabled={busy} onClick={() => { if (confirm('Excluir comentário?')) void action(async () => { await fitnessApi(`/comments/${c.id}`, 'DELETE'); await load(); }); }}><X size={13} /></button>}</div>)}{student && !!student.community && <form onSubmit={e => { e.preventDefault(); void action(() => sendComment(post.id)); }}><input aria-label="Escrever comentário" placeholder="Incentive alguém do Squad…" value={comment[post.id] || ''} onChange={e => setComment(old => ({ ...old, [post.id]: e.target.value }))} maxLength={500} required /><button className="fit-icon-btn" disabled={busy || !comment[post.id]?.trim()} aria-label="Enviar comentário"><Send size={17} /></button></form>}</div></article>)}
      {next && <button className="fit-btn secondary fit-wide" disabled={busy} onClick={() => void action(() => load(next))}>Ver publicações anteriores</button>}
    </div><aside className="fit-feed-aside"><Ranking key={String(student?.community)} /><div className="fit-panel fit-community-note"><Users size={28} /><h3>Seu esforço inspira.</h3><p>Compartilhe o processo, celebre pequenas vitórias e fortaleça quem está nessa jornada com você.</p><span>MARCOS SQUAD</span></div></aside></div>}
  </div>;
}
