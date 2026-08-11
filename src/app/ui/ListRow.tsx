import type { ButtonHTMLAttributes, ReactNode } from "react";
import styles from "./ListRow.module.css";

export interface ListRowProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "className"> {
  leading?: ReactNode;
  label: ReactNode;
  description?: ReactNode;
  trailing?: ReactNode;
  className?: string;
}

// Renders a <button> whenever onClick is provided (an interactive row,
// e.g. "resume this session") and a plain row otherwise — never a
// clickable <div>, so keyboard/screen-reader semantics come for free.
// >=56px tall (spec §2), a safe tap target inside any list.
export function ListRow({ leading, label, description, trailing, className, onClick, ...rest }: ListRowProps) {
  const classes = [styles.row, onClick ? styles.interactive : "", className].filter(Boolean).join(" ");
  const content = (
    <>
      {leading && <span className={styles.leading}>{leading}</span>}
      <span className={styles.body}>
        <span className={styles.label}>{label}</span>
        {description && <span className={styles.description}>{description}</span>}
      </span>
      {trailing && <span className={styles.trailing}>{trailing}</span>}
    </>
  );

  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...rest}>
        {content}
      </button>
    );
  }

  return <div className={classes}>{content}</div>;
}
