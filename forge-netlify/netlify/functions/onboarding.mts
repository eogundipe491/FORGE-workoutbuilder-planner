import { drizzle } from 'drizzle-orm/netlify-db';
import { and, eq } from 'drizzle-orm';
import { onboarding } from '../../db/schema.js';

export default async (request: Request) => {
  const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { 'cache-control': 'no-store' } });
  if (!['GET', 'PUT'].includes(request.method)) return json({ error: 'Method not allowed.' }, 405);
  try {
    const authorization = request.headers.get('authorization');
    if (!authorization?.startsWith('Bearer ')) return json({ error: 'Please sign in again.' }, 401);
    const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
    const key = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
    if (!url || !key) return json({ error: 'Account service is not configured.' }, 503);
    const headers = { authorization, apikey: key };
    const verified = await fetch(`${url}/auth/v1/user`, { headers });
    if (!verified.ok) return json({ error: 'Please sign in again.' }, 401);
    const user = await verified.json();
    if (!user.id) return json({ error: 'Please sign in again.' }, 401);
    const db = drizzle();
    const find = async () => (await db.select().from(onboarding).where(eq(onboarding.userId, user.id)))[0];
    if (request.method === 'GET') {
      let record = await find();
      if (!record) {
        // Read the existing user's responses once; never change legacy or training data.
        const [answersResponse, profileResponse] = await Promise.all([
          fetch(`${url}/rest/v1/onboarding_responses?user_id=eq.${encodeURIComponent(user.id)}&select=answers,completed_at`, { headers }),
          fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=onboarding_skipped`, { headers }),
        ]);
        if (!answersResponse.ok || !profileResponse.ok) return json({ error: 'Could not load existing questionnaire. Please retry.' }, 503);
        const previous = (await answersResponse.json())[0];
        const profile = (await profileResponse.json())[0];
        const answers = previous?.answers || {};
        const firstUnanswered = Array.from({ length: 37 }, (_, i) => i).find(i => {
          const value = answers[i + 1];
          return !(Array.isArray(value) ? value.length : value) && !answers[`${i + 1}_explanation`];
        }) ?? 36;
        await db.insert(onboarding).values({ userId: user.id, answers, questionIndex: firstUnanswered, completedAt: previous?.completed_at || null, skipped: Boolean(profile?.onboarding_skipped) }).onConflictDoNothing();
        record = await find();
      }
      return json(record);
    }
    const input = await request.json();
    if (!['save', 'complete', 'skip', 'restart'].includes(input.action) || !Number.isInteger(input.revision) || input.revision < 0) return json({ error: 'Invalid questionnaire request.' }, 400);
    if (!input.answers || typeof input.answers !== 'object' || Array.isArray(input.answers) || JSON.stringify(input.answers).length > 100000 || !Number.isInteger(input.questionIndex) || input.questionIndex < 0 || input.questionIndex > 36) return json({ error: 'Invalid questionnaire answers.' }, 400);
    const values: Partial<typeof onboarding.$inferInsert> = { answers: input.answers, questionIndex: input.questionIndex, revision: input.revision + 1 };
    if (input.action === 'restart') Object.assign(values, { answers: {}, questionIndex: 0, completedAt: null, skipped: false });
    if (input.action === 'complete') Object.assign(values, { completedAt: new Date().toISOString(), skipped: false });
    if (input.action === 'skip') values.skipped = true;
    const [record] = await db.update(onboarding).set(values).where(and(eq(onboarding.userId, user.id), eq(onboarding.revision, input.revision))).returning();
    if (!record) return json({ error: 'This questionnaire changed in another tab. Your unsaved draft is kept in this browser. Reload before continuing.' }, 409);
    return json(record);
  } catch {
    return json({ error: 'Could not save or load your questionnaire. Please retry.' }, 503);
  }
};
