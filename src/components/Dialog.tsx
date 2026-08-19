import { useEffect, type ReactNode } from "react";

type DialogProps = {
  title: string;
  onClose: () => void;
  children: ReactNode;
};

export function Dialog({ title, onClose, children }: DialogProps) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="dialog-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="dialog" role="dialog" aria-modal="true" aria-label={title}>
        <h2 className="subtitle">{title}</h2>
        {children}
      </div>
    </div>
  );
}
