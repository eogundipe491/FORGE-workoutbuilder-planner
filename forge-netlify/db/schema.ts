import { pgTable, text, jsonb, timestamp, boolean, integer } from 'drizzle-orm/pg-core';

export const onboarding = pgTable('forge_onboarding', {
  userId: text('user_id').primaryKey(),
  answers: jsonb('answers').$type<Record<string, unknown>>().notNull().default({}),
  questionIndex: integer('question_index').notNull().default(0),
  completedAt: timestamp('completed_at', { withTimezone: true, mode: 'string' }),
  skipped: boolean('skipped').notNull().default(false),
  revision: integer('revision').notNull().default(0),
});
