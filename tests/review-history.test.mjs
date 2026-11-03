import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import yaml from 'js-yaml';

test('review comparison retains its merge base after main advances', () => {
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'review-history-'));
  const config=path.join(dir,'gitconfig');fs.writeFileSync(config,'');
  const env={...process.env,GIT_CONFIG_GLOBAL:config,GIT_CONFIG_NOSYSTEM:'1',GIT_TERMINAL_PROMPT:'0'};
  function git(cwd,...args) {
    return spawnSync('git',['-c','core.hooksPath=/dev/null','-c','commit.gpgsign=false','-c','user.name=Fixture','-c','user.email=fixture@example.com',...args],{cwd,env,encoding:'utf8'});
  }
  function ok(cwd,...args) {const result=git(cwd,...args);assert.equal(result.status,0,result.stderr);return result.stdout.trim();}
  try {
    const source=path.join(dir,'source');fs.mkdirSync(source);
    ok(source,'init','-b','main');fs.writeFileSync(path.join(source,'base.txt'),'base');
    ok(source,'add','.');ok(source,'commit','-m','base');
    ok(source,'checkout','-b','feature');fs.writeFileSync(path.join(source,'feature.txt'),'feature');
    ok(source,'add','.');ok(source,'commit','-m','feature');const head=ok(source,'rev-parse','HEAD');
    ok(source,'checkout','main');fs.writeFileSync(path.join(source,'main.txt'),'main advanced');
    ok(source,'add','.');ok(source,'commit','-m','advance');
    const origin=path.join(dir,'origin.git');ok(dir,'clone','--bare',source,origin);
    const workflow=yaml.load(fs.readFileSync('.github/workflows/codex-pr-review-feedback.yml','utf8'));
    const checkout=workflow.jobs.review.steps.find(step=>step.name==='Checkout trusted workflow code');
    const configured=checkout.with['fetch-depth']??1;
    // 先复现旧的深度 1；再按工作流实际配置验证比较范围。
    for(const [name,depth] of [['shallow',1],['configured',configured]]) {
      const runner=path.join(dir,name);
      ok(dir,'clone',...(depth?['--depth',String(depth)]:[]),'--branch','main',pathToFileURL(origin).href,runner);
      ok(runner,'fetch','--no-tags','origin',head);
      const diff=git(runner,'diff','--name-only','main...'+head);
      if(name==='shallow'){assert.notEqual(diff.status,0);assert.match(diff.stderr,/no merge base/);}
      else {assert.equal(diff.status,0,diff.stderr);assert.equal(diff.stdout.trim(),'feature.txt');}
    }
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
