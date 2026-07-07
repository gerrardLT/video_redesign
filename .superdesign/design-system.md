# Design System — Local Life Marketing Platform (本地生活营销平台)

## Product Context
- **Product**: AI-powered local life marketing platform for small business owners (restaurants, cafés, retail)
- **Target users**: Non-technical merchants who want to create short-form marketing videos with minimal effort
- **Core flow**: Merchant → Daily task brief → Shoot & upload → AI generates video variants → Publish to social platforms
- **Key pages**: Store Home (daily tasks), Calendar (weekly plan), Shoot & Upload, Video Variants, Growth/Membership
- **Platform**: Mobile-first web app (primarily accessed on phones), desktop as secondary

## Brand Identity
- **Name**: 魔推 (MoTui) — Magic Push for local marketing
- **Personality**: Warm, trustworthy, effortless — like a barista who remembers your order
- **Visual language**: Zen Editorial — inspired by Starbucks' editorial aesthetic with warm cream canvas, restrained earth-green accents, and serif headlines

## Color System

### Primary Palette
| Token | Value | Usage |
|-------|-------|-------|
| `--ll-green` | `#00754A` | Primary action (CTA buttons, active states, progress) |
| `--ll-green-sb` | `#006241` | Headlines, hover states |
| `--ll-green-active` | `#005C3A` | Pressed/active states |
| `--ll-house` | `#1E3932` | Deep green bands (membership headers, feature sections) |
| `--ll-green-light` | `#D4E9E2` | Light green backgrounds (selected bg, success dim) |
| `--ll-green-deep` | `#0E3A2A` | Deepest green (button press state) |

### Gold (Ceremony & Achievement)
| Token | Value | Usage |
|-------|-------|-------|
| `--ll-gold` | `#CBA258` | Membership badges, achievement highlights |
| `--ll-gold-light` | `#DFC49D` | Gold secondary |
| `--ll-gold-lightest` | `#FAF6EE` | Lightest gold background |
| `--ll-gold-ink` | `#8A6D2F` | Dark text on gold backgrounds |

### Neutrals (Warm Cream)
| Token | Value | Usage |
|-------|-------|-------|
| `--ll-canvas` | `#F4F2ED` | Main canvas (warm cream background) |
| `--ll-ceramic` | `#EDEBE9` | Secondary background / separator areas |
| `--ll-surface` | `#FFFFFF` | Cards / modals |
| `--ll-cool` | `#F9F9F9` | Form inputs / dropdown light background |
| `--ll-hair` | `#E7E7E7` | 1px hairline separators |
| `--ll-border-strong` | `#D6DBDE` | Stronger borders |

### Text
| Token | Value | Usage |
|-------|-------|-------|
| `--ll-text` | `rgba(0,0,0,0.87)` | Primary text (warm near-black) |
| `--ll-text-2` | `rgba(0,0,0,0.58)` | Secondary text |
| `--ll-text-3` | `rgba(0,0,0,0.40)` | Tertiary / placeholder |

### Semantic Status
| Status | Color | Dim background |
|--------|-------|----------------|
| Success | `#00754A` | `#D4E9E2` |
| Warning | `#B5791F` | `#FDF3E3` |
| Danger | `#C82014` | `#FBEAE5` |
| Info | `#2F6F9E` | `#E6F0F7` |

## Typography

### Font Stack
- **Headlines (serif)**: Noto Serif SC, weights 500/600/700, CSS variable `--font-serif`
- **Body/UI (sans)**: Noto Sans SC, weights 400/500/700, CSS variable `--font-sans`
- **Numbers**: Space Grotesk, weights 400/500/600/700, CSS variable `--font-num`

### Type Scale
| Level | Size | Usage |
|-------|------|-------|
| Hero | 29px | TodayTaskCard headline |
| Title | 17px | Section headers |
| Body | 14px | Paragraph text, ZenButton |
| Aux | 11px | Kicker labels, secondary info |

### Letter Spacing
- Root: `-0.01em` (slightly tight)
- ZenButton: `0.04em`
- Kicker: `0.1em`

## Spacing & Layout
- **Container**: `max-w-lg mx-auto` (centered, mobile-optimized)
- **Section spacing**: `py-6` (24px vertical padding)
- **Section separators**: `border-t border-[var(--ll-hair)]` (1px hairline, no cards)
- **Content padding**: `px-4 py-4` (16px horizontal)
- **Bottom nav clearance**: `pb-24` when bottom nav visible

## Border Radius
- **Global radius**: `0.1875rem` (3px) — extremely restrained, almost square
- **Progress bar**: `1px` radius
- **Images/thumbnails**: `3px` radius
- **Circles**: `rounded-full` (for status dots, icon containers)
- **shadcn cards**: `rounded-xl` (inherited, rarely used in merchant pages)

## Shadows
- **Card**: `0 0 .5px rgba(0,0,0,.14), 0 1px 1px rgba(0,0,0,.24)` (barely visible)
- **Popup**: `0 8px 24px rgba(30,57,50,.14)` (modals/dropdowns)
- **Frappe**: `0 0 6px rgba(0,0,0,.24), 0 8px 12px rgba(0,0,0,.14)` (elevated elements)
- **Design principle**: Shadows are minimal — the design favors hairline borders over shadows

## Motion & Animation

### Zen Reveal (Stagger Entrance)
- **Effect**: `opacity: 0 → 1`, `translateY(14px) → 0`
- **Duration**: 600ms (`--dur-slow`)
- **Easing**: `cubic-bezier(.16, 1, .3, 1)` (`--ease-out`)
- **Stagger**: 60ms between children (7 steps)
- **Class**: `.zen-reveal`

### Press Interaction
- **Effect**: `scale(0.95)` or `scale(0.97)` for buttons
- **Duration**: 80ms (transform) / 150ms (color)
- **Class**: `.ll-press:active` or built into ZenButton

### Bottom Nav
- **Backdrop**: `blur(16px)` + `rgba(244,242,237,.88)` frosted glass
- **Active transition**: color change only (no scale/bounce)

### Progress Bar
- **Duration**: 600ms
- **Easing**: `--ease-out`

## Component Patterns

### De-Carded Sections (去卡片化)
The v3 Zen design removes traditional card containers. Instead:
- Sections use `border-t border-[var(--ll-hair)]` hairline separators
- No background cards — content sits directly on canvas
- `py-6` vertical padding between sections

### Zen Signature (TodayTaskCard)
- **Kicker**: 11px text, `letter-spacing: .1em`, green color, with 24px × 1.5px green hairline on left
- **Headline**: Noto Serif SC, 29px, weight 600, with 2px green left border + `padding-left: 16px`
- **Progress bar**: 2px height, green fill, hairline background

### Buttons
- **Primary (ZenButton)**: Green background (`#00754A`), white text, 3px radius, `px-6 py-4`, press scale(0.97)
- **Ghost (ZenButton)**: Transparent, secondary text color, bottom hairline border, press → text turns green

### Status Dots (WeeklyCalendar)
- **Completed**: 7px solid green dot
- **Today**: 10px hollow green ring with pulse animation
- **Future**: 7px hollow gray ring

### Empty States
- Single-color SVG line illustrations (#00754A)
- Noto Serif SC serif headline
- Max 260px description text
- Centered layout with generous vertical padding

### Icons
- **Library**: lucide-react
- **Stroke width**: 1.5 (consistent everywhere)
- **Sizes**: aux 16px (h-4), body 20px (h-5), feature 24px (h-6)

## Layout Architecture

### Header
- Sticky top, 56px height
- White surface with 90% opacity + `backdrop-blur-sm`
- Bottom hairline border
- Left: Store name (serif 18px, green-dark color)
- Right: Video Studio entry (pill button) + Notification bell (with red badge for unread)

### Bottom Navigation
- Fixed bottom, 64px height
- Frosted glass: `blur(16px)` + `rgba(244,242,237,.88)`
- Top hairline border
- 4 tab items: Home / Calendar / Today Tasks / My Profile
- Active: green text + semibold label
- Inactive: tertiary gray text + normal weight

### Content Area
- Centered `max-w-lg` container
- `px-4` horizontal padding
- `pb-24` bottom clearance when bottom nav present

## Accessibility
- WCAG AA contrast: green `#00754A` on white = 4.8:1 ratio
- `prefers-reduced-motion`: disables all animations and noise texture
- `aria-current="page"` on active nav items
- `aria-label` on all interactive elements
- Notification badge: max "99+" display

## Constraints
- **DO NOT** introduce new fonts outside Noto Serif SC / Noto Sans SC / Space Grotesk
- **DO NOT** use colors outside the defined token palette (no neon, no purple, no pink gradients)
- **DO NOT** use large border-radius values — max 3px for most elements
- **DO NOT** use heavy shadows — prefer hairline borders
- **DO NOT** use emoji in UI — always use lucide-react icons
- **KEEP** the de-carded section pattern (hairline separators, no card backgrounds)
- **KEEP** the warm cream canvas as the base background
