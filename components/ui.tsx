import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode, TableHTMLAttributes } from "react";
import { AlertTriangle, CheckCircle2, Clock, Loader2 } from "lucide-react";
import type { AgentStatus } from "@/lib/types";

type Tone = "default" | "accent" | "emerald" | "amber" | "rose";

interface GlassPanelProps extends PropsWithChildren {
  className?: string;
  compact?: boolean;
}

export function GlassPanel({ children, className = "", compact = false }: GlassPanelProps) {
  return <section className={`glass-panel rounded-2xl ${compact ? "p-4" : "p-5 sm:p-6"} ${className}`}>{children}</section>;
}

export function MetricCard({
  label,
  value,
  detail,
  tone = "default",
  className = "",
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: Tone;
  className?: string;
}) {
  return (
    <div className={`glass-card rounded-2xl p-4 ${className}`}>
      <div className={`metric-number text-2xl font-semibold ${toneText(tone)}`}>{value}</div>
      <div className="mt-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400/70">{label}</div>
      {detail ? <p className="mt-2 text-xs leading-5 muted-text">{detail}</p> : null}
    </div>
  );
}

export function AgentCard({
  name,
  status,
  output,
  progress,
  onClick,
}: {
  name: string;
  status: AgentStatus;
  output?: string;
  progress?: number;
  onClick?: () => void;
}) {
  const content = (
    <>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <StatusDot status={status} />
          <p className="truncate text-sm font-semibold text-white">{name.replace(" Agent", "")}</p>
        </div>
        <StatusPill status={status} compact />
      </div>
      <p className="mt-3 line-clamp-2 min-h-10 text-xs leading-5 muted-text">{output || "Waiting for a role command."}</p>
      {typeof progress === "number" ? (
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.07]">
          <div className="h-full rounded-full bg-white/75" style={{ width: `${Math.max(4, Math.min(100, progress))}%` }} />
        </div>
      ) : null}
    </>
  );

  if (onClick) {
    return (
      <button onClick={onClick} className="glass-card w-full rounded-2xl p-4 text-left hover:border-white/20 hover:bg-white/[0.07]">
        {content}
      </button>
    );
  }

  return <div className="glass-card rounded-2xl p-4">{content}</div>;
}

export function PrimaryButton({
  children,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & PropsWithChildren) {
  return (
    <button
      className={`glass-button inline-flex items-center justify-center gap-2 rounded-full px-5 py-3 text-sm font-semibold text-white hover:border-white/25 hover:bg-white/[0.14] disabled:cursor-not-allowed disabled:opacity-50 ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}

export function StatusPill({ status, compact = false }: { status: AgentStatus | string; compact?: boolean }) {
  const normalized = status.toLowerCase();
  const color =
    normalized === "completed" || normalized === "active" || normalized === "interested"
      ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
      : normalized === "warning" || normalized === "follow_up_needed"
        ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
        : normalized === "error" || normalized === "not_interested"
          ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
          : normalized === "running"
            ? "border-violet-300/25 bg-violet-300/10 text-violet-100"
            : "border-white/12 bg-white/[0.06] text-slate-300";

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide ${color}`}>
      {status === "running" ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
      {compact ? String(status).slice(0, 4) : String(status).replaceAll("_", " ")}
    </span>
  );
}

export function SectionHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0 flex-1">
        {eyebrow ? <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-slate-400/70">{eyebrow}</p> : null}
        <h2 className="mt-1 truncate text-xl font-semibold tracking-tight text-white">{title}</h2>
        {description ? <p className="mt-1 max-w-2xl text-sm leading-6 muted-text">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-dashed border-white/15 bg-white/[0.025] p-6 text-center">
      {icon ? <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.07] text-white">{icon}</div> : null}
      <h3 className="text-sm font-semibold text-white">{title}</h3>
      {description ? <p className="mx-auto mt-2 max-w-md text-sm leading-6 muted-text">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function DataTable({ className = "", children, ...props }: TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="scrollbar-slim overflow-auto rounded-2xl border border-white/10 bg-black/10">
      <table className={`w-full text-left text-sm ${className}`} {...props}>
        {children}
      </table>
    </div>
  );
}

function StatusDot({ status }: { status: AgentStatus }) {
  if (status === "completed") return <CheckCircle2 className="h-4 w-4 text-emerald-300" />;
  if (status === "warning") return <AlertTriangle className="h-4 w-4 text-amber-300" />;
  if (status === "error") return <AlertTriangle className="h-4 w-4 text-rose-300" />;
  if (status === "running") return <Loader2 className="h-4 w-4 animate-spin text-violet-200" />;
  return <Clock className="h-4 w-4 text-slate-500" />;
}

function toneText(tone: Tone) {
  if (tone === "accent") return "text-violet-100";
  if (tone === "emerald") return "text-emerald-100";
  if (tone === "amber") return "text-amber-100";
  if (tone === "rose") return "text-rose-100";
  return "text-white";
}
