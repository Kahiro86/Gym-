import { PlateLoader } from "./PlateLoader.js";
import styles from "./LoadingScreen.module.css";

export interface LoadingScreenProps {
  label?: string;
}

// A full-viewport centered PlateLoader for the handful of top-level
// "still resolving" gaps (database opening, onboarding's own startup
// check) that briefly render before there's anything else to show.
export function LoadingScreen({ label }: LoadingScreenProps) {
  return (
    <div className={styles.screen}>
      <PlateLoader size={56} label={label} />
    </div>
  );
}
