import assert from 'node:assert/strict'; import test from 'node:test';
import {SPRITES,spriteGrid,logoGrid,renderGrid,joinBlocks} from '../dist/lib/wizard/ui/pixel.js';
import {stripAnsi,visibleWidth} from '../dist/utils/string-width.js';
test('every tool sprite is 12 by 10 pixels and renders five terminal rows',()=>{
 for(const id of Object.keys(SPRITES)){const grid=spriteGrid(id);assert.equal(grid.length,10,id);assert.ok(grid.every(row=>row.length===12),id);const rows=renderGrid(grid);assert.equal(rows.length,5);assert.ok(rows.every(row=>visibleWidth(row)===12));}
 assert.equal(logoGrid()[0].length,32);assert.equal(spriteGrid('missing'),undefined);
});
test('pixel pairs and joined blocks preserve terminal widths',()=>{
 assert.equal(stripAnsi(renderGrid([['#ff0000',undefined,'#00ff00','#0000ff'],[undefined,'#ff0000','#00ff00','#ff0000']])[0]),'▀▄█▀');
 assert.deepEqual(joinBlocks([['ab'],['x','y']],[3,1],1).map(stripAnsi),['    x','ab  y']);
});
test('localized logo lines fit narrow terminal widths',async()=>{
 const {renderLogo}=await import('../dist/lib/wizard/ui/logo.js');const {logger}=await import('../dist/utils/logger.js');const {configManager}=await import('../dist/lib/config.js');const {i18n}=await import('../dist/lib/i18n.js');
 const log=logger.log,newLine=logger.newLine,lang=i18n.getLocale();const descriptor=Object.getOwnPropertyDescriptor(process.stdout,'columns');
 try{logger.newLine=()=>{};for(const language of ['en_US','zh_CN']){i18n.init(language);for(const columns of [28,38,40,50,58,60]){Object.defineProperty(process.stdout,'columns',{value:columns,configurable:true});const lines=[];logger.log=line=>lines.push(line);renderLogo('codex');assert.ok(lines.every(line=>visibleWidth(line)<=columns),JSON.stringify({language,columns,lines}));}}}
 finally{logger.log=log;logger.newLine=newLine;i18n.init(lang);if(descriptor)Object.defineProperty(process.stdout,'columns',descriptor);else delete process.stdout.columns;}
});
