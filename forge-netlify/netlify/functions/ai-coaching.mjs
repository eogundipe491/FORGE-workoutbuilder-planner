const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const SYSTEM = `You are FORGE's responsible fitness-planning assistant. Give practical, age-aware, non-medical fitness information. Do not diagnose injuries, prescribe rehabilitation, encourage extreme training, restrictive eating, appearance-based goals, or unsafe progression. Respect reported limitations and recommend qualified professional support where appropriate. Do not invent workout history. Use only supplied exercise catalogue entries when selecting exercises. Users remain in control: recommendations are proposals, never applied automatically.`;

async function verifyUser(authHeader) {
  if (!authHeader?.startsWith('Bearer ')) throw new Error('Sign in to use AI coaching.');
  const url = process.env.SUPABASE_URL;
  const anon = process.env.SUPABASE_ANON_KEY;
  if (!url || !anon) throw new Error('Supabase is not configured.');
  const response = await fetch(`${url}/auth/v1/user`, { headers: { apikey: anon, authorization: authHeader } });
  if (!response.ok) throw new Error('Your session could not be verified. Please sign in again.');
  return response.json();
}
async function callOpenAI(system, prompt) {
  const response = await fetch('https://api.openai.com/v1/chat/completions', { method:'POST', headers:{ authorization:`Bearer ${process.env.OPENAI_API_KEY}`, 'content-type':'application/json' }, body:JSON.stringify({ model:process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature:0.35, messages:[{role:'system',content:system},{role:'user',content:prompt}] }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'OpenAI request failed.'); return body.choices?.[0]?.message?.content || '';
}
async function callAnthropic(system, prompt) {
  const response = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{ 'x-api-key':process.env.ANTHROPIC_API_KEY, 'anthropic-version':'2023-06-01', 'content-type':'application/json' }, body:JSON.stringify({ model:process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest', max_tokens:1800, system, messages:[{role:'user',content:prompt}] }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Anthropic request failed.'); return (body.content || []).map(x=>x.text || '').join('\n');
}
async function callGemini(system, prompt) {
  const model = process.env.GEMINI_MODEL || 'gemini-2.0-flash';
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, { method:'POST', headers:{ 'content-type':'application/json' }, body:JSON.stringify({ systemInstruction:{parts:[{text:system}]}, contents:[{role:'user',parts:[{text:prompt}]}], generationConfig:{temperature:0.35,maxOutputTokens:1800} }) });
  const body = await response.json(); if (!response.ok) throw new Error(body.error?.message || 'Gemini request failed.'); return body.candidates?.[0]?.content?.parts?.map(x=>x.text || '').join('\n') || '';
}
export default async (request) => {
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  try {
    const user = await verifyUser(request.headers.get('authorization'));
    const input = await request.json();
    if (!['coach','generate_workout'].includes(input.task)) return json({error:'Unsupported AI task.'},400);
    const safePrompt = input.task === 'generate_workout'
      ? `Create a practical, editable training programme using the user's questionnaire answers and ONLY exercises from the supplied catalogue. Do not invent exercise IDs. If important information is missing, choose conservative defaults and state assumptions. Return valid JSON only with this shape: {"name":"...","description":"...","weeks":4,"workouts":[{"name":"...","day":"...","focus":"...","exercises":[{"exercise_id":"catalogue id or null","name":"exact catalogue name","sets":3,"reps":"8-12","rest_seconds":90,"notes":"..."}]}],"safety_notes":["..."]}. Questionnaire: ${JSON.stringify(input.questionnaire || {}).slice(0,12000)}. Catalogue: ${JSON.stringify(input.exerciseCatalogue || []).slice(0,18000)}`
      : `User asks: ${String(input.prompt || '').slice(0,3000)}\nAuthorised recent training context: ${JSON.stringify(input.context || {}).slice(0,8000)}\nOffer useful, concise guidance and explain uncertainty. Do not claim access to information not supplied.`;
    const provider = (process.env.AI_PROVIDER || 'openai').toLowerCase();
    let text;
    if (provider === 'anthropic' && process.env.ANTHROPIC_API_KEY) text = await callAnthropic(SYSTEM,safePrompt);
    else if (provider === 'gemini' && process.env.GEMINI_API_KEY) text = await callGemini(SYSTEM,safePrompt);
    else if (process.env.OPENAI_API_KEY) text = await callOpenAI(SYSTEM,safePrompt);
    else if (process.env.ANTHROPIC_API_KEY) text = await callAnthropic(SYSTEM,safePrompt);
    else if (process.env.GEMINI_API_KEY) text = await callGemini(SYSTEM,safePrompt);
    else return json({error:'No AI provider is configured. Add an AI provider API key in Netlify environment variables.'},503);
    let result = text;
    if (input.task === 'generate_workout') {
      const cleaned = text.replace(/^```(?:json)?\s*/i,'').replace(/\s*```$/,'').trim();
      try { result = JSON.parse(cleaned); } catch { return json({error:'The AI returned an invalid programme format. Please try again.'},502); }
      if (!result || !Array.isArray(result.workouts) || result.workouts.length < 1 || result.workouts.length > 8) return json({error:'The AI programme did not contain a valid workout list.'},502);
      const catalogue = Array.isArray(input.exerciseCatalogue) ? input.exerciseCatalogue : [];
      const byName = new Map(catalogue.filter(x=>x && typeof x.name==='string').map(x=>[x.name.toLowerCase(),x]));
      for (const workout of result.workouts) {
        if (!Array.isArray(workout.exercises) || workout.exercises.length > 12) return json({error:'The AI returned an invalid exercise list.'},502);
        for (const exercise of workout.exercises) {
          const match = byName.get(String(exercise.name || '').toLowerCase());
          if (!match) return json({error:`The AI selected an exercise outside the FORGE catalogue (${String(exercise.name || 'unknown').slice(0,80)}). Please regenerate.`},502);
          exercise.name = match.name;
          exercise.exercise_id = match.id;
          exercise.sets = Math.min(5, Math.max(1, Number.parseInt(exercise.sets,10) || 3));
          exercise.rest_seconds = Math.min(300, Math.max(30, Number.parseInt(exercise.rest_seconds,10) || 90));
          exercise.reps = String(exercise.reps || '8–12').slice(0,24);
          exercise.notes = String(exercise.notes || '').slice(0,240);
        }
      }
      result.weeks = Math.min(8, Math.max(1, Number.parseInt(result.weeks,10) || 4));
    }
    return json({ result, provider, userId:user.id });
  } catch (error) { return json({ error:error.message || 'AI request failed.' }, error.message?.includes('Sign in') ? 401 : 500); }
};
