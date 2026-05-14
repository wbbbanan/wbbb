import type { RuntimeHealthCheck as HealthCheckType } from '../shared/ipc';
import { CheckCircle, AlertTriangle, XCircle } from 'lucide-react';

const STATUS_CONFIG = {
  healthy: { icon: CheckCircle, color: 'text-[var(--success)]', bg: 'bg-[var(--success-subtle)]', border: 'border-[var(--success)]/20' },
  warning: { icon: AlertTriangle, color: 'text-[var(--warning)]', bg: 'bg-[var(--warning-subtle)]', border: 'border-[var(--warning)]/20' },
  error: { icon: XCircle, color: 'text-[var(--error)]', bg: 'bg-[var(--error-subtle)]', border: 'border-[var(--error)]/20' },
};

export const HealthCheckCard = ({ check }: { check: HealthCheckType }): JSX.Element => {
  const config = STATUS_CONFIG[check.status];
  const Icon = config.icon;

  return (
    <details className={`rounded-lg border px-4 py-3 transition ${config.bg} ${config.border}`}>
      <summary className="cursor-pointer list-none">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Icon size={14} className={config.color} />
            <div>
              <div className="text-sm font-medium text-[var(--text-primary)]">{check.label}</div>
              <div className="text-xs text-[var(--text-secondary)]">{check.summary}</div>
            </div>
          </div>
          <span className="text-2xs font-medium uppercase text-[var(--text-muted)]">{check.status}</span>
        </div>
      </summary>
      <div className="mt-3 space-y-2 border-t border-[var(--border-subtle)] pt-3 text-xs leading-5 text-[var(--text-secondary)]">
        {check.details.map((detail) => (
          <div key={detail} className="whitespace-pre-wrap break-words">
            {detail}
          </div>
        ))}
      </div>
    </details>
  );
};
