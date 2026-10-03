import { cloneElement, isValidElement, type ReactElement, type ReactNode } from "react";

export function Icon({ name, size = 16 }: { name: string; size?: number }) {
  const paths: Record<string, ReactNode> = {
    moon: <path d="M20.5 13a9 9 0 0 1-9.5-9.5A9 9 0 1 0 20.5 13Z" />,
    sun: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1.5 1.5M17.5 17.5 19 19M5 19l1.5-1.5M17.5 6.5 19 5" />
      </>
    ),
    data: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 9h18M9 9v11" />
      </>
    ),
    settings: (
      <>
        <path d="M4 7h16M4 17h16" />
        <circle cx="9" cy="7" r="3" />
        <circle cx="16" cy="17" r="3" />
      </>
    ),
    unknowns: (
      <>
        <path d="M8 3h8M9 3v7l-5 8a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-8V3M7 15h10" />
      </>
    ),
    results: (
      <>
        <path d="M5 20V10M12 20V4M19 20v-7M3 20h18" />
      </>
    ),
    plots: (
      <>
        <path d="M3 3v18h18M6 17c7 0 4-10 14-10" />
      </>
    ),
    guide: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 11v6M12 7h.01" />
      </>
    ),
    file: (
      <>
        <path d="M5 3h9l5 5v13H5zM14 3v6h5M8 13h8M8 17h5" />
      </>
    ),
    chevron: <path d="m9 5 7 7-7 7" />,
    menu: <path d="M4 6h16M4 12h16M4 18h16" />,
    download: (
      <>
        <path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5" />
      </>
    ),
    play: <path d="m8 4 12 8-12 8z" />,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6" />,
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.55"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field" data-field={label}>
      <span>{label}</span>
      {isValidElement(children)
        ? cloneElement(children as ReactElement<{"aria-label"?: string}>, {"aria-label": (children.props as {"aria-label"?: string})["aria-label"] ?? label})
        : children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Card({
  title,
  subtitle,
  children,
  className = "",
  action,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  return (
    <section className={`card ${className}`}>
      <div className="card-heading">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
export function Pager({
  page,
  count,
  size,
  onChange,
}: {
  page: number;
  count: number;
  size: number;
  onChange: (page: number) => void;
}) {
  const pages = Math.max(1, Math.ceil(count / size));
  const safePage = Math.min(page, pages - 1);
  return (
    <div className="pager">
      <span>
        {count
          ? `${safePage * size + 1}–${Math.min(count, (safePage + 1) * size)} / ${count}`
          : "0 行"}
      </span>
      <div>
        <button
          aria-label="上一页"
          disabled={safePage === 0}
          onClick={() => onChange(safePage - 1)}
        >
          ‹
        </button>
        <span>
          {safePage + 1} / {pages}
        </span>
        <button
          aria-label="下一页"
          disabled={safePage + 1 === pages}
          onClick={() => onChange(safePage + 1)}
        >
          ›
        </button>
      </div>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty-icon">
        <Icon name="plots" size={27} />
      </span>
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
