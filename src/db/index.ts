// 클라이언트 번들에 유입되면 빌드 타임에 실패하도록 가드 (게이트 A 결정 g)
import 'server-only';

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error(
    'DATABASE_URL is not set. Add the Session pooler URI (port 5432) to .env.local.',
  );
}

// Session pooler(5432) + prepare:false — 추후 transaction pooler(6543) 전환 대비 (게이트 A 결정 c)
const client = postgres(databaseUrl, { prepare: false });

export const db = drizzle({ client, schema });
