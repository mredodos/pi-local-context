import { config } from './fixtures.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { selectLog, reduceToolResult as reducer, recoverLog, LOG_KEY, createToolController as controllerFactory, TOOLS_ENTRY } from '../lib/context.mjs';
import { model, logFixture, eventFixture } from './fixtures.mjs';

const reduceToolResult = (event, ctx) => reducer(event, ctx, config);
const createToolController = pi => controllerFactory(pi, config);

test('selection preserves middle diagnostics, stack frames, warnings and edge rows', () => {
  const text = logFixture(), result = selectLog(text);
  assert.ok(result.omitted > 500);
  for (const line of ['E_CACHE_STALE', 'at makeCacheKey', 'warning: cancellation', 'module_0.ts', 'module_599.ts']) assert.ok(result.text.includes(line), line);
  assert.ok(result.text.length < text.length * 0.1);
});

test('unknown text, source, JSON, empty and oversized lines remain untouched', () => {
  for (const text of ['', 'const x = 1;\n'.repeat(1000), JSON.stringify({data: 'x'.repeat(20000)}), 'warning: broken\n'.repeat(1000), logFixture()+'\n'+'x'.repeat(16001)]) assert.equal(selectLog(text), undefined);
});

test('result reduces both representations while preserving status, metadata and exact originals', () => {
  const event = eventFixture(), before = JSON.stringify(event), result = reduceToolResult(event, {model});
  assert.equal(JSON.stringify(event), before);
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.exit_code, 1);
  assert.equal(result.structuredContent.truncated, true);
  assert.equal(result.structuredContent.wall_time_seconds, 2);
  assert.equal(result.structuredContent.output, result.content[0].text);
  assert.equal(result.details.existing, 'preserved');
  assert.deepEqual(result.details[LOG_KEY].content, event.content);
  assert.deepEqual(result.details[LOG_KEY].structuredContent, event.structuredContent);
  assert.match(result.content[0].text, /exit_code=1/);
});

test('nested calls, file reads, other models and already-selected results are untouched', () => {
  const e = eventFixture();
  for (const changed of [{parentToolCallId:'parent'}, {toolName:'read'}, {content:[...e.content,{type:'image',data:'synthetic'}]}, {input:{command:'cat source.ts'}}, {details:{[LOG_KEY]:{version:1}}}, {structuredContent:{...e.structuredContent,truncated:true}}]) assert.equal(reduceToolResult({...e,...changed},{model}),undefined);
  assert.equal(reduceToolResult(e,{model:{...model,provider:'other'}}),undefined);
});

test('native tail truncation uses complete structured output to recover middle diagnostics', () => {
  const e=eventFixture();
  e.content=[{type:'text',text:e.content[0].text.slice(-4000)}];
  e.details={truncation:{truncated:true},fullOutputPath:'D:/synthetic/build.log'};
  const result=reduceToolResult(e,{model});
  assert.match(result.content[0].text,/E_CACHE_STALE/);
  assert.match(result.content[0].text,/D:\/synthetic\/build.log/);
  assert.equal(result.details.fullOutputPath,e.details.fullOutputPath);
});

test('native truncation without a complete structured capture stays untouched', () => {
  for (const structuredContent of [undefined, { output: logFixture() }, { truncated: false }]) {
    const event = { ...eventFixture(), structuredContent, details: { truncation: { truncated: true }, fullOutputPath: 'synthetic-build.log' } };
    assert.equal(reduceToolResult(event, { model }), undefined);
  }
});

test('original log is recoverable across a compaction and paginated without omissions', () => {
  const e=eventFixture(), reduced=reduceToolResult(e,{model});
  const entries=[{type:'message',message:{role:'toolResult',toolCallId:e.toolCallId,...reduced}},{type:'compaction',summary:'synthetic checkpoint'}];
  let startLine=1, recovered=[];
  while(startLine<=logFixture().split('\n').length){
    const page=recoverLog(entries,{toolCallId:e.toolCallId,startLine,limit:90});
    recovered.push(...page.text.split('\n').slice(1).map(s=>s.replace(/^\d+: /,'')));
    assert.ok(page.nextLine>startLine);startLine=page.nextLine;
  }
  assert.equal(recovered.join('\n'),logFixture());
  assert.match(recoverLog(entries,{toolCallId:e.toolCallId,query:'E_CACHE_STALE'}).text,/301: src\/cache\/key.ts/);
  assert.throws(()=>recoverLog(entries,{toolCallId:'missing'}),/No preserved log/);
  assert.throws(()=>recoverLog(entries,{toolCallId:e.toolCallId,limit:401}),/1..400/);
});

function controllerFixture(branch=[]) {
  const names=['read','bash','edit','write','lens_diagnostics','ask_user_question','memory_recall','codemode','tool_search','web_search','fetch_content','source_check','get_search_content','workflow','workflow_control','context_tools','context_log'];
  let active=names.filter(n=>!n.startsWith('context_'));const entries=branch;
  const pi={getAllTools:()=>names.map(name=>({name,exposure:'direct'})),getActiveTools:()=>active,setActiveTools:names=>{active=names;},appendEntry:(customType,data)=>entries.push({type:'custom',customType,data})};
  const ctx={model,sessionManager:{getBranch:()=>entries}};
  return {controller:createToolController(pi),pi,ctx,loadout:{declared:names.map(name=>({name}))},entries};
}

test('only six optional schemas are hidden; memory, code tools and user questions remain visible', () => {
  const f=controllerFixture();f.controller.refresh(f.ctx,true);
  assert.deepEqual(f.controller.project(f.loadout).hiddenDeclarations,['web_search','fetch_content','source_check','get_search_content','workflow','workflow_control']);
  assert.ok(f.pi.getActiveTools().includes('context_tools'));
  assert.ok(f.pi.getActiveTools().includes('memory_recall'));
});

test('loaded group stays stable, survives restoration, and never exposes the other group', () => {
  const f=controllerFixture();f.controller.refresh(f.ctx,true);
  assert.equal(f.controller.load('web',f.ctx).length,4);
  assert.deepEqual(f.controller.project(f.loadout).hiddenDeclarations,['workflow','workflow_control']);
  f.controller.refresh(f.ctx);
  assert.deepEqual(f.controller.project(f.loadout).hiddenDeclarations,['workflow','workflow_control']);
  const restored=controllerFixture(f.entries);restored.controller.refresh(restored.ctx,true);
  assert.deepEqual(restored.controller.project(restored.loadout).hiddenDeclarations,['workflow','workflow_control']);
  assert.equal(f.entries.at(-1).customType,TOOLS_ENTRY);
});

test('switching model restores full declarations and removes local helper tools', () => {
  const f=controllerFixture();f.controller.refresh(f.ctx,true);
  f.controller.refresh({...f.ctx,model:{...model,provider:'other'}});
  assert.equal(f.controller.project(f.loadout),undefined);
  assert.ok(!f.pi.getActiveTools().includes('context_log'));
  assert.ok(f.pi.getActiveTools().includes('web_search'));
});

test('malformed saved groups cannot activate unknown tools', () => {
  for(const groups of ['bad',['unknown','web']]){
    const f=controllerFixture([{type:'custom',customType:TOOLS_ENTRY,data:{groups}}]);f.controller.refresh(f.ctx,true);
    assert.ok(f.controller.project(f.loadout).hiddenDeclarations.includes('workflow'));
  }
});
