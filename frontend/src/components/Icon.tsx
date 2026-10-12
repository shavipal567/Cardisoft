import type { ComponentType, SVGProps } from "react";

export type IconComponent = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string; strokeWidth?: number | string }>;

interface IconProps {
  component: IconComponent;
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
  ariaHidden?: boolean;
  label?: string;
}

export default function Icon({
  component: LucideIcon,
  size = 18,
  className = "",
  strokeWidth = 1.75,
  ariaHidden = true,
  label,
}: IconProps) {
  const isDecorative = ariaHidden || !label;
  return (
    <LucideIcon
      size={size}
      strokeWidth={strokeWidth}
      className={className}
      aria-hidden={isDecorative ? true : undefined}
      aria-label={label}
      role={isDecorative ? undefined : "img"}
      focusable="false"
    />
  );
}
