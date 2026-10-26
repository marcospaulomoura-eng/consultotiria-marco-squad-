import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { Check, ExternalLink, FileText, RefreshCw, Trash2 } from 'lucide-react';
import { canonicalYoutubeUrl, MARCOS_CHANNEL_URL } from '../shared/youtube.mjs';
import { Modal } from './FitnessShared';
import { fitnessApi } from './fitness-types';
import { parseShortsList, shortsImportItems, shortsRowErrors, SHORTS_IMPORT_LIMIT } from './shorts-import';
import type { ShortsImportRow } from './shorts-import';

type ImportResult = { created: number; skipped: number };

export default function ShortsImport({ close, onImported }: { close: () => void; onImported: () => Promise<void> }) {
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ShortsImportRow[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [refreshPending, setRefreshPending] = useState(false);
  const lifecycle = useRef({ active: true, pending: false });
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const state = lifecycle.current; state.active = true;
    return () => { state.active = false; };
  }, []);
  const rowErrors = rows?.map(row => shortsRowErrors(row)) || [];
  const invalidRows = rowErrors.filter(errors => errors.length).length;

  function guardedClose() { if (!lifecycle.current.pending) close(); }
  function readList(event: FormEvent) {
    event.preventDefault();
    if (lifecycle.current.pending || result) return;
    try { setRows(parseShortsList(text)); setError(''); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Não foi possível ler esta lista.'); }
  }
  function updateRow(id: number, field: 'name' | 'videoUrl' | 'category' | 'equipment' | 'instructions', value: string) {
    setRows(current => current?.map(row => row.id === id ? { ...row, [field]: value } : row) || null);
    setError('');
  }
  async function readFile(file: File) {
    const state = lifecycle.current;
    if (state.pending || result) return;
    state.pending = true; setBusy(true); setError('');
    try {
      if (file.size > 200000) throw new Error('Este arquivo ficou grande. Divida a lista em arquivos menores.');
      const content = await file.text();
      if (state.active) { setText(content); setRows(null); }
    } catch (caught) { if (state.active) setError(caught instanceof Error ? caught.message : 'Não foi possível abrir este arquivo.'); }
    finally { state.pending = false; if (state.active) setBusy(false); }
  }
  async function refreshLibrary() {
    try {
      await onImported();
      if (lifecycle.current.active) { setRefreshPending(false); setError(''); }
    } catch {
      if (lifecycle.current.active) {
        setRefreshPending(true);
        setError('A importação foi salva, mas a biblioteca ainda não atualizou. Use Atualizar biblioteca para carregar os exercícios salvos.');
      }
    }
  }
  async function importRows(event: FormEvent) {
    event.preventDefault();
    const state = lifecycle.current;
    if (state.pending || result || !rows) return;
    state.pending = true; setBusy(true); setError('');
    try {
      const items = shortsImportItems(rows);
      if (new TextEncoder().encode(JSON.stringify({ items })).length > 32768) {
        throw new Error('Esta lista ficou grande. Remova algumas linhas e importe em lotes menores.');
      }
      const saved = await fitnessApi<ImportResult>('/coach/shorts/import', 'POST', { items });
      if (!state.active) return;
      setResult(saved); setRefreshPending(true);
      await refreshLibrary();
    } catch (caught) {
      if (state.active) setError(caught instanceof Error ? caught.message : 'Não foi possível importar os exercícios.');
    } finally { state.pending = false; if (state.active) setBusy(false); }
  }
  async function retryRefresh() {
    const state = lifecycle.current;
    if (state.pending) return;
    state.pending = true; setBusy(true); setError('');
    try { await refreshLibrary(); }
    finally { state.pending = false; if (state.active) setBusy(false); }
  }

  return <Modal title="Adicionar Shorts à biblioteca" close={guardedClose}>
    <div className="fit-editor fit-shorts-import">
      <p className="fit-muted">Cadastre os Shorts do seu canal com o nome de cada exercício. Depois de importar, eles ficam disponíveis para montar os treinos dos alunos.</p>
      <a className="fit-text-link" href={MARCOS_CHANNEL_URL} target="_blank" rel="noreferrer">Abrir meus Shorts no YouTube <ExternalLink size={14} /></a>
      {error && <p className="fit-error" role="alert">{error}</p>}
      {result ? <div className="fit-shorts-import-result">
        <p className="fit-success" role="status"><Check size={18} /> Importação salva: {result.created} exercício(s) adicionado(s) e {result.skipped} já cadastrado(s) ou repetido(s).</p>
        <p className="fit-muted">{refreshPending ? 'Os exercícios já foram gravados. Atualize a biblioteca para vê-los.' : 'Confira os exercícios na biblioteca e selecione-os ao prescrever um treino.'}</p>
        <footer className="fit-shorts-import-actions">
          <button type="button" className="fit-btn secondary" disabled={busy} onClick={guardedClose}>{refreshPending ? 'Fechar' : 'Concluir'}</button>
          {refreshPending && <button type="button" className="fit-btn" disabled={busy} onClick={() => void retryRefresh()}><RefreshCw size={16} /> {busy ? 'Atualizando…' : 'Atualizar biblioteca'}</button>}
        </footer>
      </div> : rows ? <form onSubmit={event => void importRows(event)} noValidate>
        <div className="fit-shorts-import-heading"><strong>Revise {rows.length} exercício(s)</strong><span className="fit-muted">{invalidRows ? `${invalidRows} linha(s) precisam de correção.` : 'Confira os nomes e os vídeos antes de importar.'}</span></div>
        <div className="fit-shorts-import-preview">
          <table className="fit-table"><caption>Exercícios que serão adicionados à biblioteca</caption><thead><tr><th>Nome e vídeo</th><th>Grupo e equipamento</th><th>Revisão</th></tr></thead><tbody>
            {rows.map((row, index) => <tr key={row.id}>
              <td><label>Nome do exercício<input aria-label={`Nome do exercício da linha ${row.line}`} value={row.name} onChange={event => updateRow(row.id, 'name', event.target.value)} maxLength={120} disabled={busy} aria-invalid={!!rowErrors[index].length} /></label><label>Link do Short<input aria-label={`Link do Short da linha ${row.line}`} type="url" value={row.videoUrl} onChange={event => updateRow(row.id, 'videoUrl', event.target.value)} maxLength={500} disabled={busy} /></label>{canonicalYoutubeUrl(row.videoUrl) && <a className="fit-text-link" href={canonicalYoutubeUrl(row.videoUrl)!} target="_blank" rel="noreferrer" aria-label={`Conferir vídeo da linha ${row.line}`}>Conferir vídeo <ExternalLink size={13} /></a>}</td>
              <td><label>Grupo muscular<input aria-label={`Grupo muscular da linha ${row.line}`} value={row.category} onChange={event => updateRow(row.id, 'category', event.target.value)} maxLength={60} placeholder="Não classificado" disabled={busy} /></label><label>Equipamento<input aria-label={`Equipamento da linha ${row.line}`} value={row.equipment} onChange={event => updateRow(row.id, 'equipment', event.target.value)} maxLength={80} placeholder="A confirmar" disabled={busy} /></label><details><summary>Orientação opcional</summary><label>Orientação<textarea aria-label={`Orientação da linha ${row.line}`} value={row.instructions} onChange={event => updateRow(row.id, 'instructions', event.target.value)} maxLength={2000} rows={3} disabled={busy} /></label></details></td>
              <td><span className="fit-muted">Linha {row.line}</span>{rowErrors[index].length ? <ul className="fit-shorts-row-errors">{rowErrors[index].map(message => <li key={message}>{message}</li>)}</ul> : <span className="fit-shorts-row-ready"><Check size={14} /> Pronto</span>}<button type="button" className="fit-icon-btn" aria-label={`Remover linha ${row.line}`} disabled={busy} onClick={() => setRows(current => current?.filter(item => item.id !== row.id) || [])}><Trash2 size={16} /></button></td>
            </tr>)}
          </tbody></table>
        </div>
        {!rows.length && <p className="fit-muted">Todas as linhas foram removidas. Volte à lista para adicionar exercícios.</p>}
        <p className="fit-muted">Links repetidos ou já cadastrados nessa biblioteca não criam outro exercício.</p>
        <footer className="fit-shorts-import-actions"><button type="button" className="fit-btn secondary" disabled={busy} onClick={() => { setRows(null); setError(''); }}>Voltar à lista</button><button type="submit" className="fit-btn" disabled={busy || !rows.length || invalidRows > 0}><Check size={16} /> {busy ? 'Importando…' : 'Importar na biblioteca'}</button></footer>
      </form> : <form onSubmit={readList} noValidate>
        <label>Lista de exercícios<textarea value={text} onChange={event => { setText(event.target.value); setError(''); }} placeholder="Nome;Link do Short;Grupo;Equipamento;Orientação" rows={8} maxLength={200000} disabled={busy} /></label>
        <p className="fit-muted">Use uma linha por exercício. Nome e link do Short são obrigatórios; grupo, equipamento e orientação são opcionais. Separe as colunas por ponto e vírgula, tabulação ou barra vertical. Arquivos CSV com vírgulas também são aceitos. Até {SHORTS_IMPORT_LIMIT} exercícios por importação.</p>
        <input ref={fileRef} type="file" accept=".csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void readFile(file); event.target.value = ''; }} />
        <footer className="fit-shorts-import-actions"><button type="button" className="fit-btn secondary" disabled={busy} onClick={() => fileRef.current?.click()}><FileText size={16} /> Abrir arquivo</button><button type="submit" className="fit-btn" disabled={busy || !text.trim()}>{busy ? 'Abrindo…' : 'Ler lista e revisar'}</button></footer>
      </form>}
    </div>
  </Modal>;
}
