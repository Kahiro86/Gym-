// Inline SVG icons. Drawn here rather than pulled from an icon font so
// the app has no CDN dependency (it must work offline) and so every
// stroke inherits currentColor — keeping colour under the token system.
interface IconProps {
  size?: number;
  className?: string;
}

const base = (size: number) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  focusable: false,
});

export const CheckIcon = ({ size = 16, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M20 6 9 17l-5-5" /></svg>
);

export const XIcon = ({ size = 15, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M18 6 6 18M6 6l12 12" /></svg>
);

export const PlusIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M12 5v14M5 12h14" /></svg>
);

export const FilterIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="M3 5h18l-7 8v6l-4 2v-8L3 5z" /></svg>
);

export const MoreIcon = ({ size = 18, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <circle cx="12" cy="5" r="1" fill="currentColor" />
    <circle cx="12" cy="12" r="1" fill="currentColor" />
    <circle cx="12" cy="19" r="1" fill="currentColor" />
  </svg>
);

export const ChevronDownIcon = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m6 9 6 6 6-6" /></svg>
);

export const ChevronRightIcon = ({ size = 14, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m9 6 6 6-6 6" /></svg>
);
