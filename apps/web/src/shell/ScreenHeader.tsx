import type { ReactNode } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { AccountButton } from './AccountSheet';

interface Props {
  /** Context line above the title; wraps rather than truncates at large text sizes. */
  caption: ReactNode;
  title: ReactNode;
  /** Week navigation, shown beside the title so the caption keeps the full width. */
  onPrev?: () => void;
  onNext?: () => void;
  prevLabel?: string;
  nextLabel?: string;
}

export function ScreenHeader({
  caption,
  title,
  onPrev,
  onNext,
  prevLabel = 'Semana anterior',
  nextLabel = 'Semana siguiente',
}: Props) {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-3">
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 pt-2 text-secondary text-ink-soft">{caption}</p>
        <div className="lg:hidden">
          <AccountButton />
        </div>
      </div>
      {/* At large text sizes the chevrons wrap under the title instead of splitting words. */}
      <div className="flex flex-wrap items-center gap-x-1">
        <h1 className="mr-auto text-display font-bold">{title}</h1>
        <div className="flex items-center">
          {onPrev && (
            <button type="button" className="icon-btn" aria-label={prevLabel} onClick={onPrev}>
              <ChevronLeft aria-hidden size={24} />
            </button>
          )}
          {/* Says what the arrows move, so they never read as previous/next day. */}
          {(onPrev || onNext) && (
            <span aria-hidden className="text-secondary font-semibold text-ink-soft">
              Semana
            </span>
          )}
          {onNext && (
            <button
              type="button"
              className="icon-btn -mr-3"
              aria-label={nextLabel}
              onClick={onNext}
            >
              <ChevronRight aria-hidden size={24} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
