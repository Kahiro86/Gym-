import styles from "./PlateLoader.module.css";

export interface PlateLoaderProps {
  size?: number;
  label?: string;
}

// The "calibrated iron" identity's signature loading element (spec §3.3):
// three plates — 10kg green, 15kg yellow, 25kg red, smallest to largest
// like real plates — sliding onto a bar in a staggered pulse. Stands in
// for a generic spinner wherever the app needs to show "this is loading."
// Never for write actions (§2 keeps those spinner-free) — this is for
// data fetches: the database opening, an initial screen's first query.
export function PlateLoader({ size = 48, label = "Loading" }: PlateLoaderProps) {
  return (
    <svg
      className={styles.loader}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={label}
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect x="4" y="30" width="56" height="4" rx="2" fill="var(--chalk-dim)" />
      <rect className={`${styles.plate} ${styles.plate1}`} x="14" y="16" width="8" height="32" rx="3" fill="var(--plate-green)" />
      <rect className={`${styles.plate} ${styles.plate2}`} x="26" y="12" width="10" height="40" rx="3" fill="var(--plate-yellow)" />
      <rect className={`${styles.plate} ${styles.plate3}`} x="40" y="8" width="12" height="48" rx="3" fill="var(--plate-red)" />
    </svg>
  );
}
