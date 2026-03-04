const PORT = 3002;
const cors = {
  "Access-Control-Allow-Origin": "http://localhost:5173",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Bun.serve({
  port: PORT,
  fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (req.method === "POST" && new URL(req.url).pathname === "/spawn") {
      // Detect which terminal launched this server and open a new window there.
      // $TERM_PROGRAM is inherited from whichever terminal ran `bun run dev`.
      const term = Bun.env.TERM_PROGRAM ?? "";

      let script: string;

      if (term === "iTerm.app") {
        // iTerm2 has a native AppleScript API for spawning with a command
        script = `
          tell application "iTerm"
            create window with default profile command "claude"
          end tell
        `;
      } else if (term === "Apple_Terminal") {
        // Terminal.app: do script opens a new window and runs the command
        script = `
          tell application "Terminal"
            do script "claude"
            activate
          end tell
        `;
      } else {
        // Ghostty (and unknown terminals): activate, Cmd+N new window, type command.
        // Falls back to Ghostty if TERM_PROGRAM is unset.
        const appName = term || "Ghostty";
        script = `
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

      Bun.spawn(["osascript", "-e", script]);
      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...cors, "Content-Type": "application/json" },
      });
    }
    return new Response("Not found", { status: 404 });
  },
});
console.log(`Spawn server on http://localhost:${PORT}`);
