const PORT = 3002;
const cors = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SupportedTerminal = "Ghostty" | "iTerm2" | "Warp";

function detectTerminal(): SupportedTerminal {
  const term = Bun.env.TERM_PROGRAM ?? "";
  if (term === "iTerm.app") return "iTerm2";
  if (term === "WarpTerminal") return "Warp";
  return "Ghostty"; // default for ghostty, zed, unknown, or unset
}

function buildScript(terminal: SupportedTerminal): string {
  if (terminal === "iTerm2") {
    // iTerm2 exposes a native AppleScript API — launch with a command directly.
    return `
      tell application "iTerm"
        create window with default profile command "claude"
      end tell
    `;
  }

  // Ghostty and Warp don't expose a "run command" AppleScript API, so we
  // activate the app, open a new window with Cmd+N, then type the command.
  const appName = terminal; // "Ghostty" or "Warp"
  return `
    tell application "${appName}" to activate
    delay 1
    tell application "System Events"
      tell process "${appName}"
        keystroke "n" using command down
        delay 0.5
        keystroke "claude"
        key code 36
      end tell
    end tell
  `;
}

Bun.serve({
  port: PORT,
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "POST" && new URL(req.url).pathname === "/spawn") {
      const terminal = detectTerminal();
      const script = buildScript(terminal);
      Bun.spawn(["osascript", "-e", script]);
      return new Response(JSON.stringify({ ok: true, terminal }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Spawn server on http://localhost:${PORT}`);
