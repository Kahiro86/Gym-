import { NavLink } from "react-router-dom";
import styles from "./TabBar.module.css";

interface TabDef {
  to: string;
  label: string;
}

// Order matches spec §14's route list: Today/History/Start/Progress/More.
const TABS: TabDef[] = [
  { to: "/today", label: "Today" },
  { to: "/history", label: "History" },
  { to: "/start", label: "Start" },
  { to: "/progress", label: "Progress" },
  { to: "/more", label: "More" },
];

export function TabBar() {
  return (
    <nav className={styles.tabBar} aria-label="Primary">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          className={({ isActive }) => (isActive ? `${styles.tab} ${styles.tabActive}` : styles.tab)}
        >
          {tab.label}
        </NavLink>
      ))}
    </nav>
  );
}
