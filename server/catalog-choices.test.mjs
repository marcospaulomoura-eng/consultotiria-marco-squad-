import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { catalogChoices, resolveCatalogChoice } from '../src/catalog-choices.ts';

test('catalog choices distinguish duplicate exercise videos without selecting the first raw name', () => {
  const base = JSON.parse(readFileSync(new URL('./fitness-catalog.json', import.meta.url), 'utf8'));
  const shorts = JSON.parse(readFileSync(new URL('./marcos-shorts.json', import.meta.url), 'utf8'));
  const choices = catalogChoices([...shorts.exercises, ...base.exercises]);
  const duplicate = choices.filter(choice => choice.name === 'Rosca martelo');
  assert.deepEqual(duplicate.map(choice => choice.value), ['Rosca martelo · Seu canal', 'Rosca martelo · Biblioteca base']);
  assert.equal(resolveCatalogChoice(choices, 'Rosca martelo'), '');
  for (const choice of choices) assert.equal(resolveCatalogChoice(choices, choice.value), choice.id);
  assert.equal(new Set(choices.map(choice => choice.value)).size, choices.length);
  assert.equal(choices.find(choice => choice.name === 'Step-up').value, 'Step-up');
});

test('catalog choices distinguish custom foods with identical names and details', () => {
  const choices = catalogChoices([
    { id: 'food-one', name: 'Alimento de demonstração', category: 'Preparações', source: 'Cadastro do professor' },
    { id: 'food-two', name: 'Alimento de demonstração', category: 'Preparações', source: 'Cadastro do professor' },
  ]);
  assert.notEqual(choices[0].value, choices[1].value);
  assert.equal(resolveCatalogChoice(choices, 'Alimento de demonstração'), '');
  assert.ok(choices.every(choice => choice.value.includes('Personalizado')));
  assert.equal(resolveCatalogChoice(choices, choices[0].value), 'food-one');
  assert.equal(resolveCatalogChoice(choices, choices[1].value), 'food-two');
  assert.ok(choices.every(choice => !choice.value.includes(choice.id)));
});

test('custom names that resemble generated labels cannot redirect a selection to another record', () => {
  const choices = catalogChoices([
    { id: 'custom-one', name: 'Rosca', collection: 'marcos-shorts' },
    { id: 'custom-two', name: 'Rosca', collection: 'marcos-shorts' },
    { id: 'custom-three', name: 'Rosca · Seu canal · opção 1' },
  ]);
  assert.equal(new Set(choices.map(choice => choice.value)).size, 3);
  assert.equal(choices[2].value, 'Rosca · Seu canal · opção 1');
  assert.equal(resolveCatalogChoice(choices, 'Rosca'), '');
  for (const choice of choices) assert.equal(resolveCatalogChoice(choices, choice.value), choice.id);
});
