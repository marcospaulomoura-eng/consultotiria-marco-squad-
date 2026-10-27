export type CatalogPickerItem = {
  id: string;
  name: string;
  collection?: string;
  category?: string;
  equipment?: string;
  source?: string;
};

export type CatalogChoice = { id: string; name: string; value: string };

const comparable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();

function sourceLabel(item: CatalogPickerItem): string {
  if (item.collection === 'marcos-shorts') return 'Seu canal';
  if (item.id.startsWith('wger-')) return 'Biblioteca base';
  if (item.id.startsWith('taco-') || item.source?.toUpperCase().includes('TACO')) return 'TACO';
  return 'Personalizado';
}

function groupsByValue(choices: CatalogChoice[]) {
  const groups = new Map<string, number[]>();
  choices.forEach((choice, index) => {
    const key = comparable(choice.value);
    groups.set(key, [...(groups.get(key) || []), index]);
  });
  return [...groups.values()].filter(group => group.length > 1);
}

/** Native datalist values must identify exactly one catalog record. */
export function catalogChoices(items: CatalogPickerItem[]): CatalogChoice[] {
  const nameCounts = new Map<string, number>();
  for (const item of items) {
    const key = comparable(item.name);
    nameCounts.set(key, (nameCounts.get(key) || 0) + 1);
  }
  const duplicated = items.map(item => nameCounts.get(comparable(item.name))! > 1);
  const choices = items.map((item, index) => ({
    id: item.id,
    name: item.name,
    value: duplicated[index] ? `${item.name} · ${sourceLabel(item)}` : item.name,
  }));
  for (const group of groupsByValue(choices)) {
    for (const index of group) {
      if (!duplicated[index]) continue;
      const detail = [items[index].equipment, items[index].category].filter(Boolean).join(' · ');
      if (detail) choices[index].value += ` · ${detail}`;
    }
  }
  for (const group of groupsByValue(choices)) {
    group.forEach((index, position) => {
      if (duplicated[index]) choices[index].value += ` · opção ${position + 1}`;
    });
  }
  // A custom record may itself be named like a generated label. Preserve its
  // literal name and keep generated labels distinct from all raw catalog names.
  const rawNames = new Set(items.map(item => comparable(item.name)));
  const used = new Set(choices.filter((_, index) => !duplicated[index]).map(choice => comparable(choice.value)));
  choices.forEach((choice, index) => {
    if (!duplicated[index]) return;
    const base = choice.value;
    let suffix = 1;
    while (rawNames.has(comparable(choice.value)) || used.has(comparable(choice.value))) {
      choice.value = `${base} · opção ${suffix++}`;
    }
    used.add(comparable(choice.value));
  });
  return choices;
}

/** Ambiguous names and partial searches remain unselected until a choice is made. */
export function resolveCatalogChoice(choices: CatalogChoice[], value: string): string {
  const matches = choices.filter(choice => choice.value === value);
  return matches.length === 1 ? matches[0].id : '';
}
