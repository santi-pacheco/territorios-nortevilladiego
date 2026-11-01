/**
 * WhatsApp reminder for one program assignment. Pure: the button only decides who gets one
 * (editors of that meeting) and hands the result to the share sheet or `wa.me`.
 */
import { DAY_NAME, fromIso } from '../../lib/week';

export interface ReminderInput {
  /** Person assigned, as written in the program. */
  name: string;
  /** Part label: the midweek part title or the weekend role ("Presidente"). */
  part: string;
  /** Optional topic / talk title / role in the part. */
  detail?: string | null;
  /** Meeting day, yyyy-mm-dd. */
  date: string;
}

/** "martes 13/10". */
function dayAndDate(iso: string): string {
  const d = fromIso(iso);
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  return `${DAY_NAME[d.getDay()]!.toLowerCase()} ${dd}/${mm}`;
}

export function buildReminder({ name, part, detail, date }: ReminderInput): string {
  const topic = detail?.trim() ? ` (${detail.trim()})` : '';
  return `Hola ${name.trim()}! Recordatorio: tenés asignado *${part.trim()}*${topic} en la reunión del ${dayAndDate(date)}. ¡Gracias!`;
}

export function whatsappUrl(text: string): string {
  return `https://wa.me/?text=${encodeURIComponent(text)}`;
}

/** Native share sheet when there is one, otherwise WhatsApp. A cancelled share is not an error. */
export async function sendReminder(text: string): Promise<void> {
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ text });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        window.open(whatsappUrl(text), '_blank', 'noopener');
      }
    }
    return;
  }
  window.open(whatsappUrl(text), '_blank', 'noopener');
}
