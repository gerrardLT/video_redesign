# Shared UI Primitives — Local Life Merchant Platform

## ZenButton
- File: `src/components/merchant/ZenButton.tsx`
- Description: v3 Zen editorial button with 2 variants (primary/ghost)
- Key props: variant, fullWidth, disabled

```tsx
'use client'

import { cn } from '@/lib/utils'
import type { ButtonHTMLAttributes, ReactNode } from 'react'

interface ZenButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'className'> {
  variant: 'primary' | 'ghost'
  children: ReactNode
  onClick?: () => void
  disabled?: boolean
  fullWidth?: boolean
  className?: string
}

export function ZenButton({
  variant,
  children,
  onClick,
  disabled = false,
  fullWidth = false,
  className,
  ...rest
}: ZenButtonProps) {
  const baseStyles = [
    'inline-flex items-center justify-center',
    'text-[15px] font-medium tracking-[.04em]',
    'rounded-[3px]',
    'transition-[background-color,transform,color] duration-[150ms] ease-out',
    disabled && 'opacity-50 pointer-events-none cursor-not-allowed',
    fullWidth && 'w-full',
  ]

  const variantStyles = {
    primary: [
      'bg-[var(--ll-green)]',
      'text-white',
      'px-6 py-4',
      'active:bg-[var(--ll-green-deep)] active:scale-[0.97]',
      '[transition:background-color_150ms,transform_80ms]',
    ],
    ghost: [
      'bg-transparent',
      'text-[var(--ll-text-2)]',
      'px-4 py-3',
      'border-b border-b-[var(--ll-hair)]',
      'active:text-[var(--ll-green)]',
    ],
  }

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        ...baseStyles,
        ...variantStyles[variant],
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
```

## EmptyState
- File: `src/components/merchant/EmptyState.tsx`
- Description: Empty state illustration with serif title and description text

```tsx
'use client'

import Image from 'next/image'

const illustrationMap: Record<EmptyStateProps['illustration'], string> = {
  cooking: '/illustrations/onboarding-shoot.svg',
  checklist: '/illustrations/empty-calendar.svg',
  upload: '/illustrations/onboarding-shoot.svg',
  video: '/illustrations/empty-video.svg',
}

export interface EmptyStateProps {
  illustration: 'cooking' | 'checklist' | 'upload' | 'video'
  title: string
  description: string
}

export function EmptyState({ illustration, title, description }: EmptyStateProps) {
  const src = illustrationMap[illustration]
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <Image src={src} alt={title} width={200} height={160} className="mb-6 opacity-85" priority={false} />
      <h3
        className="text-lg font-semibold leading-relaxed text-[var(--ll-text-1,rgba(0,0,0,.87))]"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </h3>
      <p className="mt-2 max-w-[260px] text-sm leading-relaxed text-[var(--ll-text-3,rgba(0,0,0,.4))]">
        {description}
      </p>
    </div>
  )
}
```

## Button (shadcn/ui)
- File: `src/components/ui/button.tsx`
- Description: shadcn/ui Button with base-ui + cva, 6 variants + 7 sizes

```tsx
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/80",
        outline: "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary: "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive: "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
)

function Button({ className, variant = "default", size = "default", ...props }: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return <ButtonPrimitive data-slot="button" className={cn(buttonVariants({ variant, size, className }))} {...props} />
}

export { Button, buttonVariants }
```

## Card (shadcn/ui)
- File: `src/components/ui/card.tsx`
- Description: shadcn Card with CardHeader, CardTitle, CardDescription, CardAction, CardContent, CardFooter

```tsx
import { cn } from "@/lib/utils"

function Card({ className, size = "default", ...props }: React.ComponentProps<"div"> & { size?: "default" | "sm" }) {
  return (
    <div data-slot="card" data-size={size}
      className={cn("group/card flex flex-col gap-(--card-spacing) overflow-hidden rounded-xl bg-card py-(--card-spacing) text-sm text-card-foreground ring-1 ring-foreground/10 [--card-spacing:--spacing(4)] has-data-[slot=card-footer]:pb-0 has-[>img:first-child]:pt-0 data-[size=sm]:[--card-spacing:--spacing(3)] data-[size=sm]:has-data-[slot=card-footer]:pb-0 *:[img:first-child]:rounded-t-xl *:[img:last-child]:rounded-b-xl", className)}
      {...props} />
  )
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="card-header"
      className={cn("group/card-header @container/card-header grid auto-rows-min items-start gap-1 rounded-t-xl px-(--card-spacing) has-data-[slot=card-action]:grid-cols-[1fr_auto] has-data-[slot=card-description]:grid-rows-[auto_auto] [.border-b]:pb-(--card-spacing)", className)}
      {...props} />
  )
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-title" className={cn("font-heading text-base leading-snug font-medium group-data-[size=sm]/card:text-sm", className)} {...props} />
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-description" className={cn("text-sm text-muted-foreground", className)} {...props} />
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-action" className={cn("col-start-2 row-span-2 row-start-1 self-start justify-self-end", className)} {...props} />
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-content" className={cn("px-(--card-spacing)", className)} {...props} />
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
  return <div data-slot="card-footer" className={cn("flex items-center rounded-b-xl border-t bg-muted/50 p-(--card-spacing)", className)} {...props} />
}

export { Card, CardHeader, CardFooter, CardTitle, CardAction, CardDescription, CardContent }
```

## Badge (shadcn/ui)
- File: `src/components/ui/badge.tsx`
- Description: shadcn Badge with 6 variants via cva

```tsx
import { mergeProps } from "@base-ui/react/merge-props"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "group/badge inline-flex h-5 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-4xl border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-all focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground [a]:hover:bg-secondary/80",
        destructive: "bg-destructive/10 text-destructive focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:focus-visible:ring-destructive/40 [a]:hover:bg-destructive/20",
        outline: "border-border text-foreground [a]:hover:bg-muted [a]:hover:text-muted-foreground",
        ghost: "hover:bg-muted hover:text-muted-foreground dark:hover:bg-muted/50",
        link: "text-primary underline-offset-4 hover:underline",
      },
    },
    defaultVariants: { variant: "default" },
  }
)

function Badge({ className, variant = "default", render, ...props }) {
  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">({ className: cn(badgeVariants({ variant }), className) }, props),
    render,
    state: { slot: "badge", variant },
  })
}

export { Badge, badgeVariants }
```

## Input (shadcn/ui)
- File: `src/components/ui/input.tsx`
- Description: shadcn Input with base-ui primitive

```tsx
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "@/lib/utils"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive type={type} data-slot="input"
      className={cn("h-8 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40", className)}
      {...props} />
  )
}

export { Input }
```

## Spinner
- File: `src/components/ui/spinner.tsx`
- Description: Simple loading spinner with cine-gold border

```tsx
interface SpinnerProps { size?: 'sm' | 'md' | 'lg'; className?: string }

const sizeClasses = { sm: 'h-4 w-4 border', md: 'h-8 w-8 border-2', lg: 'h-12 w-12 border-2' }

export function Spinner({ size = 'md', className = '' }: SpinnerProps) {
  return (
    <div className={`animate-spin rounded-full border-[var(--cine-gold)] border-t-transparent ${sizeClasses[size]} ${className}`} role="status" aria-label="加载中">
      <span className="sr-only">加载中...</span>
    </div>
  )
}
```

## cn utility
- File: `src/lib/utils.ts`
- Description: Tailwind merge utility

```ts
import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
```
