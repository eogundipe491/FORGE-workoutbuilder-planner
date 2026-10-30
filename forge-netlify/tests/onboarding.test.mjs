import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
function harness() {
  const elements = new Map(), storage = new Map(), requests = [];
  const element = selector => {
    if (!elements.has(selector)) elements.set(selector, { value: '', disabled: false, textContent: '', innerHTML: '', style: {}, classList: { add(){}, remove(){}, toggle(){} }, close(){ this.closed=true; }, showModal(){ this.open=true; } });
    return elements.get(selector);
  };
  let responseError = null;
  let record = { answers:{}, questionIndex:0, completedAt:null, skipped:false, revision:0 };
  const context = vm.createContext({
    console, structuredClone, clearTimeout, setTimeout: () => 1,
    localStorage: { getItem:key=>storage.get(key)||null, setItem:(key,value)=>storage.set(key,value), removeItem:key=>storage.delete(key) },
    document: { querySelector: element, querySelectorAll:()=>[] },
    window: { scrollTo(){} },
    fetch: async (_url,options) => {
      if(options.method==='GET')return {ok:true,json:async()=>structuredClone(record)};
      const payload=JSON.parse(options.body);requests.push(payload);
      if(responseError)return {ok:false,status:responseError.status,json:async()=>({error:responseError.message})};
      assert.equal(payload.revision, record.revision);
      record={...record,answers:payload.answers,questionIndex:payload.questionIndex,revision:record.revision+1};
      if(payload.action==='complete')record={...record,completedAt:'2026-10-30T00:00:00Z',skipped:false};
      if(payload.action==='skip')record.skipped=true;
      if(payload.action==='restart')record={...record,answers:{},questionIndex:0,completedAt:null,skipped:false};
      return {ok:true,json:async()=>structuredClone(record)};
    },
  });
  vm.runInContext(source.replace(/^import .*;\n/, '').replace(/init\(\);\s*$/, ''), context);
  vm.runInContext("state.user={id:'user-1'};state.profile={onboarding_skipped:false};state.view='questionnaire';state.questionnaireReady=true;state.supabase={auth:{getSession:async()=>({data:{session:{access_token:'test-session'}}}),signOut:async()=>({error:null})}}", context);
  return { context, element, requests, storage, run:code=>vm.runInContext(code,context), setRecord:value=>{record={...record,...value}}, fail:value=>{responseError=value} };
}

test('review navigation preserves all answers and explanations', async()=>{
  const h=harness();h.run("state.questionIndex=36;state.answers={37:'Yes','37_explanation':'Keep this'};renderReview()");
  await h.run('moveQuestion(1)');await h.run('moveQuestion(-1)');h.run('saveAnswerFromUI()');
  assert.equal(h.run('state.answers[37]'),'Yes');assert.equal(h.run("state.answers['37_explanation']"),'Keep this');assert.equal(h.requests.length,0);
});

test('incomplete resumes saved position; completed and skipped restore overview',async()=>{
  for(const [completedAt,skipped,expected] of [[null,false,'questionnaire'],['2026-10-30',false,'overview'],[null,true,'overview']]){
    const h=harness();h.setRecord({answers:{1:'Beginner'},questionIndex:5,completedAt,skipped});
    h.run('ensureProfile=loadExercises=loadWorkouts=loadProgrammes=loadSessions=loadMeals=async()=>{};refreshOverview=()=>{}');
    await h.run("restoreUser({id:'user-1'})");
    assert.equal(h.run('state.view'),expected);assert.equal(h.run('state.questionIndex'),5);
  }
  assert.ok(!source.includes(";showView('home');\n}"));
});

test('failed autosave is visible, keeps browser draft, and prevents leaving',async()=>{
  const h=harness();h.run("state.answers={1:'Beginner'};state.questionnaireDirty=true;cacheQuestionnaire()");h.fail({status:503,message:'Save unavailable'});
  assert.equal(await h.run('flushQuestionnaire()'),false);
  assert.match(h.element('#quiz-save-status').textContent,/Save unavailable/);
  assert.equal(h.storage.size,1);await h.run("showView('training')");assert.equal(h.run('state.view'),'questionnaire');
});

test('both skip buttons use one handler; failure stays and success saves then leaves',async()=>{
  assert.match(source,/\$\('#quiz-skip'\)\.onclick=skipQuestionnaire;\$\('#quiz-skip-top'\)\.onclick=skipQuestionnaire/);
  assert.match(html,/id="quiz-skip-top"/);
  const h=harness();h.run("state.answers={1:'Beginner'};state.questionnaireDirty=true;renderBuilder=()=>{}");
  h.fail({status:503,message:'Save unavailable'});await h.run('skipQuestionnaire()');assert.equal(h.run('state.view'),'questionnaire');
  h.fail(null);await h.run('skipQuestionnaire()');assert.equal(h.run('state.view'),'training');assert.equal(h.run('state.profile.onboarding_skipped'),true);
  assert.equal(h.requests.at(-1).answers[1],'Beginner');
});

test('restart requires confirmation; cancel preserves answers; confirmed restart preserves history',async()=>{
  assert.match(source,/\$\('#restart-questionnaire'\)\.onclick=\(\)=>\$\('#restart-dialog'\)\.showModal\(\)/);
  assert.match(source,/\$\('#restart-cancel'\)\.onclick=\(\)=>\$\('#restart-dialog'\)\.close\(\)/);
  const h=harness();h.run("state.answers={1:'Beginner','1_explanation':'Keep'};state.questionIndex=12;state.sessions=[{id:'session'}];state.workouts=[{id:'workout'}];state.exercises=[{id:'exercise'}]");
  h.element('#restart-dialog').showModal();h.element('#restart-dialog').close();assert.equal(h.run('state.answers[1]'),'Beginner');assert.equal(h.requests.length,0);
  h.fail({status:503,message:'Offline'});await h.run('restartQuestionnaire()');assert.equal(h.run('state.answers[1]'),'Beginner');
  h.fail(null);await h.run('restartQuestionnaire()');assert.equal(h.run('Object.keys(state.answers).length'),0);assert.equal(h.run('state.questionIndex'),0);assert.equal(h.run('state.questionnaireCompletedAt'),null);
  assert.equal(h.run('state.sessions[0].id'),'session');assert.equal(h.run('state.workouts[0].id'),'workout');assert.equal(h.run('state.exercises[0].id'),'exercise');
  await h.run('loadQuestionnaire()');assert.equal(h.run('state.questionIndex'),0);assert.equal(h.run('Object.keys(state.answers).length'),0);
});

test('queued saves are ordered, stale revision rejects, and completion shows existing review',async()=>{
  const h=harness();h.run("state.answers={1:'First'};state.questionnaireDirty=true;state.questionnaireVersion=1");
  const first=h.run('flushQuestionnaire()');h.run("state.answers[1]='Newer';state.questionnaireVersion=2");const second=h.run('flushQuestionnaire()');
  await first;await second;assert.deepEqual(h.requests.map(r=>r.answers[1]),['First','Newer']);assert.deepEqual(h.requests.map(r=>r.revision),[0,1]);
  h.run('state.questionnaireDirty=true');h.fail({status:409,message:'Changed in another tab'});assert.equal(await h.run('flushQuestionnaire()'),false);
  const count=h.requests.length;assert.equal(await h.run('flushQuestionnaire()'),false);assert.equal(h.requests.length,count);
  const done=harness();done.run("state.questionIndex=36;state.answers={37:'No'}");await done.run('moveQuestion(1)');assert.ok(done.run('state.questionnaireCompletedAt'));assert.equal(done.run('state.questionnaireReview'),true);assert.match(done.element('#quiz-question').innerHTML,/Generate AI plan/);assert.match(done.element('#quiz-question').innerHTML,/Build manually/);
});

test('browser drafts recover only for the same user and server revision',async()=>{
  const h=harness();h.storage.set('forge-questionnaire-draft:user-1',JSON.stringify({answers:{1:'Recovered'},questionIndex:8,revision:0}));
  await h.run('loadQuestionnaire()');assert.equal(h.run('state.answers[1]'),'Recovered');assert.equal(h.run('state.questionIndex'),8);assert.equal(h.run('state.questionnaireDirty'),true);
  await h.run('flushQuestionnaire()');assert.equal(h.storage.size,0);
});

test('server rejects unauthenticated and stale saves; restart updates only the authenticated onboarding row',async()=>{
  const {stripTypeScriptTypes}=await import('node:module');
  const endpoint=fs.readFileSync(new URL('../netlify/functions/onboarding.mts',import.meta.url),'utf8');
  const tables=[],updates=[];
  const saved={userId:'user-1',answers:{1:'Old'},questionIndex:10,completedAt:'2026-10-30',skipped:true,revision:2};
  const table={userId:'user_id',revision:'revision'};
  const db={update:target=>{tables.push(target);return {set:values=>({where:conditions=>({returning:async()=>{
    assert.equal(conditions[0][1],'user-1');
    if(conditions[1][1]!==saved.revision)return [];
    updates.push(values);Object.assign(saved,values);return [saved];
  }})})}}};
  const c=vm.createContext({Response,Request,process:{env:{SUPABASE_URL:'https://accounts.example.test',SUPABASE_ANON_KEY:'test-only'}},drizzle:()=>db,onboarding:table,eq:(a,b)=>[a,b],and:(...args)=>args,fetch:async()=>({ok:true,json:async()=>({id:'user-1'})})});
  vm.runInContext(stripTypeScriptTypes(endpoint.replace(/^import .*;\n/gm,'')).replace('export default','globalThis.handle ='),c);
  const request=(body,authenticated=true)=>new Request('https://forge.example.test/.netlify/functions/onboarding',{method:'PUT',headers:{'content-type':'application/json',...(authenticated?{authorization:'Bearer test-only'}:{})},body:JSON.stringify(body)});
  const body={action:'restart',revision:2,answers:{1:'Old'},questionIndex:10};
  assert.equal((await c.handle(request(body,false))).status,401);assert.equal(updates.length,0);
  assert.equal((await c.handle(request({...body,revision:1}))).status,409);assert.equal(updates.length,0);
  assert.equal((await c.handle(request(body))).status,200);
  assert.equal(saved.questionIndex,0);assert.equal(saved.completedAt,null);assert.equal(saved.skipped,false);assert.deepEqual(Object.keys(saved.answers),[]);
  assert.ok(tables.every(t=>t===table));assert.equal(updates.length,1);
  assert.doesNotMatch(endpoint,/\.delete\(|workout_sessions|\.from\(['"]workouts/);
});

test('answer explanations and position survive navigation, refresh and logout; failed flush blocks logout',async()=>{
  const h=harness();
  const input={checked:true,value:'Beginner',closest:()=>({classList:{toggle(){}}})};
  h.context.document.querySelectorAll=selector=>selector.startsWith('#quiz-question input[name=')?[input]:[];
  h.element('#explain-1').value='My explanation';
  h.run('saveAnswerFromUI()');await h.run('moveQuestion(1)');
  h.context.document.querySelectorAll=()=>[];
  await h.run('loadQuestionnaire()');
  assert.equal(h.run('state.questionIndex'),1);assert.equal(h.run("state.answers['1_explanation']"),'My explanation');
  h.run('state.questionnaireDirty=true');h.fail({status:503,message:'Offline'});await h.run('logout()');assert.equal(h.run('state.user.id'),'user-1');
  h.fail(null);await h.run('logout()');assert.equal(h.run('state.user'),null);
  h.run("state.user={id:'user-1'};state.profile={onboarding_skipped:false}");await h.run('loadQuestionnaire()');
  assert.equal(h.run('state.questionIndex'),1);assert.equal(h.run("state.answers['1_explanation']"),'My explanation');
});
