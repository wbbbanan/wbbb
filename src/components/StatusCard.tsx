import { surfaceCardClass } from '../lib/constants';

export const StatusCard = ({ label, value, accent }: { label: string; value: string; accent: string }): JSX.Element => (
  <div className={`${surfaceCardClass} px-4 py-3`}>
    <div className="font-mono text-[11px] uppercase tracking-[0.24em] text-stone-500">{label}</div>
    <div className={`mt-2 text-lg font-semibold ${accent}`}>{value}</div>
  </div>
);
