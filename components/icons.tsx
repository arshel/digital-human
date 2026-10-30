import type { ReactNode } from "react";

// Pictogrammen staan altijd naast of boven tekst, nooit alleen. Daarom aria-hidden.
function Icon({ children, size = 24 }: { children: ReactNode; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

export function PlayIcon() {
  return (
    <Icon>
      <path d="M7 4.5v15l12-7.5z" fill="currentColor" />
    </Icon>
  );
}

export function PauseIcon() {
  return (
    <Icon>
      <rect
        x="6"
        y="5"
        width="4"
        height="14"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
      <rect
        x="14"
        y="5"
        width="4"
        height="14"
        rx="1"
        fill="currentColor"
        stroke="none"
      />
    </Icon>
  );
}

export function ReplayIcon() {
  return (
    <Icon>
      <path d="M4 12a8 8 0 1 0 2.5-5.8" />
      <path d="M4 3.5V8h4.5" />
      <path d="M10.5 9v6l4.5-3z" fill="currentColor" />
    </Icon>
  );
}

export function MoreIcon() {
  return (
    <Icon>
      <path d="M6 9l6 6 6-6" />
    </Icon>
  );
}

export function LessIcon() {
  return (
    <Icon>
      <path d="M6 15l6-6 6 6" />
    </Icon>
  );
}

export function ExplainIcon() {
  return (
    <Icon>
      <path d="M4 4h16v12H9l-5 4z" />
      <path d="M8 8.5h8M8 12h5" />
    </Icon>
  );
}

export function AskIcon() {
  return (
    <Icon>
      <path d="M4 20h4L19 9l-4-4L4 16z" />
      <path d="M13.5 6.5l4 4" />
    </Icon>
  );
}

export function NextIcon() {
  return (
    <Icon>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  );
}

export function NewsIcon() {
  return (
    <Icon>
      <path d="M4 5h13v14H6a2 2 0 0 1-2-2z" />
      <path d="M17 9h3v8a2 2 0 0 1-2 2M8 9h5M8 13h5" />
    </Icon>
  );
}

export function InfoIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v6M12 7.5v.5" />
    </Icon>
  );
}

export function SourceIcon() {
  return (
    <Icon>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h4" />
    </Icon>
  );
}

export function ExternalIcon() {
  return (
    <Icon size={20}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
    </Icon>
  );
}

export function CloseIcon() {
  return (
    <Icon>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  );
}

export function SimplerIcon() {
  return (
    <Icon>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </Icon>
  );
}

export function MeaningIcon() {
  return (
    <Icon>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .8-1 1.5v.4M12 17.2v.1" />
    </Icon>
  );
}

export function WhyIcon() {
  return (
    <Icon>
      <path d="M9.5 18h5M10.5 21h3" />
      <path d="M12 3a6 6 0 0 0-3.4 10.9c.6.5.9 1.1.9 1.8V16h5v-.3c0-.7.3-1.3.9-1.8A6 6 0 0 0 12 3z" />
    </Icon>
  );
}

export function AgainIcon() {
  return (
    <Icon>
      <path d="M4 12a8 8 0 0 1 14-5.3L20 9" />
      <path d="M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15" />
      <path d="M4 20v-5h5" />
    </Icon>
  );
}

export function SendIcon() {
  return (
    <Icon>
      <path d="M12 19V5M6 11l6-6 6 6" />
    </Icon>
  );
}

export function CaptionsIcon() {
  return (
    <Icon>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M7 11h4M13 11h4M7 15h7" />
    </Icon>
  );
}

export function TextSizeIcon() {
  return (
    <Icon>
      <path d="M3 18l4-11 4 11M4.5 14h5M13 18l4-15 4 15M14.5 13h5" />
    </Icon>
  );
}

export function AccessibilityIcon() {
  return (
    <Icon>
      <circle cx="12" cy="3.5" r="1.5" />
      <path d="M5 8l7 2 7-2M12 10v5M8 22l4-7 4 7M9 9l-1 6M15 9l1 6" />
    </Icon>
  );
}
