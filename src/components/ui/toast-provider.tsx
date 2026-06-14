'use client'

import { Toaster } from 'sonner'

/**
 * Toast 通知提供者
 * 在根布局中引入，全局可用
 */
export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      toastOptions={{
        style: {
          background: 'var(--cine-surface)',
          border: '1px solid var(--cine-line-2)',
          color: 'var(--cine-text)',
        },
      }}
      theme="dark"
    />
  )
}
