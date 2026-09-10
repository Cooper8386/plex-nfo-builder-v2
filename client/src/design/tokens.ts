/** CSS custom properties are the single source of values for both themes. */
export const tokens = {
  color: {
    canvas: 'var(--color-canvas)', paper: 'var(--color-paper)', ink: 'var(--color-ink)',
    muted: 'var(--color-muted)', accent: 'var(--color-accent)', border: 'var(--color-border)',
    rail: 'var(--color-rail)', focus: 'var(--color-focus)',
  },
  font: { body: 'var(--font-body)', display: 'var(--font-display)' },
  space: { xs: 'var(--space-1)', sm: 'var(--space-2)', md: 'var(--space-3)', lg: 'var(--space-4)', xl: 'var(--space-6)', xxl: 'var(--space-8)' },
  radius: { control: 'var(--radius-control)', panel: 'var(--radius-panel)' },
  shadow: { popover: 'var(--shadow-popover)' },
} as const;
