import { PreferencesSection } from "../settings/PreferencesSection.js";
import { ProfileSection } from "../settings/ProfileSection.js";
import { RoutinesSection } from "../settings/RoutinesSection.js";
import styles from "./MoreScreen.module.css";

// Settings + routines editor (spec §14 task 16): device preferences,
// synced profile fields, and routine management, in one tab.
export function MoreScreen() {
  return (
    <div className={styles.screen}>
      <h1>More</h1>
      <PreferencesSection />
      <ProfileSection />
      <RoutinesSection />
    </div>
  );
}
