import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { parseShortsList, shortsImportItems, shortsRowErrors } from '../src/shorts-import.ts';

const first = 'QAshort0001';
const second = 'QAshort0002';
const link = id => `https://www.youtube.com/shorts/${id}`;

test('lista de Shorts aceita BOM, CRLF, cabeçalho e colunas opcionais na ordem declarada', () => {
  const rows = parseShortsList(`\uFEFFNome;Link;Grupo;Equipamento;Orientação\r\n\r\nAgachamento;${link(first)};Pernas;Barra;Controle a descida.\r\nRemada;${link(second)};;;\r\n`);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].line, 3);
  assert.equal(rows[0].name, 'Agachamento');
  assert.deepEqual(shortsImportItems(rows), [
    { name: 'Agachamento', videoUrl: `https://www.youtube.com/watch?v=${first}`, category: 'Pernas', equipment: 'Barra', instructions: 'Controle a descida.' },
    { name: 'Remada', videoUrl: `https://www.youtube.com/watch?v=${second}` },
  ]);
  const reordered = parseShortsList(`Video URL,Exercise name,Equipment\n${link(first)},Agachamento,Barra`);
  assert.equal(reordered[0].name, 'Agachamento');
  assert.equal(reordered[0].equipment, 'Barra');
});

test('CSV com aspas conserva separadores, aspas escapadas e orientação multilinha', () => {
  const rows = parseShortsList(`"Remada, pegada neutra",${link(first)},Costas,"Halteres, banco","Suba devagar.\nSem usar \"\"impulso\"\"."`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].name, 'Remada, pegada neutra');
  assert.equal(rows[0].equipment, 'Halteres, banco');
  assert.equal(rows[0].instructions, 'Suba devagar.\nSem usar "impulso".');
  assert.deepEqual(shortsRowErrors(rows[0]), []);
});

test('TSV e barra vertical funcionam sem interpretar vírgulas do nome como separador', () => {
  const tab = parseShortsList(`Supino, pegada fechada\t${link(first)}\tPeito`);
  assert.equal(tab[0].name, 'Supino, pegada fechada');
  assert.equal(tab[0].category, 'Peito');
  const pipe = parseShortsList(`Elevação lateral|${link(second)}|Ombros|Halteres`);
  assert.equal(pipe[0].equipment, 'Halteres');
});

test('lista ambígua não perde colunas silenciosamente e aspas malformadas indicam a linha', () => {
  assert.throws(() => parseShortsList(`Nome;Link\nExercício;${link(first)};extra`), /Linha 2.*colunas a mais/);
  assert.throws(() => parseShortsList(`"Nome aberto;${link(first)}`), /Linha 1.*aspas/);
  assert.throws(() => parseShortsList(`"Agachamento"texto;${link(first)}`), /Linha 1.*separador/);
  assert.throws(() => parseShortsList('Nome;Link;Coluna desconhecida\nA;b;c'), /cabeçalho/);
  assert.throws(() => parseShortsList('Nome;Link;Nome\nA;b;c'), /cabeçalho/);
});

test('campos inválidos ficam editáveis por linha e bloqueiam o payload de importação', () => {
  const rows = parseShortsList(`;${link(first)}\nExercício;https://youtube.com/@canal\nOutro;https://youtube.com.evil.example/shorts/${second}`);
  assert.match(shortsRowErrors(rows[0]).join(' '), /nome/);
  assert.match(shortsRowErrors(rows[1]).join(' '), /vídeo específico/);
  assert.match(shortsRowErrors(rows[2]).join(' '), /vídeo específico/);
  assert.throws(() => shortsImportItems(rows), /Corrija/);
  rows[0].name = 'Nome revisado';
  rows[1].videoUrl = link(second);
  rows.pop();
  assert.equal(shortsImportItems(rows).length, 2);
  assert.notEqual(rows[0].id, rows[1].id);
});

test('limites, controles invisíveis e esquemas perigosos são recusados antes do envio', () => {
  const rows = parseShortsList(`Nome;${link(first)};${'g'.repeat(61)};${'e'.repeat(81)};${'i'.repeat(2001)}`);
  assert.equal(shortsRowErrors(rows[0]).length, 3);
  const credentialsInUrl = `https://${randomBytes(12).toString('hex')}:${randomBytes(12).toString('hex')}@youtube.com/shorts/${first}`;
  for (const videoUrl of ['javascript:alert(1)', 'http://youtube.com/shorts/' + first, credentialsInUrl]) {
    assert.match(shortsRowErrors({ ...rows[0], category: '', equipment: '', instructions: '', videoUrl }).join(' '), /HTTPS/);
  }
  assert.match(shortsRowErrors({ ...rows[0], name: 'Nome\0invisível' }).join(' '), /caracteres inválidos/);
  assert.throws(() => parseShortsList(Array.from({ length: 51 }, (_, index) => `Nome ${index};${link(first)}`).join('\n')), /50/);
  assert.throws(() => parseShortsList('Nome;Link'), /pelo menos um exercício/);
  assert.throws(() => parseShortsList(' \n '), /Cole a lista/);
  assert.throws(() => shortsImportItems([]), /de 1 a 50/);
});
