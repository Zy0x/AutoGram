const fs = require("fs");

let raw = "";
try {
  raw = fs.readFileSync(0, "utf8");
} catch {
  process.exit(0);
}

let payload;
try {
  payload = JSON.parse(raw);
} catch {
  process.exit(0);
}

const command = String(
  (payload.tool_input && payload.tool_input.command) || payload.command || ""
);

const blocked =
  /rm\s+-rf\s+[\\/]|Remove-Item\s+-Recurse\s+-Force\s+[A-Z]:\\|git\s+push\s+.*--force|git\s+reset\s+--hard\s+origin/i;

if (blocked.test(command)) {
  process.stdout.write(
    JSON.stringify({
      decision: "block",
      reason:
        "Blocked destructive command by AutoGram PreToolUse hook. Ask the user first.",
    })
  );
}

process.exit(0);
