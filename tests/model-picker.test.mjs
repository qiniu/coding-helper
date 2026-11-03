import assert from 'node:assert/strict'; import test from 'node:test'; import { runPrompt } from './helpers/prompt-pty.mjs';
test('real PTY model picker search cancellation never saves helper settings', { skip: process.platform === 'win32' }, async () => {
 const out = await runPrompt(`import fs from 'node:fs'; import { configManager } from './dist/lib/config.js'; import { marketModelService } from './dist/lib/market-model-service.js'; import { pickModel } from './dist/lib/wizard/flows/model-pick-flow.js'; configManager.getConnection = () => ({apiKey:'fake',baseUrl:'https://example.com',endpoint:'china'}); marketModelService.fetchModels=async()=>[{id:'z-ai/glm-5.2',name:'GLM',features:['工具调用'],model_constraints:{context_length:200000,max_tokens:8192},architecture:{function_calling:{supported:true}}}]; console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'PICK_READY'}))); console.log('SAVED',fs.existsSync(configManager.configFile));`, [['glm-5.2', 'zzzz'], ['zzzz', '\x1b'], [/⌕ {1,2}直接打字搜索/, '\x1b']]);
 assert.match(out, /RESULT.*"back"/); assert.match(out, /SAVED.*false/);
});
const pickerHead = `import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {modelService} from './dist/lib/model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';configManager.getConnection=()=>({apiKey:'bound-test-key',baseUrl:'https://api.modelink.ai',endpoint:'international'});`;
test('picker falls back to the standard catalog and shows its bound connection', {skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>{throw Error('HTTP 404');};modelService.fetchModels=async(url,key)=>{if(url!=='https://api.modelink.ai'||key!=='bound-test-key')throw Error('wrong connection');return[{id:'vendor/standard'}]};console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'FALLBACK_READY'})));`;
 const out=await runPrompt(source,[['vendor/standard','\r']]);assert.match(out,/RESULT.*"model":"vendor\/standard"/);assert.match(out,/modelink.ai/);assert.doesNotMatch(out,/api.qnaigc.com/);
});
test('picker retains manual entry when both catalogs are unavailable', {skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=modelService.fetchModels=async()=>{throw Error('offline')};console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'MANUAL_READY'})));`;
 const out=await runPrompt(source,[[/请选择后续操作[^]*Esc 返回/,'\x1b[B\r'],['←→','vendor/custom'],['vendor/custom','\r']]);assert.match(out,/RESULT.*"model":"vendor\/custom"/);
});
for(const query of ['vision','vision 1m','thinking']) test('picker preserves capability constraints for '+query,{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'a/text',name:'Text',features:['工具调用'],model_constraints:{context_length:200000}}];console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'CONSTRAINT_READY'})));`;
 const out=await runPrompt(source,[['←→',query],[query,'\x1b'],['a/text','\x1b']]);const searched=out.slice(out.indexOf('⌕ '+query));const search=searched.slice(0,searched.indexOf('? '));assert.doesNotMatch(search,/❯/);assert.match(out,/RESULT.*"back"/);
});

test('production generic model flow opens picker and remembers accepted selections',{skip:process.platform==='win32'},async()=>{
 const source=`import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {runGenericModelSelectionFlow} from './dist/lib/wizard/flows/generic-model-selection-flow.js';configManager.setApiKey('fake');marketModelService.fetchModels=async()=>[{id:'vendor/model',name:'Model',features:['工具调用']}];console.log('RESULT',await runGenericModelSelectionFlow('opencode','PICK_PRODUCTION'));console.log('RECENT',JSON.stringify(configManager.getModels().recentModels));`;
 const out=await runPrompt(source,[['←→','\r']]);assert.match(out,/RESULT vendor\/model/);assert.match(out,/RECENT.*\["vendor\/model"\]/);
});

test('model picker supports reasoning capability search with current metadata',{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'a/brain',name:'Reasoner',features:['工具调用','深度思考'],model_constraints:{context_length:200000}},{id:'a/text',name:'Text',features:['工具调用']}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;
 const out=await runPrompt(source,[['←→','思考'],['思考','\r']]);assert.match(out,/RESULT.*"model":"a\/brain"/);
});

for(const [input,expected] of [['qwen/foo','qwen/foo'],['qwen/','qwen/foobar']])test('picker distinguishes explicit ID from namespace search: '+input,{skip:process.platform==='win32'},async()=>{
 const source=pickerHead+`marketModelService.fetchModels=async()=>[{id:'qwen/foobar',name:'FooBar',features:['工具调用']}];console.log('RESULT',JSON.stringify(await pickModel({tools:[]})));`;const out=await runPrompt(source,[['←→',input],[input,'\r']]);assert.ok(out.includes('"model":"'+expected+'"'),out);
});
// 选中模型的概览在列表上方（提示行之后、搜索框之前），随移动、搜索、切换厂商实时更新；矮终端下整页仍在一屏内
const overviewSource = pickerHead + `import {i18n} from './dist/lib/i18n.js';i18n.init('zh_CN');const m=(id,ctx)=>({id,name:id,features:['工具调用'],model_constraints:{context_length:ctx,max_tokens:8192},architecture:{function_calling:{supported:true}}});marketModelService.fetchModels=async()=>[m('deepseek/deepseek-v3.1',128000),m('qwen/qwen3-max',1000000),m('z-ai/glm-4.6',200000),...Array.from({length:12},(_,i)=>m('zfill/model-'+i,32000))];console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'OVERVIEW_READY'})));`;
const lastFrame = text => text.slice(text.lastIndexOf('? 选择模型'));
for (const [columns, rows] of [[100, 30], [60, 16]]) {
  test(`model overview sits above the search box and follows the selection at ${columns}x${rows}`, { skip: process.platform === 'win32' }, async () => {
    const frames = [];
    // 每一步都等到底部操作提示（…搜索）出现再截取：高负载下输出会分块到达，避免截到画了一半的一帧
    const grab = keys => text => { frames.push(lastFrame(text)); return keys; };
    const out = await runPrompt(overviewSource, [
      [/切换厂商[^]*搜索/, grab('\x1b[B')],
      [/1M 上下文[^]*搜索/, grab('glm')],
      [/200K 上下文[^]*搜索/, grab('\x1b')],
      [/⌕ {1,2}直接打字搜索/, grab('\x1b[C')],
      [/❯ +deepseek\/deepseek-v3\.1[^]*搜索/, '\x1b[C'],
      [/❯ +qwen\/qwen3-max[^]*搜索/, grab('\x1b')],
    ], columns, { rows });
    frames.push(lastFrame(out));
    const [first, moved, searched, , tabbed] = frames;
    // 概览在提示行之后、搜索框之前
    for (const [frame, text] of [[first, '128K 上下文'], [moved, '1M 上下文'], [searched, '200K 上下文']]) {
      const overview = frame.indexOf(text), search = frame.indexOf('⌕');
      assert.ok(overview > 0 && search > overview, `overview "${text}" not above the search box:\n${frame}`);
    }
    // 切换到 Qwen 厂商后概览跟着更新
    assert.match(tabbed, /qwen3-max  qwen · 1M 上下文/);
    // 从提示行到操作提示都在一屏内（另留 1 行给光标）
    const used = first.split('\n').length;
    assert.ok(used < rows, `menu uses ${used} rows of ${rows}:\n${first}`);
    assert.match(out, /RESULT "back"/);
  });
}

// 概览只展示能力，内容全部来自模型广场接口（/v1/market/models）：发布方、上下文与最大输出、标记、下线日期、能力标签；不显示价格
const apiModel = `{id:'vendorless-model',name:'Demo-5.1',issuer:{name:'DemoAI'},hot_tags:['热门'],retirement_at:'2999-01-01',features:['工具调用','深度思考','AI 编程'],model_constraints:{context_length:200000,max_tokens:128000},architecture:{function_calling:{supported:true},input_modalities:['text']},pricing_rules_v2:[{details_v2:{th_input:{unit_name:'token',unit_size:1000,unit_price:0.006,unit_price_usd:0.00087},th_output:{unit_name:'token',unit_size:1000,unit_price:0.024,unit_price_usd:0.0035},cache:{unit_name:'token',unit_size:1000,unit_price:0.0001}}},{details_v2:{ncache_peak:{unit_name:'token',unit_size:1000,unit_price:0.008,unit_price_usd:0.00116},output_offpeak:{unit_name:'token',unit_size:1000,unit_price:0.028,unit_price_usd:0.00406}}}]}`;
for (const [locale, endpoint, expected] of [
  ['zh_CN', 'china', ['Demo-5.1  DemoAI · 200K 上下文 · 最大输出 128K  热门  2999-01-01 下线', '工具调用 · 深度思考 · AI 编程']],
  ['en_US', 'international', ['Demo-5.1  DemoAI · 200K context · 128K max output  Hot  retiring 2999-01-01', 'Tool calls · Thinking · Coding']],
]) {
  test(`model overview renders market API fields (${locale}, ${endpoint})`, { skip: process.platform === 'win32' }, async () => {
    const source = `import {configManager} from './dist/lib/config.js';import {marketModelService} from './dist/lib/market-model-service.js';import {pickModel} from './dist/lib/wizard/flows/model-pick-flow.js';import {i18n} from './dist/lib/i18n.js';i18n.init('${locale}');configManager.getConnection=()=>({apiKey:'k',baseUrl:'https://example.com',endpoint:'${endpoint}'});marketModelService.fetchModels=async()=>[${apiModel}];console.log('RESULT',JSON.stringify(await pickModel({tools:[],title:'API_READY'})));`;
    const out = await runPrompt(source, [[/vendorless-model[^]*(搜索|search)/, '\x1b']], 100, { rows: 30 });
    const frame = out.slice(out.lastIndexOf('? '), out.lastIndexOf('⌕'));
    for (const text of expected) assert.ok(frame.includes(text), `missing "${text}" in:\n${frame}`);
    // 不显示价格
    assert.ok(!/0\.006|0\.00087|元|\$/.test(frame), frame);
  });
}
