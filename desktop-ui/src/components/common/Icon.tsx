import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Svg({ children, size = 18, ...props }: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {children}
    </svg>
  )
}

/* Activity bar */
export function IconData(props: IconProps) {
  return <Svg {...props}><ellipse cx="12" cy="5" rx="8" ry="3"/><path d="M4 5v6c0 1.7 3.6 3 8 3s8-1.3 8-3V5"/><path d="M4 11v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6"/></Svg>
}
export function IconTable(props: IconProps) {
  return <Svg {...props}><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/></Svg>
}
export function IconChart(props: IconProps) {
  return <Svg {...props}><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 4-6"/></Svg>
}

/* Title bar window controls */
export function IconMinimize(props: IconProps) {
  return <Svg {...props} size={16}><path d="M5 12h14"/></Svg>
}
export function IconMaximize(props: IconProps) {
  return <Svg {...props} size={16}><rect x="5" y="5" width="14" height="14" rx="1"/></Svg>
}
export function IconRestore(props: IconProps) {
  return <Svg {...props} size={16}><rect x="7" y="4" width="12" height="12" rx="1"/><path d="M4 8V7a2 2 0 0 1 2-2h1"/></Svg>
}
export function IconClose(props: IconProps) {
  return <Svg {...props} size={16}><path d="M6 6l12 12M18 6l-12 12"/></Svg>
}

/* Panel toggles */
export function IconChevronLeft(props: IconProps) {
  return <Svg {...props}><path d="M15 6l-6 6 6 6"/></Svg>
}
export function IconChevronRight(props: IconProps) {
  return <Svg {...props}><path d="M9 6l6 6-6 6"/></Svg>
}
export function IconChevronUp(props: IconProps) {
  return <Svg {...props}><path d="M18 15l-6-6-6 6"/></Svg>
}
export function IconChevronDown(props: IconProps) {
  return <Svg {...props}><path d="M6 9l6 6 6-6"/></Svg>
}

/* File / folder */
export function IconFile(props: IconProps) {
  return <Svg {...props}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/></Svg>
}
export function IconFolderOpen(props: IconProps) {
  return <Svg {...props}><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></Svg>
}

/* Actions */
export function IconPlay(props: IconProps) {
  return <Svg {...props}><circle cx="12" cy="12" r="10"/><path d="M10 8l6 4-6 4z" fill="currentColor" stroke="none"/></Svg>
}
export function IconSearch(props: IconProps) {
  return <Svg {...props}><circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/></Svg>
}
export function IconRefresh(props: IconProps) {
  return <Svg {...props}><path d="M1 4v6h6M23 20v-6h-6"/><path d="M20.49 9A9 9 0 0 0 5.64 5.64L1 10m22 4l-4.64 4.36A9 9 0 0 1 3.51 15"/></Svg>
}

/* Status */
export function IconCircle(props: IconProps & { fill?: string }) {
  const { fill, ...rest } = props
  return <Svg {...rest}><circle cx="12" cy="12" r="6" fill={fill ?? 'currentColor'} stroke="none"/></Svg>
}

/* Terminal */
export function IconTerminal(props: IconProps) {
  return <Svg {...props}><path d="M4 17l6-6-6-6M12 19h8"/></Svg>
}

/* Export */
export function IconDownload(props: IconProps) {
  return <Svg {...props}><path d="M6 21h12"/><path d="M12 3v14"/><path d="M8 13l4 4 4-4"/></Svg>
}
