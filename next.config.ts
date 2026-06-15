import path from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

// 워크트리에서 작업 시, 메인 repo와 worktree에 pnpm-workspace.yaml이 중복 존재해
// Turbopack이 워크스페이스 루트를 메인 repo로 잘못 추론하고 경고를 낸다 (무해하나 소음).
// 루트를 이 디렉토리로 고정해 경고를 없앤다 (Phase 2 Day 5).
const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const nextConfig: NextConfig = {
  turbopack: {
    root: projectRoot,
  },
};

export default nextConfig;
