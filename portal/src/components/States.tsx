import type { ReactNode } from 'react';
import { CircleAlert, CircleCheck, SearchX } from 'lucide-react';

export function SkeletonRows({ count = 6 }: { count?: number }) {
  return (
    <div className="skeleton-list" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => (
        <div className="skeleton-row" key={i}>
          <div className="skeleton skeleton-icon" />
          <div className="skeleton-lines">
            <div className="skeleton" style={{ width: '55%' }} />
            <div className="skeleton" style={{ width: '35%' }} />
            <div className="skeleton" style={{ width: '70%' }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** `done`: nothing left to do (good news). `search`: nothing matches the search or filters. */
export function EmptyState({ title, children, icon = 'done', action }: {
  title: string; children?: ReactNode; icon?: 'done' | 'search';
  /** A next step, e.g. another queue that still has work in it. */
  action?: { text: string; label: string; onClick: () => void } | null;
}) {
  return (
    <div className={`state-block state-${icon}`}>
      <div className="state-icon" aria-hidden="true">{icon === 'search' ? <SearchX size={20} /> : <CircleCheck size={20} />}</div>
      <h3>{title}</h3>
      {children && <p>{children}</p>}
      {action && (
        <>
          <p className="state-next">{action.text}</p>
          <button type="button" className="btn btn-primary btn-sm" onClick={action.onClick}>{action.label}</button>
        </>
      )}
    </div>
  );
}

export function ErrorState({ title = 'We couldn’t load this.', message, onRetry }: {
  title?: string; message?: string; onRetry?: () => void;
}) {
  return (
    <div className="state-block state-error" role="alert">
      <div className="state-icon" aria-hidden="true"><CircleAlert size={20} /></div>
      <h3>{title}</h3>
      {message && <p>{message}</p>}
      {onRetry && <button type="button" className="btn btn-secondary" onClick={onRetry}>Try again</button>}
    </div>
  );
}
