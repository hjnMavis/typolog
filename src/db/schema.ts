import { authUsers } from 'drizzle-orm/supabase';
import {
  boolean,
  check,
  date,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

// ─────────────────────────────────────────────
// profiles
// ─────────────────────────────────────────────
export const profiles = pgTable('profiles', {
  id: uuid('id')
    .primaryKey()
    .references(() => authUsers.id, { onDelete: 'cascade' }),
  nickname: text('nickname').notNull(),
  avatar_url: text('avatar_url'),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// challenges
// ─────────────────────────────────────────────
export const challenges = pgTable('challenges', {
  id: uuid('id').primaryKey().defaultRandom(),
  sentence: text('sentence').notNull(),
  lines: text('lines').array().notNull(),
  letters: text('letters').array().notNull(),
  active_date: date('active_date').notNull().unique(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// submissions
// ─────────────────────────────────────────────
export const submissions = pgTable(
  'submissions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    challenge_id: uuid('challenge_id')
      .notNull()
      .references(() => challenges.id, { onDelete: 'no action' }),
    status: text('status').notNull().default('draft'),
    is_public: boolean('is_public').notNull().default(true),
    collage_image_url: text('collage_image_url'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completed_at: timestamp('completed_at', { withTimezone: true }),
  },
  (table) => [
    check('submissions_status_check', sql`${table.status} IN ('draft', 'completed', 'hidden')`),
    unique('submissions_user_challenge_unique').on(table.user_id, table.challenge_id),
    index('idx_submissions_feed')
      .on(table.challenge_id, table.created_at.desc(), table.id)
      .where(sql`${table.status} = 'completed' AND ${table.is_public} = true`),
    index('idx_submissions_user').on(table.user_id, table.created_at.desc()),
  ],
);

// ─────────────────────────────────────────────
// letter_pieces
// ─────────────────────────────────────────────
export const letterPieces = pgTable(
  'letter_pieces',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    submission_id: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    character: text('character').notNull(),
    slot_index: integer('slot_index').notNull(),
    image_url: text('image_url').notNull(),
    width: integer('width').notNull(),
    height: integer('height').notNull(),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('letter_pieces_submission_slot_unique').on(table.submission_id, table.slot_index),
    index('idx_letter_pieces_submission').on(table.submission_id),
  ],
);

// ─────────────────────────────────────────────
// reactions
// ─────────────────────────────────────────────
export const reactions = pgTable(
  'reactions',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    user_id: uuid('user_id')
      .notNull()
      .references(() => profiles.id, { onDelete: 'cascade' }),
    submission_id: uuid('submission_id')
      .notNull()
      .references(() => submissions.id, { onDelete: 'cascade' }),
    type: text('type').notNull().default('like'),
    created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique('reactions_user_submission_unique').on(table.user_id, table.submission_id),
    index('idx_reactions_submission').on(table.submission_id),
  ],
);

// ─────────────────────────────────────────────
// reports
// ─────────────────────────────────────────────
export const reports = pgTable('reports', {
  id: uuid('id').primaryKey().defaultRandom(),
  reporter_id: uuid('reporter_id')
    .notNull()
    .references(() => profiles.id, { onDelete: 'cascade' }),
  submission_id: uuid('submission_id')
    .notNull()
    .references(() => submissions.id, { onDelete: 'cascade' }),
  reason: text('reason').notNull(),
  created_at: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

// ─────────────────────────────────────────────
// 추론된 타입 exports (Day 2~에서 Route Handler에 활용)
// ─────────────────────────────────────────────
export type Profile = typeof profiles.$inferSelect;
export type NewProfile = typeof profiles.$inferInsert;

export type Challenge = typeof challenges.$inferSelect;
export type NewChallenge = typeof challenges.$inferInsert;

export type Submission = typeof submissions.$inferSelect;
export type NewSubmission = typeof submissions.$inferInsert;

export type LetterPiece = typeof letterPieces.$inferSelect;
export type NewLetterPiece = typeof letterPieces.$inferInsert;

export type Reaction = typeof reactions.$inferSelect;
export type NewReaction = typeof reactions.$inferInsert;

export type Report = typeof reports.$inferSelect;
export type NewReport = typeof reports.$inferInsert;
