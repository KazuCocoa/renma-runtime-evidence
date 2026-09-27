import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const exec = promisify(execFile);

// Synthetic protocol double only: never presented as real Codex evidence.
const double = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
if (args.includes('--version')) { console.log('codex-cli 0.157.1'); process.exit(0); }
if (args.includes('login')) { console.error('Logged in using ChatGPT'); process.exit(0); }
const rl = require('node:readline').createInterface({input: process.stdin});
let thread = 0; let turn = 0; let dynamic = false; let pendingTool;
const send = value => process.stdout.write(JSON.stringify(value)+'\\n');
rl.on('line', line => {
 const req = JSON.parse(line);
 if (req.method === undefined && pendingTool && req.id === 77) {
   const p = pendingTool; pendingTool = undefined;
   if (p.explicitSkill && !fs.readFileSync(p.skillPath,'utf8').includes('RENMA_MODEL_FRESHNESS_B')) throw new Error('Synthetic ordering assertion failed');
   if (p.explicitSkill) fs.writeFileSync(path.join(process.cwd(),'renma-model-freshness-result.txt'),'RENMA_MODEL_FRESHNESS_A');
   send({method:'item/completed',params:{threadId:p.threadId,turnId:p.turnId,item:{id:'barrier-call',type:'dynamicToolCall',namespace:null,tool:'renma_freshness_barrier',status:'completed',success:true,arguments:{secret:'PRIVATE_SENTINEL'},contentItems:['PRIVATE_SENTINEL']}}});
   send({method:'turn/completed',params:{threadId:p.threadId,turn:{id:p.turnId,status:'completed',items:['PRIVATE_SENTINEL']}}});
   return;
 }
 if (req.id === undefined) return;
 let result = {};
 if (req.method === 'skills/list') {
   const skillPath = path.join(process.cwd(), '.agents/skills/renma-listing-freshness-fixture/SKILL.md');
   const content = fs.readFileSync(skillPath, 'utf8');
   result = {data:[{cwd:process.cwd(),skills:[{name:'renma-listing-freshness-fixture', path:skillPath,description:content.includes('RENMA_MODEL_FRESHNESS_B')?'Synthetic listing metadata revision B.':'Synthetic listing metadata revision A.', enabled:true, private:'PRIVATE_SENTINEL'}],errors:[]}]};
 } else if (req.method === 'thread/start') {
   dynamic = Array.isArray(req.params.dynamicTools);
   result = {thread:{id:'private-thread-'+(++thread),ephemeral:true,preview:'PRIVATE_SENTINEL'}};
 } else if (req.method === 'turn/start') {
   const id = 'private-turn-'+(++turn);
   if (dynamic) {
     pendingTool = {threadId:req.params.threadId,turnId:id,explicitSkill:req.params.input.length===2,skillPath:req.params.input[1]?.path};
     send({id:77,method:'item/tool/call',params:{threadId:req.params.threadId,turnId:id,callId:'barrier-call',namespace:null,tool:'renma_freshness_barrier',arguments:{}}});
     send({id:req.id,result:{turn:{id}}});
     return;
   }
   const content = fs.readFileSync(req.params.input[1].path,'utf8');
   fs.writeFileSync(path.join(process.cwd(),'renma-model-freshness-result.txt'),content.includes('RENMA_MODEL_FRESHNESS_B')?'RENMA_MODEL_FRESHNESS_B':'RENMA_MODEL_FRESHNESS_A');
   send({method:'item/completed',params:{text:'PRIVATE_SENTINEL',threadId:req.params.threadId}});
   // Completion before the response exercises the early-notification path.
   send({method:'turn/completed',params:{threadId:req.params.threadId,turn:{id,status:'completed',items:['PRIVATE_SENTINEL']}}});
   result = {turn:{id,items:['PRIVATE_SENTINEL']}};
 }
 send({id:req.id,result});
});
`;

test("synthetic protocol double exercises early completion, reduction, and temporary cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-protocol-double-"));
  const bin = join(root, "bin");
  const auth = join(root, "auth");
  const temporary = join(root, "temporary");
  try {
    await Promise.all([bin, auth, temporary].map((p) => mkdir(p)));
    await writeFile(join(bin, "codex"), double);
    await chmod(join(bin, "codex"), 0o700);
    await writeFile(join(auth, "auth.json"), "SYNTHETIC_CREDENTIAL_SENTINEL");
    const output = await exec(
      process.execPath,
      [
        resolve(".build/experiments/codex-model-freshness/src/run.js"),
        "--use-chatgpt-login",
        "--allow-codex-analytics",
      ],
      {
        env: {
          PATH: bin + delimiter + process.env.PATH,
          CODEX_HOME: auth,
          TMPDIR: temporary,
        },
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(output.stderr, "");
    for (const prohibited of [
      "PRIVATE_SENTINEL",
      "SYNTHETIC_CREDENTIAL_SENTINEL",
      "private-thread-",
      "private-turn-",
      root,
      "RENMA_MODEL_FRESHNESS_A",
      "RENMA_MODEL_FRESHNESS_B",
    ])
      assert.equal(output.stdout.includes(prohibited), false);
    const report = JSON.parse(output.stdout);
    assert.deepEqual(
      report.observations.map(
        (row: { modelTurn: { artifactRevision: string } }) =>
          row.modelTurn.artifactRevision,
      ),
      ["a", "b", "b", "b"],
    );
    assert.equal(report.providerPresence.pipeline, "no-otlp-request");
    assert.equal(report.providerPresence.knownFixtureObserved, false);
    assert.equal(
      await readFile(join(auth, "auth.json"), "utf8"),
      "SYNTHETIC_CREDENTIAL_SENTINEL",
    );
    assert.deepEqual(await readdir(temporary), []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("synthetic barrier double mutates only the Skill condition before the tool reply", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-barrier-double-"));
  const bin = join(root, "bin");
  const auth = join(root, "auth");
  const temporary = join(root, "temporary");
  try {
    await Promise.all([bin, auth, temporary].map((p) => mkdir(p)));
    await writeFile(join(bin, "codex"), double);
    await chmod(join(bin, "codex"), 0o700);
    await writeFile(join(auth, "auth.json"), "SYNTHETIC_CREDENTIAL_SENTINEL");
    const output = await exec(
      process.execPath,
      [
        resolve(".build/experiments/codex-model-freshness/src/run.js"),
        "--use-chatgpt-login",
        "--allow-codex-analytics",
        "--midturn-capability",
      ],
      {
        env: {
          PATH: bin + delimiter + process.env.PATH,
          CODEX_HOME: auth,
          TMPDIR: temporary,
        },
        timeout: 15_000,
        maxBuffer: 64 * 1024,
      },
    );
    assert.equal(output.stderr, "");
    for (const prohibited of [
      "PRIVATE_SENTINEL",
      "SYNTHETIC_CREDENTIAL_SENTINEL",
      "private-thread-",
      "private-turn-",
      "barrier-call",
      root,
    ])
      assert.equal(output.stdout.includes(prohibited), false);
    const report = JSON.parse(output.stdout);
    assert.deepEqual(
      report.rows.map((r: { scenario: string }) => r.scenario),
      ["direct-tool", "skill-midturn"],
    );
    const [direct, skill] = report.rows;
    assert.deepEqual(direct.wrapperBarrier, {
      handled: true,
      replacementVerifiedBeforeReply: false,
    });
    assert.equal(direct.modelTurn.artifactRevision, "absent");
    assert.equal(direct.finalDeployment.revision, "a");
    assert.deepEqual(skill.wrapperBarrier, {
      handled: true,
      replacementVerifiedBeforeReply: true,
    });
    assert.equal(skill.providerTool.completion, "success");
    assert.equal(skill.initialDeployment.revision, "a");
    assert.equal(skill.finalDeployment.revision, "b");
    assert.equal(skill.modelTurn.artifactRevision, "a");
    assert.equal(skill.providerPresence.pipeline, "no-otlp-request");
    assert.deepEqual(await readdir(temporary), []);
    assert.equal(
      await readFile(join(auth, "auth.json"), "utf8"),
      "SYNTHETIC_CREDENTIAL_SENTINEL",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
