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

export const ChevronLeftIcon = ({ size = 20, className }: IconProps) => (
  <svg {...base(size)} className={className}><path d="m15 18-6-6 6-6" /></svg>
);

export const EditIcon = ({ size = 17, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
  </svg>
);

export const RepeatIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="m17 2 4 4-4 4" />
    <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
    <path d="m7 22-4-4 4-4" />
    <path d="M21 13v1a4 4 0 0 1-4 4H3" />
  </svg>
);

export const FlameIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M8.5 14.5A2.5 2.5 0 0 0 11 12c0-1.38-.5-2-1-3-1.072-2.143-.224-4.054 2-6 .5 2.5 2 4.9 4 6.5 2 1.6 3 3.5 3 5.5a7 7 0 1 1-14 0c0-1.153.433-2.294 1-3a2.5 2.5 0 0 0 2.5 2.5Z" />
  </svg>
);

export const TrophyIcon = ({ size = 12, className }: IconProps) => (
  <svg {...base(size)} className={className}>
    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
    <path d="M4 22h16" />
    <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22" />
    <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22" />
    <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
  </svg>
);
