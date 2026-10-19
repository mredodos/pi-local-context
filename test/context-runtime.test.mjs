import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { eventFixture, logFixture, config } from './fixtures.mjs';
import { LOG_KEY } from '../lib/context.mjs';
const root=path.dirname(path.dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))));
const fromRoot=relative=>import(pathToFileURL(path.join(root,relative)));
const {discoverAndLoadExtensions}=await fromRoot('dist/core/extensions/loader.js');
const {DefaultResourceLoader}=await fromRoot('dist/core/resource-loader.js');
const {createAgentSession}=await fromRoot('dist/core/sdk.js');
const {SessionManager}=await fromRoot('dist/core/session-manager.js');
const {SettingsManager}=await fromRoot('dist/core/settings-manager.js');
const {ModelRuntime}=await fromRoot('dist/core/model-runtime.js');
const {AuthStorage}=await fromRoot('dist/core/auth-storage.js');
const {createBashToolDefinition}=await fromRoot('dist/core/tools/bash.js');
const {AssistantMessageEventStream}=await import('@earendil-works/pi-ai/utils/event-stream');
const {estimateTokens}=await fromRoot('dist/core/compaction/compaction.js');
const here=path.dirname(fileURLToPath(import.meta.url));

async function createSession(extraTools = []) {
  const agentDir=fs.mkdtempSync(path.join(os.tmpdir(),'pi-context-sdk-'));
  const previous=process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR=agentDir;
  fs.writeFileSync(path.join(agentDir,'pi-local-context.json'),JSON.stringify(config));
  let loaded;
  try { loaded=await discoverAndLoadExtensions([path.join(here,'../extensions/context-efficiency.ts')],here,agentDir); }
  finally { if(previous===undefined)delete process.env.PI_CODING_AGENT_DIR;else process.env.PI_CODING_AGENT_DIR=previous; fs.rmSync(agentDir,{recursive:true,force:true}); }
  assert.deepEqual(loaded.errors,[]);
  const settingsManager=SettingsManager.inMemory({compaction:{enabled:false},cacheWarming:'off'});
  const resourceLoader=new DefaultResourceLoader({cwd:here,agentDir:path.join(here,'unused-test-agent'),settingsManager,noExtensions:true,noSkills:true,noPromptTemplates:true,noThemes:true,noContextFiles:true,systemPrompt:'Synthetic integration test. Tools are test doubles.',extensionsOverride:()=>loaded});
  await resourceLoader.reload();
  const modelRuntime=await ModelRuntime.create({credentials:AuthStorage.inMemory(),modelsPath:null,modelsStorePath:null,allowModelNetwork:false,refreshOnCreate:false});
  modelRuntime.registerProvider('synthetic-local',{api:'openai-completions',baseUrl:'http://127.0.0.1:1/v1',models:[{id:'synthetic-model',name:'Synthetic model',input:['text'],reasoning:true,contextWindow:98304,maxTokens:32768,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}]});
  await modelRuntime.setRuntimeApiKey('synthetic-local','synthetic-test-only');
  const model=modelRuntime.getModel('synthetic-local','synthetic-model');
  const trivial={type:'object',properties:{},additionalProperties:false};
  const customTools=['web_search','source_check','fetch_content','get_search_content','workflow','workflow_control','memory_recall'].map(name=>({name,label:name,description:`Synthetic ${name}`,parameters:trivial,async execute(){return {content:[{type:'text',text:'synthetic result'}],details:{}};}})).concat(extraTools);
  const {session}=await createAgentSession({cwd:here,agentDir:path.join(here,'unused-test-agent'),modelRuntime,model,thinkingLevel:'medium',resourceLoader,settingsManager,sessionManager:SessionManager.inMemory(here),customTools});
  await session.bindExtensions({});
  return session;
}

test('real Pi tool hooks, declaration projection, loading and recovery work in an agent loop', async () => {
  const session=await createSession();
  try {
    const original=eventFixture();
    const reduced=await session.extensionRunner.emitToolResult(original);
    assert.ok(reduced.details[LOG_KEY]);
    session.sessionManager.appendMessage({role:'toolResult',toolCallId:original.toolCallId,toolName:'bash',...reduced,timestamp:0});
    const calls=[{name:'context_log',arguments:{toolCallId:original.toolCallId,query:'E_CACHE_STALE'}},{name:'context_tools',arguments:{group:'web'}},{name:'web_search',arguments:{}}];
    const requests=[];let index=0;
    session.agent.streamFunction=async (model,context)=>{
      requests.push(structuredClone(context.messages));
      const call=calls[index++];
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:call?[{type:'toolCall',id:`call-${index}`,name:call.name,arguments:call.arguments}]:[{type:'text',text:'Verified the error and loaded web tools.'}],stopReason:call?'toolUse':'stop',usage:{input:context.messages.reduce((sum,m)=>sum+estimateTokens(m),0),output:25,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
      const stream=new AssistantMessageEventStream();stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
    };
    await session.prompt('Check the preserved build error, then load web tools and use the synthetic search.');
    assert.equal(requests.length,4);
    const schemas=messages=>messages.filter(m=>m.role==='system').flatMap(m=>m.toolsAdded??[]).map(t=>t.name);
    assert.ok(!schemas(requests[0]).includes('web_search'));
    assert.ok(!schemas(requests[0]).includes('workflow'));
    assert.ok(schemas(requests[0]).includes('memory_recall'));
    assert.ok(schemas(requests[2]).includes('web_search'));
    assert.ok(!schemas(requests[2]).includes('workflow'));
    const results=session.sessionManager.getBranch().filter(e=>e.type==='message'&&e.message.role==='toolResult').map(e=>e.message);
    assert.ok(results.some(r=>r.toolName==='context_log'&&r.content[0].text.includes('301: src/cache/key.ts')));
    assert.ok(results.some(r=>r.toolName==='web_search'&&!r.isError));
    assert.equal(results[0].details[LOG_KEY].content[0].text,logFixture());
    assert.ok(results[0].content[0].text.length<logFixture().length*0.1);
  } finally {session.dispose();}
});

test('native shell formatting preserves an error in complete structured output beyond the visible tail', async () => {
  const session=await createSession();
  let outputPath;
  try {
    const source=logFixture()+'\n'+Array.from({length:1200},(_,i)=>`[build] module trailing_${i}.ts: compilation passed; checked 12 declarations and 4 imports; no diagnostics.`).join('\n');
    const native=createBashToolDefinition(here,{operations:{async exec(_command,_cwd,{onData}){onData(Buffer.from(source));return {exitCode:1};}}});
    const result=await native.execute('shell-native',{command:'npm run build'},undefined,undefined,{cwd:here,sessionManager:session.sessionManager});
    outputPath=result.details?.fullOutputPath;
    assert.ok(!result.content[0].text.includes('E_CACHE_STALE'));
    assert.equal(result.isError,true);
    const reduced=await session.extensionRunner.emitToolResult({type:'tool_result',toolName:'bash',toolCallId:'shell-native',input:{command:'npm run build'},...result});
    assert.match(reduced.content[0].text,/E_CACHE_STALE/);
    assert.equal(reduced.structuredContent.exit_code,1);
    assert.equal(reduced.details[LOG_KEY].structuredContent.output,source);
    assert.ok(estimateTokens({role:'toolResult',content:reduced.content}) < estimateTokens({role:'toolResult',content:result.content}) / 10);
  } finally {session.dispose();if(outputPath)fs.rmSync(outputPath,{force:true});}
});


test('native compaction serialization excludes archived originals and keeps diagnostics', async () => {
  const {convertToLlm,serializeConversation}=await fromRoot('dist/index.js');
  const session=await createSession();
  try {
    const e=eventFixture();const result=await session.extensionRunner.emitToolResult(e);
    const text=serializeConversation(convertToLlm([{role:'toolResult',toolName:'bash',toolCallId:e.toolCallId,...result,timestamp:0}]));
    assert.match(text,/E_CACHE_STALE/);
    assert.ok(!text.includes('module_200.ts'));
    assert.ok(!text.includes(LOG_KEY));
  }finally{session.dispose();}
});

test('actual agent-loop timeout conversion cannot disguise an incomplete native tail as complete', async () => {
  const source=logFixture()+'\n'+Array.from({length:1200},(_,i)=>`[build] module trailing_${i}.ts: compilation passed; checked 12 declarations and 4 imports; no diagnostics.`).join('\n');
  const native=createBashToolDefinition(here,{operations:{async exec(_command,_cwd,{onData}){onData(Buffer.from(source));throw new Error('timeout:1');}}});
  const session=await createSession([native]);
  let outputPath;
  try {
    let requested=false;
    session.agent.streamFunction=async model=>{
      const call=!requested;requested=true;
      const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,content:call?[{type:'toolCall',id:'native-timeout',name:'bash',arguments:{command:'npm run build'}}]:[{type:'text',text:'Timeout observed.'}],stopReason:call?'toolUse':'stop',usage:{input:1,output:1,cacheRead:0,cacheWrite:0,totalTokens:2,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}},timestamp:Date.now()};
      const stream=new AssistantMessageEventStream();stream.push({type:'done',reason:message.stopReason,message});stream.end();return stream;
    };
    await session.prompt('Run the synthetic timed-out build.');
    const result=session.sessionManager.getBranch().find(entry=>entry.type==='message'&&entry.message.role==='toolResult'&&entry.message.toolCallId==='native-timeout').message;
    const text=result.content[0].text;
    outputPath=text.match(/Full output: ([^\]]+)\]/)?.[1];
    assert.match(text,/Command timed out after 1 seconds/);
    assert.match(text,/\[Showing/);
    assert.ok(!text.includes('E_CACHE_STALE'));
    assert.equal(result.structuredContent,undefined);
    assert.equal(result.details[LOG_KEY],undefined);
    assert.ok(!text.includes('[Selected log:'));
  } finally {session.dispose();if(outputPath)fs.rmSync(outputPath,{force:true});}
});
