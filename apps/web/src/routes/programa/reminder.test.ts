import { describe, expect, it } from 'vitest';
import { buildReminder, whatsappUrl } from './reminder';

describe('buildReminder', () => {
  it('names the person, part, day and date', () => {
    expect(buildReminder({ name: 'Ana Pérez', part: 'Presidente', date: '2026-10-17' })).toBe(
      'Hola Ana Pérez! Recordatorio: tenés asignado *Presidente* en la reunión del sábado 17/10. ¡Gracias!',
    );
  });

  it('adds the topic when there is one', () => {
    const text = buildReminder({
      name: 'Luis',
      part: 'Discurso público',
      detail: ' ¿Quién es Dios? ',
      date: '2026-10-18',
    });
    expect(text).toContain('*Discurso público* (¿Quién es Dios?) en la reunión del domingo 18/10');
  });

  it('ignores an empty topic', () => {
    expect(buildReminder({ name: 'Luis', part: 'Lector', detail: '  ', date: '2026-10-13' })).not.toContain('(');
  });
});

describe('whatsappUrl', () => {
  it('encodes the text', () => {
    expect(whatsappUrl('Hola Ana! *x*')).toBe('https://wa.me/?text=Hola%20Ana!%20*x*');
  });
});
