# Theme — Merchant Platform (Local Life Marketing)

## Design Direction
- **v3 Zen Editorial (禅意编辑式)**: Warm cream canvas + earth-green action + gold ceremony
- **Inspiration**: Starbucks editorial aesthetic — warm neutrals, restrained green accents, serif headlines
- **Scope**: Only `/merchant` routes via `.ll-root` container class; Video Studio (`--cine-*`) unaffected

## Color Tokens (--ll-*)

```css
:root {
  /* Green family (action/trust — Starbucks 4-level green) */
  --ll-green: #00754A;           /* Action primary: CTA / selected */
  --ll-green-sb: #006241;        /* Headlines / hover */
  --ll-green-active: #005C3A;    /* Pressed state */
  --ll-house: #1E3932;           /* Deep green band (membership header) */
  --ll-green-light: #D4E9E2;     /* Light green bg: selected bg / success dim */
  /* Gold (membership/points ceremony) */
  --ll-gold: #CBA258;
  --ll-gold-light: #DFC49D;
  --ll-gold-lightest: #FAF6EE;
  --ll-gold-ink: #8A6D2F;        /* Dark text on gold bg */
  /* Neutrals (warm cream) */
  --ll-canvas: #F2F0EB;          /* Main canvas warm cream */
  --ll-ceramic: #EDEBE9;         /* Secondary bg / separator area */
  --ll-surface: #FFFFFF;         /* Cards / modals */
  --ll-cool: #F9F9F9;            /* Form / dropdown light bg */
  --ll-hair: #E7E7E7;            /* 1px hairline separator */
  --ll-border-strong: #D6DBDE;
  --ll-text: rgba(0,0,0,0.87);   /* Primary text (not pure black) */
  --ll-text-2: rgba(0,0,0,0.58); /* Secondary text */
  --ll-text-3: rgba(0,0,0,0.40); /* Tertiary / placeholder */
  /* Semantic status */
  --ll-success: #00754A; --ll-success-dim: #D4E9E2;
  --ll-warning: #B5791F; --ll-warning-dim: #FDF3E3;
  --ll-danger: #C82014;  --ll-danger-dim: #FBEAE5;
  --ll-info: #2F6F9E;    --ll-info-dim: #E6F0F7;
  /* Shadows (soft multi-layer, Starbucks feel) */
  --ll-shadow-card: 0 0 .5px rgba(0,0,0,.14), 0 1px 1px rgba(0,0,0,.24);
  --ll-shadow-pop: 0 8px 24px rgba(30,57,50,.14);
  --ll-shadow-frap: 0 0 6px rgba(0,0,0,.24), 0 8px 12px rgba(0,0,0,.14);
}
```

## v3 Zen Canvas Upgrade (.ll-root overrides)

```css
.ll-root {
  background: var(--ll-canvas);
  color: var(--ll-text);
  font-family: var(--font-sans), -apple-system, system-ui, sans-serif;
  letter-spacing: -0.01em;

  /* v3 Zen Font Variables */
  --font-serif: var(--font-noto-serif-sc), 'Noto Serif SC', serif;
  --font-sans: var(--font-noto-sans-sc), 'Noto Sans SC', -apple-system, sans-serif;
  --font-num: var(--font-space-grotesk), 'Space Grotesk', sans-serif;

  /* v3 Zen Type Scale */
  --text-hero: 29px;
  --text-title: 17px;
  --text-body: 14px;
  --text-aux: 11px;

  /* v3 Zen Motion Curves */
  --ease-out: cubic-bezier(.16, 1, .3, 1);
  --ease-spring: cubic-bezier(.23, 1.4, .32, 1);
  --dur-fast: 150ms;
  --dur-base: 300ms;
  --dur-slow: 600ms;

  /* v3 Zen Canvas */
  --ll-canvas: #F4F2ED;
  --ll-green-deep: #0E3A2A;

  /* v3 Zen Border Radius (restrained 3px) */
  --radius: 0.1875rem;
}
```

## Typography
- **Headlines**: Noto Serif SC (variable `--font-noto-serif-sc`, weights 500/600/700)
- **Body/UI**: Noto Sans SC (variable `--font-noto-sans-sc`, weights 400/500/700)
- **Numbers**: Space Grotesk (variable `--font-space-grotesk`, weights 400/500/600/700)
- **Type scale**: hero 29px, title 17px, body 14px, aux 11px

## shadcn Token Remapping (inside .ll-root)

```css
.ll-root {
  --background: #F4F2ED;
  --foreground: #1A1714;
  --card: #FBFAF7;
  --card-foreground: #1A1714;
  --popover: var(--ll-surface);
  --popover-foreground: var(--ll-text);
  --primary: #00754A;
  --primary-foreground: #FFFFFF;
  --secondary: var(--ll-ceramic);
  --secondary-foreground: var(--ll-text);
  --muted: #EDEBE9;
  --muted-foreground: var(--ll-text-2);
  --accent: var(--ll-green-light);
  --accent-foreground: var(--ll-green-sb);
  --destructive: var(--ll-danger);
  --border: rgba(26, 23, 20, .09);
  --input: rgba(26, 23, 20, .09);
  --ring: var(--ll-green);
}
```

## Tailwind Palette Remapping (inside .ll-root)
- `orange-*` → earth green family
- `amber-*` → green family (lighter shades → cream)
- `gray-*` → warm neutral (cream-based)
- `yellow-*` → gold family (milestone/membership)
- `green-*` / `emerald-*` → unified earth green

## Animations

### Zen Reveal (stagger entrance)
```css
.zen-reveal {
  opacity: 0;
  transform: translateY(14px);
  animation: zen-revealIn var(--dur-slow) var(--ease-out) forwards;
}
@keyframes zen-revealIn {
  to { opacity: 1; transform: translateY(0); }
}
/* nth-child delays: 0ms, 60ms, 120ms, 180ms, 240ms, 300ms, 360ms */
.zen-reveal:nth-child(1) { animation-delay: 0ms; }
.zen-reveal:nth-child(2) { animation-delay: 60ms; }
/* ... up to nth-child(7) */
```

### Press micro-interaction
```css
.ll-press:active { transform: scale(0.95); }
```

### Paper noise texture
```css
.ll-root::after {
  /* SVG feTurbulence fractalNoise, opacity 0.025 */
  /* Warm cream paper texture, pointer-events: none */
}
```

## Accessibility
- `@media (prefers-reduced-motion: reduce)`: disables zen-reveal animation, noise texture
- Notification badge: `99+` cap for overflow

## Icons
- Library: `lucide-react`
- Stroke width: 1.5 (consistent)
- Size tiers: aux h-4(16px) / body h-5(20px) / feature h-6(24px)
