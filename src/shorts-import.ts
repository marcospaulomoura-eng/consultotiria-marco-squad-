import { canonicalYoutubeUrl } from '../shared/youtube.mjs';

export const SHORTS_IMPORT_LIMIT = 50;

export type ShortsImportItem = {
  name: string;
  videoUrl: string;
  category?: string;
  equipment?: string;
  instructions?: string;
};

export type ShortsImportRow = {
  id: number;
  line: number;
  name: string;
  videoUrl: string;
  category: string;
  equipment: string;
  instructions: string;
};

type Column = 'name' | 'videoUrl' | 'category' | 'equipment' | 'instructions';
const columns: Column[] = ['name', 'videoUrl', 'category', 'equipment', 'instructions'];
const aliases: Record<Column, string[]> = {
  name: ['nome', 'nome do exercicio', 'exercicio', 'name', 'exercise', 'exercise name', 'titulo', 'title', 'video title'],
  videoUrl: ['link', 'url', 'video', 'short', 'link do short', 'link do video', 'video url', 'short url', 'youtube url'],
  category: ['grupo', 'grupo muscular', 'categoria', 'category', 'muscle group'],
  equipment: ['equipamento', 'equipment'],
  instructions: ['orientacao', 'orientacoes', 'execucao', 'como executar', 'instructions', 'instruction', 'notes'],
};
const normalize = (value: string) => value.trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ');
const singleLine = (value: string) => value.trim().replace(/\s+/g, ' ');
const hasControlCharacters = (value: string) => [...value].some(char => {
  const code = char.charCodeAt(0);
  return (code < 32 && code !== 9 && code !== 10 && code !== 13) || code === 127;
});

function delimiterFor(source: string): string {
  const count = new Map([['\t', 0], [';', 0], ['|', 0], [',', 0]]);
  let quoted = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === '"') {
      if (quoted && source[i + 1] === '"') { i++; continue; }
      quoted = !quoted;
    } else if (!quoted) {
      if (char === '\n') {
        if ([...count.values()].some(Boolean)) break;
      } else if (count.has(char)) count.set(char, count.get(char)! + 1);
    }
  }
  // Prefer explicit spreadsheet separators over commas that may occur in names.
  return [...count].find(([, amount]) => amount > 0)?.[0] || ';';
}

function readRecords(source: string, delimiter: string) {
  const records: { line: number; cells: string[] }[] = [];
  let cells: string[] = [], field = '', quoted = false, closed = false, line = 1, rowLine = 1;
  for (let i = 0; i <= source.length; i++) {
    const char = i === source.length ? '\n' : source[i];
    if (quoted) {
      if (i === source.length) throw new Error(`Linha ${rowLine}: feche as aspas da coluna antes de ler a lista.`);
      if (char === '"') {
        if (source[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else { field += char; if (char === '\n') line++; }
      continue;
    }
    if (char === delimiter || char === '\n') {
      cells.push(field.trim()); field = ''; closed = false;
      if (char === '\n') {
        if (cells.some(cell => cell.length)) records.push({ line: rowLine, cells });
        cells = []; line++; rowLine = line;
      }
    } else if (closed) {
      if (char !== ' ') throw new Error(`Linha ${rowLine}: use um separador depois das aspas.`);
    } else if (char === '"') {
      if (field.trim()) throw new Error(`Linha ${rowLine}: coloque toda a coluna entre aspas e use duas aspas para citar uma palavra.`);
      field = ''; quoted = true;
    } else field += char;
  }
  return records;
}

/** Parses only local text. It never fetches titles, thumbnails or channel data. */
export function parseShortsList(input: string): ShortsImportRow[] {
  if (typeof input !== 'string' || !input.trim()) throw new Error('Cole a lista de exercícios e links dos Shorts.');
  if (input.length > 200000) throw new Error('A lista ficou grande. Divida os exercícios em lotes menores.');
  const source = input.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n');
  const records = readRecords(source, delimiterFor(source));
  if (!records.length) throw new Error('A lista não contém exercícios.');
  let order: Column[] = columns;
  const header = records[0].cells.map(cell => columns.find(column => aliases[column].includes(normalize(cell))));
  if (header.includes('name') && header.includes('videoUrl')) {
    if (header.some(column => !column) || new Set(header).size !== header.length) {
      throw new Error('Confira o cabeçalho: use Nome, Link, Grupo, Equipamento e Orientação, sem repetir colunas.');
    }
    order = header as Column[]; records.shift();
  }
  if (!records.length) throw new Error('Adicione pelo menos um exercício depois do cabeçalho.');
  if (records.length > SHORTS_IMPORT_LIMIT) throw new Error(`Importe até ${SHORTS_IMPORT_LIMIT} exercícios por vez. Divida a lista em lotes menores.`);
  return records.map(record => {
    if (record.cells.length > order.length) {
      throw new Error(`Linha ${record.line}: há colunas a mais. Use o mesmo separador em toda a lista e coloque nomes com separadores entre aspas.`);
    }
    const row: ShortsImportRow = { id: record.line, line: record.line, name: '', videoUrl: '', category: '', equipment: '', instructions: '' };
    record.cells.forEach((cell, index) => {
      const column = order[index];
      row[column] = column === 'instructions' || column === 'videoUrl' ? cell.trim() : singleLine(cell);
    });
    return row;
  });
}

export function shortsRowErrors(row: ShortsImportRow): string[] {
  const errors: string[] = [];
  if (!row.name.trim()) errors.push('Informe o nome do exercício.');
  else if (row.name.trim().length > 120) errors.push('O nome deve ter até 120 caracteres.');
  if (row.videoUrl.trim().length > 500 || !canonicalYoutubeUrl(row.videoUrl)) errors.push('Cole o link HTTPS de um vídeo específico do YouTube.');
  if (row.category.trim().length > 60) errors.push('O grupo deve ter até 60 caracteres.');
  if (row.equipment.trim().length > 80) errors.push('O equipamento deve ter até 80 caracteres.');
  if (row.instructions.trim().length > 2000) errors.push('A orientação deve ter até 2.000 caracteres.');
  if ([row.name, row.videoUrl, row.category, row.equipment, row.instructions].some(hasControlCharacters)) {
    errors.push('Remova os caracteres inválidos desta linha.');
  }
  return errors;
}

export function shortsImportItems(rows: ShortsImportRow[]): ShortsImportItem[] {
  if (!rows.length || rows.length > SHORTS_IMPORT_LIMIT) throw new Error(`Selecione de 1 a ${SHORTS_IMPORT_LIMIT} exercícios para importar.`);
  if (rows.some(row => shortsRowErrors(row).length)) throw new Error('Corrija as linhas indicadas antes de importar.');
  return rows.map(row => ({
    name: singleLine(row.name), videoUrl: canonicalYoutubeUrl(row.videoUrl)!,
    ...(row.category.trim() ? { category: singleLine(row.category) } : {}),
    ...(row.equipment.trim() ? { equipment: singleLine(row.equipment) } : {}),
    ...(row.instructions.trim() ? { instructions: row.instructions.trim() } : {}),
  }));
}
