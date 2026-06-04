import { defineConfig } from 'drizzle-kit';

// 게이트 A 결정: dotenv 설치 없이 Node 내장 process.loadEnvFile 사용 (Node v20.12+)
process.loadEnvFile('.env.local');

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Add the Session pooler URI (port 5432) to .env.local.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema.ts',
  out: './src/db/migrations',
  dbCredentials: { url: databaseUrl },
  // auth 스키마(auth.users)가 마이그레이션 대상에 포함되지 않도록 public만 관리
  schemaFilter: ['public'],
});
