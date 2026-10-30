const CORS = { 'access-control-allow-origin':'*', 'access-control-allow-methods':'POST, OPTIONS', 'access-control-allow-headers':'Content-Type, Authorization', 'access-control-max-age':'86400', 'vary':'Origin' };
const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...CORS } });
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

function answerText(value){return Array.isArray(value)?value.join(', '):String(value||'');}
export function sessionExerciseRange(questionnaire={}){
  const duration=answerText(questionnaire[21]);
  if(duration.includes('Under 15'))return {min:2,max:3,label:'2–3'};
  if(duration.includes('15–30'))return {min:3,max:4,label:'3–4'};
  if(duration.includes('30–45'))return {min:4,max:5,label:'4–5'};
  if(duration.includes('45–60'))return {min:5,max:6,label:'5–6'};
  if(duration.includes('60–90'))return {min:6,max:7,label:'6–7'};
  if(duration.includes('More than 90'))return {min:7,max:8,label:'7–8'};
  return {min:4,max:6,label:'4–6'};
}
export function availableEquipment(questionnaire={}){
  const selected=Array.isArray(questionnaire[16])?questionnaire[16]:[];
  if(!selected.length||selected.includes('Other'))return null;
  if(selected.includes('Bodyweight only'))return new Set(['Bodyweight']);
  const map={Dumbbells:['Dumbbell'],Barbells:['Barbell'], 'Weight plates':['Barbell'], 'Adjustable bench':['Dumbbell','Barbell'], 'Squat rack':['Barbell'], 'Cable machine':['Cable'], 'Smith machine':['Machine'], 'Resistance bands':['Resistance band'], Kettlebells:['Kettlebell'], 'Pull-up bar':['Bodyweight'], 'Dip station':['Bodyweight'], 'Exercise machines':['Machine','Treadmill','Bike','Rower'], Treadmill:['Treadmill'], 'Exercise bike':['Bike'], 'Rowing machine':['Rower'], 'Medicine ball':['Medicine ball'], 'Gymnastics equipment':['Bodyweight']};
  const allowed=new Set(['Bodyweight']);selected.forEach(x=>(map[x]||[]).forEach(y=>allowed.add(y)));return allowed;
}

export default async (request) => {
  if (request.method === 'OPTIONS') return new Response(null,{status:204,headers:CORS});
  if (request.method !== 'POST') return json({error:'Method not allowed.'},405);
  try {
    const user = await verifyUser(request.headers.get('authorization'));
    const input = await request.json();
    if (!['coach','generate_workout'].includes(input.task)) return json({error:'Unsupported AI task.'},400);
    const questionnaire=input.questionnaire||{};
    const exerciseRange=sessionExerciseRange(questionnaire);
    const equipment=availableEquipment(questionnaire);
    const weeklyAvailability=answerText(questionnaire[19])||'not specified';
    const preferredDays=answerText(questionnaire[20])||'not specified';
    const ageRange=answerText(questionnaire[36])||'not provided';
    const limitations=[33,34,35].map(id=>answerText(questionnaire[id])).filter(Boolean).join(' | ')||'not provided';
    const catalogue=Array.isArray(input.exerciseCatalogue)?input.exerciseCatalogue:[];
    const usableCatalogue=equipment?catalogue.filter(x=>equipment.has(String(x.equipment||''))):catalogue;
    const safePrompt = input.task === 'generate_workout'
      ? `Create a practical, editable training programme that is genuinely personalised to the supplied questionnaire. Use ONLY exact exercise entries from the supplied catalogue; never invent names or IDs. The user normally has ${answerText(questionnaire[21])||'an unspecified'} amount of time per session and selected ${weeklyAvailability} training days per week (preferred days: ${preferredDays}). Age range supplied: ${ageRange}. Movement considerations supplied: ${limitations}. Respect the requested weekly schedule without turning every available day into a hard session; include appropriate rest or lighter activity where needed. If the age range is under 18, keep recommendations age-appropriate, avoid maximal-lift testing and extreme training volume, and encourage appropriate adult/qualified supervision for unfamiliar loaded movements. Never diagnose or prescribe rehabilitation. Target ${exerciseRange.label} exercises per workout, choosing a count within that range based on goal, experience, weekly schedule and recovery; fewer is acceptable only when the catalogue or stated constraints make more unsuitable. Do not use a fixed count for every user. Respect selected equipment and stated exercise dislikes or movement limitations. Do not diagnose or prescribe rehabilitation. Include balanced movement patterns and avoid redundant exercises. If essential information is missing, state assumptions rather than inventing answers. Return valid JSON only with this shape: {"name":"...","description":"...","weeks":4,"workouts":[{"name":"...","day":"...","focus":"...","exercises":[{"exercise_id":"catalogue id","name":"exact catalogue name","sets":3,"reps":"8-12","rest_seconds":90,"notes":"..."}]}],"safety_notes":["..."],"personalisation_summary":["..."]}. Questionnaire: ${JSON.stringify(questionnaire).slice(0,12000)}. Allowed equipment: ${equipment?[...equipment].join(', '):'Use any equipment represented in the supplied catalogue'}. Catalogue: ${JSON.stringify(usableCatalogue).slice(0,18000)}`
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
      const byName = new Map(usableCatalogue.filter(x=>x && typeof x.name==='string').map(x=>[x.name.toLowerCase(),x]));
      for (const workout of result.workouts) {
        if (!Array.isArray(workout.exercises) || workout.exercises.length > 10) return json({error:'The AI returned an invalid exercise list.'},502);
        const unique=[];const seen=new Set();
        for (const exercise of workout.exercises) {
          const match = byName.get(String(exercise.name || '').toLowerCase());
          if (!match) continue;
          const key=String(match.id||match.name).toLowerCase();if(seen.has(key))continue;seen.add(key);
          exercise.name = match.name;exercise.exercise_id = match.id;
          exercise.sets = Math.min(5, Math.max(1, Number.parseInt(exercise.sets,10) || 3));
          exercise.rest_seconds = Math.min(300, Math.max(30, Number.parseInt(exercise.rest_seconds,10) || 90));
          exercise.reps = String(exercise.reps || '8–12').slice(0,24);exercise.notes = String(exercise.notes || '').slice(0,240);unique.push(exercise);
        }
        workout.exercises=unique.slice(0,exerciseRange.max);
        if(!workout.exercises.length)return json({error:'No suitable catalogue exercises matched this workout. Add equipment or broaden your exercise preferences and try again.'},422);
      }
      result.exercise_count_target=exerciseRange.label;
      result.personalisation_summary=Array.isArray(result.personalisation_summary)?result.personalisation_summary.slice(0,8).map(x=>String(x).slice(0,220)):[];
      result.weeks = Math.min(8, Math.max(1, Number.parseInt(result.weeks,10) || 4));
    }
    return json({ result, provider, userId:user.id });
  } catch (error) { return json({ error:error.message || 'AI request failed.' }, error.message?.includes('Sign in') ? 401 : 500); }
};
