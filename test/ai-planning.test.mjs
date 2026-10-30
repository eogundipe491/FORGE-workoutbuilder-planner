import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sessionExerciseRange, availableEquipment } from '../netlify/functions/ai-coaching.mjs';

 test('the existing onboarding still contains all 37 questions', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  const block = source.split('const questions = [')[1]?.split('].map((q,i)')[0] || '';
  const count = (block.match(/^\s*\['/gm) || []).length;
  assert.equal(count, 37);
});

test('session exercise range changes with available session duration', () => {
  assert.deepEqual(sessionExerciseRange({21:'Under 15 minutes'}), {min:2,max:3,label:'2–3'});
  assert.deepEqual(sessionExerciseRange({21:'30–45 minutes'}), {min:4,max:5,label:'4–5'});
  assert.deepEqual(sessionExerciseRange({21:'More than 90 minutes'}), {min:7,max:8,label:'7–8'});
});

test('equipment answers constrain the exercise catalogue', () => {
  assert.deepEqual([...availableEquipment({16:['Bodyweight only']})], ['Bodyweight']);
  const allowed = availableEquipment({16:['Dumbbells']});
  assert.equal(allowed.has('Dumbbell'), true);
  assert.equal(allowed.has('Barbell'), false);
  assert.equal(allowed.has('Bodyweight'), true);
});

test('unspecified equipment does not accidentally remove catalogue options', () => {
  assert.equal(availableEquipment({16:[]}), null);
});


test('questionnaire review disables the outer navigation controls', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /function renderReview\(\)\{state\.reviewMode=true;\$\('#quiz-controls'\)\.classList\.add\('hidden'\)/);
  assert.match(source, /function saveAnswerFromUI\(\)\{if\(state\.reviewMode\)return/);
  assert.match(source, /async function showView\(view\).*persistQuestionnaireNow/s);
});

test('AI endpoint responds to mobile CORS preflight', async () => {
  const handler = (await import('../netlify/functions/ai-coaching.mjs')).default;
  const response = await handler(new Request('https://forge.test/.netlify/functions/ai-coaching', { method:'OPTIONS' }));
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), '*');
});


test('both questionnaire skip controls use the same persistence handler', async () => {
  const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /\$\('#quiz-skip'\)\.onclick=skipQuestionnaire;\$\('#quiz-skip-now'\)\.onclick=skipQuestionnaire/);
});
