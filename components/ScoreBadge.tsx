interface ScoreBadgeProps {
  score: number;
  label?: string;
  size?: "sm" | "md" | "lg";
}

export function ScoreBadge({ score, label = "Score", size = "md" }: ScoreBadgeProps) {
  const color =
    score >= 85
      ? "from-emerald-400 to-cyan-300 text-emerald-950"
      : score >= 70
        ? "from-cyan-400 to-blue-400 text-slate-950"
        : score >= 55
          ? "from-amber-300 to-orange-400 text-slate-950"
          : "from-rose-400 to-fuchsia-400 text-white";
  const dimension = size === "lg" ? "h-20 w-20" : size === "sm" ? "h-12 w-12" : "h-16 w-16";
  const text = size === "lg" ? "text-2xl" : size === "sm" ? "text-sm" : "text-xl";

  return (
    <div className="flex items-center gap-3">
      <div className={`${dimension} rounded-full bg-gradient-to-br ${color} p-[2px] shadow-glow`}>
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-slate-950/92">
          <span className={`${text} metric-number font-semibold text-white`}>{score}</span>
          <span className="text-[10px] uppercase tracking-wide text-slate-400">{label}</span>
        </div>
      </div>
    </div>
  );
}
