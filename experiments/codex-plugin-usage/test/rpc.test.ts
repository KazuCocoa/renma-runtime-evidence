import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { FixtureRpc } from "../src/rpc.js";

test("control client handles early completion and discards content-bearing notifications", async () => {
  const root = await mkdtemp(join(tmpdir(), "renma-usage-rpc-test-"));
  let rpc: FixtureRpc | undefined;
  try {
    await writeFile(
      join(root, "codex"),
      `#!/usr/bin/env node
const rl=require('node:readline').createInterface({input:process.stdin});
const send=x=>process.stdout.write(JSON.stringify(x)+'\\n');
let turns=0;
rl.on('line',line=>{const m=JSON.parse(line);if(m.id===undefined)return;
if(m.method==='initialize')send({id:m.id,result:{}});
if(m.method==='thread/start')send({id:m.id,result:{thread:{id:'fixture-thread',ephemeral:true}}});
if(m.method==='turn/start'){
 turns++;
 send({method:'item/agentMessage/delta',params:{delta:'PRIVATE_SENTINEL'}});
 send({method:'turn/completed',params:{threadId:'fixture-thread',turn:{id:'fixture-turn',status:turns===1?'completed':'failed'}}});
 send({id:m.id,result:{turn:{id:'fixture-turn'}}});
}
});
`,
      { mode: 0o700 },
    );
    rpc = new FixtureRpc([], root, { PATH: `${root}:${process.env.PATH}` });
    await rpc.initialize();
    const thread = await rpc.startThread(root);
    const result = await rpc.turn(thread, []);
    assert.equal(result, "completed");
    assert.equal(JSON.stringify(result).includes("PRIVATE_SENTINEL"), false);
    await assert.rejects(rpc.turn(thread, []), /Model turn failed/);
  } finally {
    await rpc?.close();
    await rm(root, { recursive: true, force: true });
  }
});
