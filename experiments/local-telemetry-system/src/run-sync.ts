import { isAbsolute } from "node:path";
import { exerciseSync, SyncError } from "./sync.js";
const [cli] = process.argv.slice(2);
if (!cli || !isAbsolute(cli) || process.argv.length !== 3)
  throw new Error("Explicit Renma CLI required");
exerciseSync(cli)
  .then((result) =>
    process.stdout.write(JSON.stringify(result, null, 2) + "\n"),
  )
  .catch((error: unknown) => {
    process.stderr.write(
      JSON.stringify({
        outcome: "sync-experiment-failed",
        diagnostic: error instanceof SyncError ? error.message : "unclassified",
      }) + "\n",
    );
    process.exitCode = 1;
  });
