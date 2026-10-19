import { useEffect, useRef, type ReactNode } from "react";

// Native details keeps keyboard navigation and works without per-frame state.
export default function HudPopover({
  className,
  label,
  children,
}: {
  className: string;
  label: ReactNode;
  children: ReactNode;
}) {
  const element = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const panel = element.current;
      if (
        panel?.open &&
        event.target instanceof Node &&
        !panel.contains(event.target)
      )
        panel.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !element.current?.open) return;
      element.current.open = false;
      element.current.querySelector("summary")?.focus();
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("pointerdown", outside);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointerdown", outside);
      document.removeEventListener("keydown", escape, true);
    };
  }, []);
  return (
    <details ref={element} className={className}>
      <summary>{label}</summary>
      {children}
    </details>
  );
}
