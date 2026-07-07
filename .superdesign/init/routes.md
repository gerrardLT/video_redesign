# Routes — Merchant Platform (Local Life Marketing)

Framework: Next.js 15.5 App Router
Base path: `/merchant`
Layout: `src/app/merchant/layout.tsx` (applied to all routes under `/merchant`)

## Page Routes

| URL Path | File | Lines | Description |
|----------|------|-------|-------------|
| `/merchant/onboarding` | `src/app/merchant/onboarding/page.tsx` | 742 | 3-step onboarding wizard (store creation) |
| `/merchant/stores` | `src/app/merchant/stores/page.tsx` | 211 | Store selection page |
| `/merchant/stores/[storeId]` | `src/app/merchant/stores/[storeId]/page.tsx` | 579 | **Store Home** — today's task hero, weekly calendar, pending actions, best video |
| `/merchant/stores/[storeId]/calendar` | `src/app/merchant/stores/[storeId]/calendar/page.tsx` | 1163 | Weekly content calendar with drag-and-drop |
| `/merchant/stores/[storeId]/today` | `src/app/merchant/stores/[storeId]/today/page.tsx` | 297 | Today's task detail list |
| `/merchant/stores/[storeId]/settings` | `src/app/merchant/stores/[storeId]/settings/page.tsx` | 644 | Store settings (profile, account, subscription) |
| `/merchant/stores/[storeId]/growth` | `src/app/merchant/stores/[storeId]/growth/page.tsx` | 479 | Growth & gamification (streaks, milestones) |
| `/merchant/stores/[storeId]/membership` | `src/app/merchant/stores/[storeId]/membership/page.tsx` | 384 | Membership & credits |
| `/merchant/stores/[storeId]/publish-queue` | `src/app/merchant/stores/[storeId]/publish-queue/page.tsx` | 620 | Publish queue management |
| `/merchant/stores/[storeId]/task-center` | `src/app/merchant/stores/[storeId]/task-center/page.tsx` | 500 | Task center with SSE notifications |
| `/merchant/stores/[storeId]/briefs/[briefId]` | `src/app/merchant/stores/[storeId]/briefs/[briefId]/page.tsx` | 314 | Brief detail page |
| `/merchant/stores/[storeId]/briefs/[briefId]/shoot` | `src/app/merchant/stores/[storeId]/briefs/[briefId]/shoot/page.tsx` | 935 | Shoot & upload page (camera/file upload) |
| `/merchant/stores/[storeId]/briefs/[briefId]/variants` | `src/app/merchant/stores/[storeId]/briefs/[briefId]/variants/page.tsx` | 714 | Video variants list |
| `/merchant/stores/[storeId]/briefs/[briefId]/metrics` | `src/app/merchant/stores/[storeId]/briefs/[briefId]/metrics/page.tsx` | 326 | Performance metrics & analytics |

## Bottom Navigation Mapping

The bottom nav (4 items) maps to:
- **首页** → `/merchant/stores/{storeId}`
- **日历** → `/merchant/stores/{storeId}/calendar`
- **今日任务** → `/merchant/stores/{storeId}/today`
- **我的** → `/merchant/stores/{storeId}/settings`

## Key Page Summary

### Store Home (`/merchant/stores/[storeId]`)
- **TodayTaskCard**: Zen design signature — kicker + green hairline + serif headline + green border-left + 2px progress bar
- **WeeklyCalendar**: Vertical 7-day layout with status dots (solid green / pulsing green ring / hollow gray)
- **PendingActionsCard**: De-carded, hairline separator
- **BestVideoCard**: Recent video with views count; shows first-time guide when no videos
- **Growth & Membership**: De-carded sections with Trophy/Pin icons
- Data sources: SWR → `/api/stores/{storeId}/today`, `/api/stores/{storeId}/content-plan/current`, `/api/merchant/subscription`
