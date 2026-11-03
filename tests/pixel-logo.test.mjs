import assert from 'node:assert/strict'; import test from 'node:test';
import {SPRITES,spriteGrid,compactQiniuGrid,logoGrid,renderGrid,joinBlocks} from '../dist/lib/wizard/ui/pixel.js';
import {stripAnsi,visibleWidth} from '../dist/utils/string-width.js';
test('tool sprites keep compact dimensions and the official Qiniu mark renders at 24 by 16',()=>{
 for(const id of Object.keys(SPRITES)){const grid=spriteGrid(id);const width=id==='qiniu'?24:12,height=id==='qiniu'?16:10;assert.equal(grid.length,height,id);assert.ok(grid.every(row=>row.length===width),id);const rows=renderGrid(grid);assert.equal(rows.length,height/2,id);assert.ok(rows.every(row=>visibleWidth(row)===width),id);}
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
test('pixel header uses each sprite width at the terminal fallback boundary',async()=>{
 const {default:chalk}=await import('chalk');const {renderLogo}=await import('../dist/lib/wizard/ui/logo.js');const {logger}=await import('../dist/utils/logger.js');
 const log=logger.log,newLine=logger.newLine,level=chalk.level;
 const columns=Object.getOwnPropertyDescriptor(process.stdout,'columns'),tty=Object.getOwnPropertyDescriptor(process.stdout,'isTTY');
 try{
  chalk.level=3;Object.defineProperty(process.stdout,'isTTY',{value:true,configurable:true});logger.newLine=()=>{};
  for(const [sprite,width] of [['qiniu',65],['qiniu',66],['codex',54]]){
   Object.defineProperty(process.stdout,'columns',{value:width,configurable:true});const lines=[];logger.log=line=>lines.push(line);renderLogo(sprite);
   assert.ok(lines.every(line=>visibleWidth(line)<=width),`${sprite} at ${width} columns`);
   assert.equal(lines.length,sprite==='qiniu'?9:6,`${sprite} pixel fallback at ${width}`);
  }
 }finally{
  logger.log=log;logger.newLine=newLine;chalk.level=level;
  for(const [name,descriptor] of [['columns',columns],['isTTY',tty]]){if(descriptor)Object.defineProperty(process.stdout,name,descriptor);else delete process.stdout[name];}
 }
});

test('compact official Qiniu mark fits the short header without cutting ANSI colors',async()=>{
 const {default:chalk}=await import('chalk');const {renderCompactLogo,COMPACT_LOGO_HEIGHT}=await import('../dist/lib/wizard/ui/logo.js');const {logger}=await import('../dist/utils/logger.js');
 const log=logger.log,newLine=logger.newLine,level=chalk.level,columns=Object.getOwnPropertyDescriptor(process.stdout,'columns');
 try{
  const grid=compactQiniuGrid();assert.equal(grid.length,10);assert.ok(grid.every(row=>row.length===16));
  const rowColors=grid.map(row=>[...new Set(row.filter(Boolean))]);assert.ok(rowColors.every(colors=>colors.length===1),'compact mark colors are uniform per row');assert.ok(new Set(rowColors.flat()).size>=5,'compact mark uses a vertical gradient');
  for(const color of [0,3])for(const width of [38,60,100]){
   chalk.level=color;Object.defineProperty(process.stdout,'columns',{value:width,configurable:true});const lines=[];logger.log=line=>lines.push(line);logger.newLine=()=>lines.push('');renderCompactLogo();
   assert.equal(lines.length,COMPACT_LOGO_HEIGHT);assert.ok(lines.every(line=>visibleWidth(line)<=width));
   const plain=lines.map(stripAnsi).join('\n');assert.match(plain,/Coding Helper/);assert.match(plain,/[▀▄█]/);assert.ok(!plain.includes('\x1b'));assert.ok(!plain.includes('…'));
  }
 }finally{logger.log=log;logger.newLine=newLine;chalk.level=level;if(columns)Object.defineProperty(process.stdout,'columns',columns);else delete process.stdout.columns;}
});

test('full and compact Qiniu marks share one vertical gradient through the official blue',async()=>{
 for(const grid of [spriteGrid('qiniu'),compactQiniuGrid()]){
  const colors=grid.map(row=>row.find(Boolean)).filter(Boolean);
  assert.equal(colors[0],'#8BEDFF');assert.equal(colors.at(-1),'#0A6AA6');
  const lum=c=>[1,3,5].reduce((sum,i)=>sum+parseInt(c.slice(i,i+2),16),0);
  for(let i=1;i<colors.length;i++)assert.ok(lum(colors[i])<=lum(colors[i-1]),`row ${i} darker than row ${i-1}`);
  assert.ok(grid.every(row=>new Set(row.filter(Boolean)).size<=1));
  // 官方蓝落在偶数行（半块字符的前景色）上
  const brandRow=grid.findIndex(row=>row.includes('#29A8E1'));assert.ok(brandRow>0&&brandRow%2===0,`official blue row ${brandRow}`);
 }
 assert.equal(SPRITES.qiniu.pal.a,'#29A8E1');
});
