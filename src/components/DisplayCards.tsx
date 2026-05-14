import { useState } from 'react';
import { Copy, Check } from 'lucide-react';
import { surfaceCardClass } from '../lib/constants';
import type { WorkflowActivityItem } from '../shared/ipc';

export const TracePayloadPanel = ({ label, value }: { label: string; value: string }): JSX.Element => {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => { void navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 2000); };
  return (
    <details className="group mt-1.5">
      <summary className="flex cursor-pointer items-center justify-between list-none">
        <span className="text-2xs text-[var(--text-muted)]">{label}</span>
        <button onClick={(e) => { e.preventDefault(); handleCopy(); }} className="rounded p-1 text-[var(--text-muted)] hover:text-[var(--text-primary)] transition">{copied ? <Check size={11} /> : <Copy size={11} />}</button>
      </summary>
      <pre className="mt-1 whitespace-pre-wrap break-words rounded bg-[var(--surface-overlay)] px-2.5 py-2 font-mono text-2xs leading-4 text-[var(--text-muted)]">{value}</pre>
    </details>
  );
};

export const DetailCard = ({ label, value }: { label: string; value: string }): JSX.Element => (
  <section className={`${surfaceCardClass} px-3 py-2`}>
    <div className="text-2xs text-[var(--text-muted)]">{label}</div>
    <pre className="mt-1 whitespace-pre-wrap break-words font-mono text-2xs leading-4 text-[var(--text-secondary)]">{value}</pre>
  </section>
);

export const ActivityTraceCard = ({ item }: { item: WorkflowActivityItem }): JSX.Element => (
  <article className="rounded px-2 py-2">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex items-center gap-2">
        <span className="rounded bg-[var(--surface-overlay)] px-1 py-0.5 font-mono text-3xs text-[var(--text-muted)]">{item.label}</span>
        {item.toolName ? <span className="text-3xs text-[var(--text-muted)]">{item.toolName}</span> : null}
      </div>
      {typeof item.durationMs === 'number' ? <span className="text-3xs font-mono text-[var(--text-muted)]">{item.durationMs}ms</span> : null}
    </div>
    {item.text ? <div className="mt-1.5 whitespace-pre-wrap text-sm leading-6 text-[var(--text-primary)]">{item.text}</div> : null}
    {item.input ? <TracePayloadPanel label="Input" value={item.input} /> : null}
    {item.output ? <TracePayloadPanel label="Output" value={item.output} /> : null}
    {item.metadata ? <TracePayloadPanel label="Metadata" value={JSON.stringify(item.metadata, null, 2)} /> : null}
  </article>
);

export const PlanItem = ({ step, activeStepId }: { step: { step_id: number; description: string }; activeStepId: number }): JSX.Element => {
  const isActive = step.step_id === activeStepId;
  return (
    <div className={`rounded-md px-3 py-2 transition ${isActive ? 'bg-[var(--surface-overlay)]' : 'bg-transparent hover:bg-[var(--surface-overlay)]'}`}>
      <div className="text-2xs text-[var(--text-muted)]">Step {step.step_id}</div>
      <div className="mt-1 text-sm leading-6 text-[var(--text-secondary)]">{step.description}</div>
    </div>
  );
};
