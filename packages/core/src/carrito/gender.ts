export type Gender = 'M' | 'F';

const MALE_NAMES = new Set([
  'daniel', 'nahuel', 'miguel', 'jorge', 'angel', 'juan', 'luis', 'david',
  'milton', 'jose', 'rafael', 'manuel', 'israel', 'ismael', 'gabriel',
  'gustavo', 'braulio', 'nicolas', 'mateo', 'martin', 'cristian', 'sebastian',
  'esteban', 'pablo', 'pedro', 'andres', 'ruben', 'oscar', 'hector', 'cesar',
  'victor', 'walter', 'fabian', 'ariel', 'leonel', 'lionel', 'matias',
  'tomas', 'lucas', 'facundo', 'gonzalo', 'agustin', 'joaquin',
]);

const FEMALE_NAMES = new Set([
  'carmen', 'rocio', 'luz', 'isabel', 'soledad', 'noemi', 'ines', 'beatriz',
  'raquel', 'dolores', 'mercedes', 'pilar', 'esther', 'judith', 'ruth',
  'miriam', 'damaris',
]);

export function inferGender(fullName: string): Gender | null {
  const first = fullName.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
  if (!first) return null;
  const normalized = first
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '');
  if (MALE_NAMES.has(normalized)) return 'M';
  if (FEMALE_NAMES.has(normalized)) return 'F';
  const last = normalized.slice(-1);
  if (last === 'a') return 'F';
  if (last === 'o') return 'M';
  return null;
}
