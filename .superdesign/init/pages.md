# Page Dependency Trees — Merchant Platform

## /merchant/stores/[storeId] (Store Home)
Entry: `src/app/merchant/stores/[storeId]/page.tsx` (579 lines)
Layout: `src/app/merchant/layout.tsx` (263 lines)

Dependencies:
- `src/app/merchant/layout.tsx`
  - `src/components/merchant/StoreSwitcher.tsx` (178 lines)
- `src/components/ui/badge.tsx` (53 lines)
- `src/components/ui/spinner.tsx` (27 lines)
- `src/components/merchant/EmptyState.tsx` (74 lines)
- `src/components/merchant/ZenButton.tsx` (108 lines)
- `src/lib/utils.ts` (7 lines)
- `src/app/globals.css` (823 lines)
- lucide-react icons: Film, Camera, Upload, Sparkles, Send, Trophy, Eye, Pin

Page sections (render branch):
- **Loading state**: `<Spinner size="lg" />` centered
- **First-time guide** (no videos + no brief + no plan): `<FirstTimeGuide>` with EmptyState + 3-step icons
- **Normal state**:
  - `<TodayTaskCard>` — Zen signature (kicker + hairline + serif title + green border-left + progress bar + ZenButton primary)
  - `<WeeklyCalendar>` — 7-day vertical layout with status dots
  - `<PendingActionsCard>` — de-carded with Pin icon + count
  - `<BestVideoCard>` — video thumbnail + ZenButton ghost actions; EmptyState when no video
  - Growth section — Trophy icon + "查看 ›"
  - Membership section — tier label + credit balance

## /merchant/onboarding (Store Creation Wizard)
Entry: `src/app/merchant/onboarding/page.tsx` (742 lines)
Layout: `src/app/merchant/layout.tsx`
Note: Bottom nav is HIDDEN on this route

## /merchant/stores/[storeId]/calendar (Calendar)
Entry: `src/app/merchant/stores/[storeId]/calendar/page.tsx` (1163 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/today (Today Tasks)
Entry: `src/app/merchant/stores/[storeId]/today/page.tsx` (297 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/settings (My Profile)
Entry: `src/app/merchant/stores/[storeId]/settings/page.tsx` (644 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/growth (Growth)
Entry: `src/app/merchant/stores/[storeId]/growth/page.tsx` (479 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/membership (Membership)
Entry: `src/app/merchant/stores/[storeId]/membership/page.tsx` (384 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/briefs/[briefId]/shoot (Shoot & Upload)
Entry: `src/app/merchant/stores/[storeId]/briefs/[briefId]/shoot/page.tsx` (935 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/briefs/[briefId]/variants (Video Variants)
Entry: `src/app/merchant/stores/[storeId]/briefs/[briefId]/variants/page.tsx` (714 lines)
Layout: `src/app/merchant/layout.tsx`

## /merchant/stores/[storeId]/task-center (Task Center)
Entry: `src/app/merchant/stores/[storeId]/task-center/page.tsx` (500 lines)
Layout: `src/app/merchant/layout.tsx`
