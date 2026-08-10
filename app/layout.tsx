import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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
  title: {
    default: "English Room｜私人英语学习空间",
    template: "%s｜English Room",
  },
  description: "集中管理新概念英语课程、学习进度、个人计划与英语学习资源。",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "English Room｜私人英语学习空间",
    description: "新概念英语课程、学习进度、个人计划与资源库，集中在一个私人网站。",
    type: "website",
    locale: "zh_CN",
    images: [{ url: "/og-english-room.png", width: 1672, height: 941, alt: "English Room 私人英语学习空间" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "English Room｜私人英语学习空间",
    description: "集中管理课程、学习记录与英语资源。",
    images: ["/og-english-room.png"],
  },
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        {children}
      </body>
    </html>
  );
}
