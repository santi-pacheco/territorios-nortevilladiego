import { Link } from 'react-router';
import { ChevronRight } from 'lucide-react';
import { useMyAssignments, useMyLink } from '../../lib/accounts';
import {
  KIND_LABEL,
  dayOfMonth,
  hhmm,
  nextAssignment,
  relativeDay,
  shortWeekday,
  sortAssignments,
} from '../mis-asignaciones/model';

/**
 * "Tu próxima asignación": one compact row above the line, only for a signed-in, linked
 * member with something coming up. Anonymous members never trigger a request.
 */
export function NextAssignment() {
  const link = useMyLink();
  const list = useMyAssignments({ enabled: Boolean(link.data) });
  if (!link.data || !list.data) return null;
  const now = new Date();
  const next = nextAssignment(sortAssignments(list.data), now);
  if (!next) return null;
  const time = hhmm(next.start_time);

  return (
    <Link
      to="/mis-asignaciones"
      className="mb-5 flex min-h-touch items-center gap-3 rounded-[10px] border border-line bg-surface px-4 py-3 text-ink no-underline hover:border-line-strong"
    >
      <span className="min-w-0 flex-1">
        <span className="block text-secondary text-ink-soft">
          Tu próxima asignación · {relativeDay(next.date, now)}
        </span>
        <span className="block text-body-strong font-semibold break-words">{next.title}</span>
        <span className="block text-secondary">
          {shortWeekday(next.date)} {dayOfMonth(next.date)}
          {time && (
            <>
              {' · '}
              <span className="font-mono">{time}</span>
            </>
          )}
          {' · '}
          {KIND_LABEL[next.kind]}
          {next.role && ` · ${next.role}`}
        </span>
      </span>
      <ChevronRight aria-hidden size={22} className="shrink-0 text-ink-soft" />
    </Link>
  );
}
