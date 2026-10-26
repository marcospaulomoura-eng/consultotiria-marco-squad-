import { useId, useState } from 'react';
import type { FormEvent } from 'react';
import { ArrowDown, ArrowUp, Check, Plus, Trash2, X } from 'lucide-react';
import { format, normalized, totals, week } from './fitness-types';
import type { Diet, Exercise, Food, Meal, Workout } from './fitness-types';
import { MacroBar, Modal } from './FitnessShared';

const newRowKey = () => crypto.randomUUID();
const newMeal = (): Meal => ({ name: '', time: '', items: [] });

function Picker({ items, selected, onSelect, label, disabled = false }: { items: { id: string; name: string }[]; selected: string; onSelect: (id: string) => void; label: string; disabled?: boolean }) {
  const id = useId(); const [term, setTerm] = useState(items.find(x => x.id === selected)?.name || '');
  const [previous, setPrevious] = useState(selected);
  if (previous !== selected) {
    setPrevious(selected);
    if (selected || term === items.find(x => x.id === previous)?.name) setTerm(items.find(x => x.id === selected)?.name || '');
  }
  return <label className="fit-picker">{label}<input list={id} disabled={disabled} value={term} placeholder="Digite para buscar…" onChange={e => { setTerm(e.target.value); const item = items.find(x => x.name === e.target.value); onSelect(item?.id || ''); }} required aria-invalid={!selected && !!term} /><datalist id={id}>{items.filter(x => normalized(x.name).includes(normalized(term))).slice(0, 100).map(x => <option key={x.id} value={x.name} />)}</datalist>{!selected && !!term && <small>Selecione um item da lista.</small>}</label>;
}
export function WorkoutEditor({ value, setValue, exercises, close, save }: { value: Workout; setValue: (w: Workout) => void; exercises: Exercise[]; close: () => void; save: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  // Identity belongs to the editor, never to the saved prescription.
  const [rowKeys, setRowKeys] = useState(() => value.items.map(newRowKey));
  function addItem() {
    setRowKeys(keys => [...keys, newRowKey()]);
    setValue({ ...value, items: [...value.items, { exerciseId: '', sets: 3, reps: '10–12', rest: 60, load: '' }] });
  }
  function removeItem(index: number) {
    setRowKeys(keys => keys.filter((_, i) => i !== index));
    setValue({ ...value, items: value.items.filter((_, i) => i !== index) });
  }
  const updateItem = (index: number, change: Partial<Workout['items'][number]>) => setValue({ ...value, items: value.items.map((item, i) => i === index ? { ...item, ...change } : item) });
  function move(index: number, delta: number) {
    const items = [...value.items]; [items[index], items[index + delta]] = [items[index + delta], items[index]];
    setRowKeys(keys => { const next = [...keys]; [next[index], next[index + delta]] = [next[index + delta], next[index]]; return next; });
    setValue({ ...value, items });
  }
  async function submit(e: FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await save(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setBusy(false); } }
  return <Modal title={value.id ? 'Editar treino' : 'Prescrever novo treino'} close={() => { if (!busy) close(); }}><form onSubmit={submit} className="fit-editor"><div className="fit-form-grid"><label className="full">Nome do treino<input disabled={busy} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} placeholder="Ex.: Treino A · Inferiores" required maxLength={120} /></label><fieldset className="full fit-week"><legend>Dias da semana <small>· deixe livre se não houver dias fixos</small></legend>{week.map((day, i) => <label key={day}><input disabled={busy} type="checkbox" checked={value.days.includes(i)} onChange={e => setValue({ ...value, days: e.target.checked ? [...value.days, i].sort() : value.days.filter(d => d !== i) })} /><span>{day}</span></label>)}</fieldset></div><div className="fit-section-head"><h3>Exercícios da ficha</h3><span className="fit-muted">{value.items.length}/30</span></div>{value.items.map((item, i) => <div className="fit-editor-exercise" key={rowKeys[i]}><div className="fit-editor-item-head"><strong>EXERCÍCIO {String(i + 1).padStart(2, '0')}</strong><div><button type="button" className="fit-icon-btn" aria-label="Mover exercício para cima" disabled={busy || i === 0} onClick={() => move(i, -1)}><ArrowUp size={14} /></button><button type="button" className="fit-icon-btn" aria-label="Mover exercício para baixo" disabled={busy || i === value.items.length - 1} onClick={() => move(i, 1)}><ArrowDown size={14} /></button><button type="button" className="fit-icon-btn" aria-label="Remover exercício" disabled={busy} onClick={() => removeItem(i)}><Trash2 size={15} /></button></div></div><Picker disabled={busy} items={exercises} selected={item.exerciseId} onSelect={exerciseId => updateItem(i, { exerciseId })} label="Exercício" /><div className="fit-form-grid four"><label>Séries<input disabled={busy} type="number" min={1} max={20} value={item.sets} onChange={e => updateItem(i, { sets: Number(e.target.value) })} required /></label><label>Repetições<input disabled={busy} value={item.reps} onChange={e => updateItem(i, { reps: e.target.value })} required placeholder="10–12" maxLength={40} /></label><label>Descanso (s)<input disabled={busy} type="number" min={0} max={600} value={item.rest} onChange={e => updateItem(i, { rest: Number(e.target.value) })} required /></label><label>Carga / orientação<input disabled={busy} value={item.load} onChange={e => updateItem(i, { load: e.target.value })} placeholder="Ex.: 12 kg" maxLength={120} /></label></div></div>)}<button type="button" className="fit-add-row" disabled={busy || value.items.length >= 30} onClick={addItem}><Plus size={17} /> Adicionar exercício</button><label>Orientações do treino<textarea disabled={busy} value={value.notes} onChange={e => setValue({ ...value, notes: e.target.value })} rows={3} maxLength={2000} placeholder="Orientações que o aluno deve seguir…" /></label>{error && <p className="fit-error" role="alert">{error}</p>}<footer><button type="button" className="fit-btn secondary" onClick={close} disabled={busy}>Cancelar</button><button className="fit-btn" disabled={busy || !value.items.length || value.items.some(i => !i.exerciseId)}>{busy ? 'Salvando…' : 'Salvar e liberar treino'}<Check size={17} /></button></footer></form></Modal>;
}
export function DietEditor({ value, setValue, foods, close, save }: { value: Diet; setValue: (d: Diet) => void; foods: Food[]; close: () => void; save: () => Promise<void> }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [rowKeys, setRowKeys] = useState(() => value.meals.map(meal => ({ meal: newRowKey(), foods: meal.items.map(newRowKey) })));
  function addMeal() {
    setRowKeys(keys => [...keys, { meal: newRowKey(), foods: [] }]);
    setValue({ ...value, meals: [...value.meals, newMeal()] });
  }
  function removeMeal(index: number) {
    setRowKeys(keys => keys.filter((_, i) => i !== index));
    setValue({ ...value, meals: value.meals.filter((_, i) => i !== index) });
  }
  function addFood(index: number) {
    setRowKeys(keys => keys.map((meal, i) => i === index ? { ...meal, foods: [...meal.foods, newRowKey()] } : meal));
    updateMeal(index, { items: [...value.meals[index].items, { foodId: '', grams: 100 }] });
  }
  function removeFood(mealIndex: number, foodIndex: number) {
    setRowKeys(keys => keys.map((meal, i) => i === mealIndex ? { ...meal, foods: meal.foods.filter((_, j) => j !== foodIndex) } : meal));
    updateMeal(mealIndex, { items: value.meals[mealIndex].items.filter((_, j) => j !== foodIndex) });
  }
  const updateMeal = (index: number, change: Partial<Meal>) => setValue({ ...value, meals: value.meals.map((m, i) => i === index ? { ...m, ...change } : m) });
  async function submit(e: FormEvent) { e.preventDefault(); if (busy) return; setBusy(true); setError(''); try { await save(); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível salvar.'); setBusy(false); } }
  const dailyTotals = totals(value.meals.flatMap(m => m.items), foods);
  const partial = value.meals.some(m => m.items.some(i => foods.find(f => f.id === i.foodId)?.traceFields?.length));
  return <Modal title="Montar plano alimentar" close={() => { if (!busy) close(); }}><form className="fit-editor" onSubmit={submit}><label>Nome do plano<input disabled={busy} value={value.name} onChange={e => setValue({ ...value, name: e.target.value })} required maxLength={120} /></label><div className="fit-diet-live"><span className="fit-kicker">TOTAL DIÁRIO · ATUALIZADO AO EDITAR</span><MacroBar value={dailyTotals} compact />{partial && <p className="fit-muted">Macros parciais: há alimentos com valores não informados na fonte.</p>}</div>{value.meals.map((meal, i) => <section className="fit-editor-meal" key={rowKeys[i].meal}><div className="fit-editor-item-head"><strong>REFEIÇÃO {String(i + 1).padStart(2, '0')}</strong><button type="button" className="fit-icon-btn" aria-label="Remover refeição" disabled={busy} onClick={() => removeMeal(i)}><Trash2 size={16} /></button></div><div className="fit-form-grid"><label>Nome da refeição<input disabled={busy} value={meal.name} onChange={e => updateMeal(i, { name: e.target.value })} placeholder="Ex.: Café da manhã" required maxLength={80} /></label><label>Horário (opcional)<input disabled={busy} type="time" value={meal.time} onChange={e => updateMeal(i, { time: e.target.value })} /></label></div>{meal.items.map((item, j) => <div className="fit-editor-food" key={rowKeys[i].foods[j]}><Picker disabled={busy} items={foods} selected={item.foodId} onSelect={foodId => updateMeal(i, { items: meal.items.map((f, n) => n === j ? { ...f, foodId } : f) })} label="Alimento e preparo" /><label>Quantidade (g)<input disabled={busy} type="number" min="0.1" max={5000} step="0.1" value={item.grams} onChange={e => updateMeal(i, { items: meal.items.map((f, n) => n === j ? { ...f, grams: Number(e.target.value) } : f) })} required /></label><span>{format(totals([item], foods).kcal, 0)}<small>kcal</small></span><button type="button" className="fit-icon-btn" aria-label="Remover alimento" disabled={busy} onClick={() => removeFood(i, j)}><X size={17} /></button></div>)}<button className="fit-add-row" type="button" disabled={busy || meal.items.length >= 20} onClick={() => addFood(i)}><Plus size={15} /> Adicionar alimento</button><div className="fit-meal-footer">{format(totals(meal.items, foods).kcal, 0)} kcal <span>·</span> P {format(totals(meal.items, foods).protein)} g <span>·</span> C {format(totals(meal.items, foods).carbs)} g <span>·</span> G {format(totals(meal.items, foods).fat)} g</div></section>)}<button type="button" className="fit-add-row" disabled={busy || value.meals.length >= 12} onClick={addMeal}><Plus size={17} /> Adicionar refeição</button><label>Orientações gerais<textarea disabled={busy} value={value.notes} onChange={e => setValue({ ...value, notes: e.target.value })} rows={3} maxLength={2000} placeholder="Substituições, preparo e orientações para o aluno…" /></label>{error && <p className="fit-error" role="alert">{error}</p>}<footer><button type="button" className="fit-btn secondary" onClick={close} disabled={busy}>Cancelar</button><button className="fit-btn" disabled={busy || !value.meals.length || value.meals.some(m => !m.items.length || m.items.some(i => !i.foodId))}>{busy ? 'Salvando…' : 'Salvar e liberar dieta'}<Check size={17} /></button></footer></form></Modal>;
}
