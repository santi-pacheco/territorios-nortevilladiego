import { Send } from 'lucide-react';
import { buildReminder, sendReminder, type ReminderInput } from './reminder';

/** Small "recordar por WhatsApp" button beside an assignment. Only rendered for editors. */
export function ReminderButton(props: ReminderInput) {
  return (
    <button
      type="button"
      className="icon-btn -my-2 shrink-0"
      aria-label={`Enviar recordatorio a ${props.name}`}
      onClick={() => void sendReminder(buildReminder(props))}
    >
      <Send aria-hidden size={20} />
    </button>
  );
}
