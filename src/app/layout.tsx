import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";
import { BottomTabNav } from "@/features/nav/BottomTabNav";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Typolog — 글자 콜라주",
  description: "같은 문장을, 각자의 일상에서 전혀 다르게 완성하는 글자 콜라주 앱",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <Providers>{children}</Providers>
        {/* 하단 탭 네비 — 경로 인식 client island. 인증 앱 화면(홈·피드·마이)에서만 표시. */}
        <BottomTabNav />
      </body>
    </html>
  );
}
