import type { HTMLAttributes, PropsWithChildren } from "react";

interface GlassCardProps extends PropsWithChildren, HTMLAttributes<HTMLDivElement> {
  className?: string;
  tone?: "default" | "soft" | "active";
}

export function GlassCard({ children, className = "", tone = "default", ...props }: GlassCardProps) {
  const toneClass = tone === "soft" ? "glass-soft" : tone === "active" ? "glass-panel soft-glow" : "glass-card";
  return <div className={`${toneClass} rounded-2xl ${className}`} {...props}>{children}</div>;
}
