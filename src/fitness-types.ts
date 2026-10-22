export type Exercise = { id: string; name: string; category: string; equipment: string; instructions: string; videoUrl: string; author: string; license: string; licenseUrl: string; changes?: string; sourceUrl?: string };
export type Food = { id: string; name: string; category: string; kcal: number; protein: number; carbs: number; fat: number; source: string; traceFields?: string[] };
export type Catalog = { exercises: Exercise[]; foods: Food[] };
export type WorkoutItem = { exerciseId: string; sets: number; reps: string; rest: number; load: string };
export type Workout = { id?: string; name: string; days: number[]; notes: string; items: WorkoutItem[]; updatedAt?: string };
export type FoodItem = { foodId: string; grams: number };
export type Totals = { kcal: number; protein: number; carbs: number; fat: number };
export type Meal = { name: string; time: string; items: FoodItem[]; totals?: Totals };
export type Diet = { name: string; notes: string; meals: Meal[]; totals?: Totals; updatedAt?: string };
export type HistoryEntry = { id: string; workoutId: string; name: string; day: string };
export type Prescription = { workouts: Workout[]; diet: Diet | null; history: HistoryEntry[] };
export type Student = { id: string; name: string; community: number; endDate: string };
export type StudentData = Prescription & { student: Student; today: string; trainingDays: number };
export type CoachClient = { id: string; name: string; endDate: string; accessCreated: string | null; workouts: number; hasDiet: number; trainingDays: number };
export type Post = { id: string; caption: string; createdAt: string; name: string; hasImage: number; likes: number; liked: number; canDelete: boolean; comments: { id: string; name: string; text: string; own: number }[] };
export const week = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
export const format = (n: number, digits = 1) => n.toLocaleString('pt-BR', { maximumFractionDigits: digits });
export const dateLabel = (day: string) => new Date(`${day.slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR');
export const initials = (name: string) => name.trim().split(/\s+/).slice(0, 2).map(x => x[0]).join('').toUpperCase();
export const normalized = (text: string) => text.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export function totals(items: FoodItem[], foods: Food[]): Totals {
  return items.reduce((sum, item) => {
    const food = foods.find(x => x.id === item.foodId);
    if (food) for (const key of ['kcal', 'protein', 'carbs', 'fat'] as const) sum[key] += food[key] * (Number(item.grams) || 0) / 100;
    return sum;
  }, { kcal: 0, protein: 0, carbs: 0, fat: 0 });
}
export async function fitnessApi<T = unknown>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(`/api/fitness${path}`, { method, headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401 && !path.startsWith('/auth')) window.dispatchEvent(new Event(location.pathname.startsWith('/aluno') ? 'student-auth-expired' : 'marcos-auth-expired'));
    throw new Error(value?.error || 'Não foi possível concluir. Tente novamente.');
  }
  return value as T;
}

export async function photoData(file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Escolha uma foto JPG, PNG ou WebP.');
  if (file.size > 12 * 1024 * 1024) throw new Error('Escolha uma foto com até 12 MB.');
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1000 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas'); canvas.width = Math.round(bitmap.width * scale); canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext('2d'); if (!context) { bitmap.close(); throw new Error('Não foi possível preparar a foto.'); }
  context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height); bitmap.close();
  for (const quality of [0.85, 0.7, 0.55, 0.4, 0.25]) {
    const data = canvas.toDataURL('image/jpeg', quality);
    if (data.length < 239000) return data;
  }
  throw new Error('Esta foto ainda está grande. Recorte a imagem e tente novamente.');
}
