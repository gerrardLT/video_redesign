# Extractable Components — Merchant Platform

## Layout Components (appear on most pages)

### BottomNav
- Source: `src/app/merchant/layout.tsx` (inline, lines 220-258)
- Category: layout
- Description: Frosted glass bottom tab bar with 4 items (Home/Calendar/Today/Settings). Active state = green text + semibold. Icons from lucide-react with strokeWidth 1.5.
- Extractable props: activeItem (string, default: "home"), unreadCount (number, default: 0)
- Hardcoded: NAV_ITEMS config (home/calendar/today/settings), icon names (Home/Calendar/ClipboardList/User), all CSS

### MerchantHeader
- Source: `src/app/merchant/layout.tsx` (inline, lines 173-213)
- Category: layout
- Description: Sticky top header with store name (Noto Serif SC), video studio entry button, notification bell with red badge
- Extractable props: storeName (string, default: "我的门店"), unreadCount (number, default: 0), multiStore (boolean, default: false)
- Hardcoded: Clapperboard icon, Bell icon, "视频重塑" label, all CSS

## Basic Components (used across pages)

### ZenButton
- Source: `src/components/merchant/ZenButton.tsx`
- Category: basic
- Description: v3 Zen editorial button. Primary = green bg + white text + 3px radius. Ghost = transparent + hairline bottom border.
- Extractable props: variant (string: "primary"|"ghost", default: "primary"), fullWidth (boolean, default: false), disabled (boolean, default: false)
- Hardcoded: 3px radius, 15px font, green color tokens, press scale(0.97)

### EmptyState
- Source: `src/components/merchant/EmptyState.tsx`
- Category: basic
- Description: Empty state with SVG illustration, serif headline, and description text
- Extractable props: illustration (string: "cooking"|"checklist"|"upload"|"video", default: "video"), title (string, default: "暂无数据"), description (string, default: "")
- Hardcoded: illustration SVG paths, font-family serif, all CSS

### StoreSwitcher
- Source: `src/components/merchant/StoreSwitcher.tsx`
- Category: basic
- Description: Dropdown to switch between multiple stores (shown when user has >1 store)
- Extractable props: currentStoreId (string), storeName (string)
- Hardcoded: dropdown styles, chevron icon, all CSS

### TodayTaskCard
- Source: `src/app/merchant/stores/[storeId]/page.tsx` (inline, lines 81-159)
- Category: basic
- Description: Zen design signature component — kicker with green hairline + Noto Serif SC 29px headline with green left border + 2px progress bar + ZenButton CTA
- Extractable props: title (string), goal (string), capturedCount (number), requiredCount (number), hasCover (boolean), briefId (string)
- Hardcoded: "今日任务" kicker text, green hairline, serif font, progress bar styling

### WeeklyCalendar
- Source: `src/app/merchant/stores/[storeId]/page.tsx` (inline, lines 171-229)
- Category: basic
- Description: 7-day vertical calendar layout with status dots (completed=solid green, today=pulsing green ring, future=hollow gray)
- Extractable props: days (array of {label, isCompleted, isToday, isFuture, goalText})
- Hardcoded: day labels, dot sizes (7px/10px), hairline separator
