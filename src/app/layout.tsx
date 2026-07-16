import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { ToastProvider } from "@/components/ui/toast-provider";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AI 本地生活营销平台",
  description:
    "面向本地生活商家的 AI 短视频营销平台：商家问诊建店、AI 生成每周内容计划、按分镜拍摄、一键生成并发布。底层内置 AI 视频生成能力，保持人物一致、分镜级控制。",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="zh-CN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* 字体加载：
            - Manrope + Noto Sans SC：本地生活商家端（Starbucks 风格）正文/UI
            - Noto Serif SC：营销展示标题（编辑感衬线）
            统一通过 Google Fonts 加载 */}
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&family=Noto+Sans+SC:wght@400;500;700;900&family=Noto+Serif+SC:wght@500;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full flex flex-col">
        {children}
        <ToastProvider />
      </body>
    </html>
  );
}
