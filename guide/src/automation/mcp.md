# Agents and the MCP server

CadKit includes a local server that lets an AI coding assistant build and check parts by writing scripts. It speaks the Model Context Protocol (MCP), so any MCP client can use it: Claude Code, Cursor, Claude Desktop, Codex and others. This chapter takes you from nothing to a first successful tool call, then lists every tool, error code, flag and limit.

## What it is, and what it is not

- It is a separate program that runs on your computer, started from a checkout of the CadKit application repository. It is **not** a panel inside the browser app.
- It has its own document and its own copy of the geometry kernel. It does not read the part you have open in the browser, and the browser does not show what the agent builds. There is no live link between them. (The "GUI bridge" in the project notes is a design, not a feature.)
- No tool or resource can load an existing part into the server. The agent starts from an empty document and builds everything with scripts, so none of your hand edits are involved or preserved.
- Everything on one machine shares **one** open document: there is one background process, one `daemon.json` and one port. Two assistants, or two projects, that use the server at the same time overwrite each other's work.
- Work moves between the two by file. The agent calls `export` to write a `.ckpart` file (or STEP, STL, GLB), and you open it in the app with **Open** (see [Saving and opening](../files/files.md)).
- The assistant brings its own model and key. The server never reads or stores a key.
- It uses the same script language as the Script tab (see [Scripting](scripting.md)). A part an agent builds is an ordinary feature tree.

If you only use the web app, you do not need this chapter.

## Before you start

You need three things.

1. **Node 22.**
2. **Two source trees, side by side.** The launcher runs TypeScript through the application repository's own `vite-node`, and its settings (`vite.config.ts`) point the `@ck/*` imports at the kernel's packages. So you need both:
   - the **application repository** (it contains `apps/cad` and `packages/mcp`), and
   - the **kernel repository**, checked out in the same parent folder and named `kernel`, like this:

     ```text
     work/
       app/       the application repository
       kernel/    the kernel repository
     ```

     If the kernel checkout has another name or place, set the environment variable `CK_REBUILD` to its absolute path (in the client configuration, next to `CK_WASM`).

   Then run `npm install` in the application repository:

   ```sh
   cd work/app
   npm install
   ```
3. **The kernel binary** (`ck_wasm.wasm`). It is not stored in the repository. Get it in one of two ways:
   - Download the one the published app uses. The site serves it at `/cad/kernel/ck_wasm.wasm`:

     ```sh
     curl -o ck_wasm.wasm https://civilkit.io/cad/kernel/ck_wasm.wasm
     ```

     This build loads in the launcher and runs scripts.
   - Or build it from the kernel repository with `cargo build -p ck-wasm --target wasm32-unknown-unknown --profile fast`. See [the kernel guide](/docs/cad/kernel/getting-started/build.html).

Then tell the server where the binary is, in one of two ways:

- Set the environment variable `CK_WASM` to its absolute path (the client configurations below do this), or pass `--wasm PATH`.
- Or copy it to `apps/cad/public/kernel/ck_wasm.wasm` inside the checkout, which is the default place the server looks.

In the commands below, replace `<checkout>` with the absolute path of the application repository and `<wasm>` with the absolute path of the `.wasm` file.

## Connect a client

### Claude Code

```sh
claude mcp add ck-cad -e CK_WASM=<wasm> -- node <checkout>/packages/mcp/bin/ck-mcp.mjs
```

To share the setup with a project instead, put this in a `.mcp.json` file at the project root:

```json
{
  "mcpServers": {
    "ck-cad": {
      "command": "node",
      "args": ["<checkout>/packages/mcp/bin/ck-mcp.mjs"],
      "env": { "CK_WASM": "<wasm>" }
    }
  }
}
```

### Cursor

Put the same JSON in `.cursor/mcp.json` in a project, or in `~/.cursor/mcp.json` to use it everywhere. Restart Cursor or reload its MCP settings.

### Claude Desktop

Add the same `mcpServers` entry to `claude_desktop_config.json`, merging it with anything already there:

| System | File |
| --- | --- |
| macOS | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Windows | `%APPDATA%\Claude\claude_desktop_config.json` |

Restart Claude Desktop after editing. Use the **absolute path** of `node` as `command` (for example the output of `which node` on macOS), because desktop apps often do not see the `PATH` of your shell.

### Codex

Append this to `~/.codex/config.toml`:

```toml
[mcp_servers.ck-cad]
command = "node"
args = ["<checkout>/packages/mcp/bin/ck-mcp.mjs"]
env = { CK_WASM = "<wasm>" }
```

On Windows, write paths with forward slashes or doubled backslashes in JSON and TOML.

## Check that it works

1. **List the servers.** In Claude Code, run `claude mcp list`. `ck-cad` should be listed and connected.
2. **Check the background process.** The first tool call starts a shared background process, which can take a few seconds (the launcher waits up to 40 seconds). Then run:

   ```sh
   node <checkout>/packages/mcp/bin/ck-mcp.mjs --status
   ```

   It prints JSON such as `{"running":true,"port":53124,"pid":4242}`. It prints `{"running":false}` when no process is running, which is normal before the first call or after it has idled out. `--stop` stops it.
3. **Make a first call.** Ask your assistant: "Use ck-cad to build an 80 by 50 plate, 12 mm thick, and report its volume." The assistant calls `run_script`. If you want to see the protocol itself, this is what a client sends and what the server answers. You can try it without any client: put the lines below in a file `msgs.jsonl` and run

   ```sh
   CK_WASM=<wasm> node <checkout>/packages/mcp/bin/ck-mcp.mjs --stdio-direct < msgs.jsonl
   ```

   The replies print one per line. The process exits when its input ends.

### A first call, as JSON-RPC

The messages below are one per line. A client sends `initialize`, then `notifications/initialized`, then calls.

```json
{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}
{"jsonrpc":"2.0","method":"notifications/initialized"}
{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"run_script","arguments":{"mode":"new","code":"part('Plate').sketch('front', (s) => s.rect(80, 50)).extrude(12)"}}}
```

The reply to `run_script` has two text blocks. The first is a one-line summary, and the second is the JSON result (shortened here):

```text
script#1 (new) built 2 features, volume 48000
```

```json
{ "ok": true, "run": "script#1", "mode": "new", "errors": [], "warnings": [],
  "created": ["F1", "F2"], "removed": [], "regenMs": 21, "featureCount": 2, "solids": 1,
  "volume": 48000, "area": 11120, "centerOfMass": [0, 0, 6],
  "bbox": { "min": [-40, -25, 0], "max": [40, 25, 12], "size": [80, 50, 12] },
  "faceCount": 6, "edgeCount": 12, "validity": { "ok": true, "issues": [] } }
```

The volume is 80 x 50 x 12 = 48000, as it should be. Now `facts` (no arguments) and `tree`:

```json
{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"facts","arguments":{}}}
{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"tree","arguments":{}}}
```

`facts` returns `featureCount`, `solids`, `volume` (48000), `area` (11120), `centerOfMass`, `bbox`, `faceCount` (6), `edgeCount` (12), and `validity` (`ok: true`). `tree` returns:

```json
{ "name": "Plate", "featureCount": 2, "handMade": 0,
  "features": [
    { "index": 0, "id": "F1", "type": "sketch", "name": null, "origin": "script#1",
      "params": { "plane": { "kind": "std", "id": "front" }, "points": "5 items", "entities": "4 items", "constraints": "0 items" } },
    { "index": 1, "id": "F2", "type": "extrude", "name": null, "origin": "script#1",
      "params": { "op": "add", "sketch": "F1", "end": "blind", "depth": 12 } } ],
  "errorCount": 0 }
```

To keep the part, call `export` with `format: "ckpart"` and a `path`, then open the file in the app.

## The tools

An agent changes the model with one tool, `run_script`. Everything else reads, proves, shows or documents. Tool calls run one at a time. Every input is checked against its schema, and unknown fields are refused.

| Tool | Arguments | What it returns |
| --- | --- | --- |
| `run_script` | `code` (required, up to 40,000 characters), `mode` (required: `new` or `attach`), `name?` (part name for `new`), `replace?` (`last`, `all` or `none`; attach only, default `last`) | The result shown above: `ok`, `run`, `mode`, `errors`, `warnings`, `created` and `removed` feature ids, `regenMs`, and a summary of the part. |
| `tree` | none | The feature list in order: id, type, name, origin (`script#N`) and key parameters, with any errors and hints. |
| `find` | `query` (required) | Features, face names and edge names that match the text. |
| `inspect` | `id` (required) | One feature in full, the faces and edges it created, what depends on it, and its error if any. |
| `facts` | `expect?`: list of checks such as `[{"kind":"volume","value":1200,"tol":0.01},{"kind":"valid"}]` | Mass properties, bounding box, counts and validity, plus a pass or fail per check. |
| `probe` | `points?`: list of `[x,y,z]`; `rays?`: list of `{origin, dir}` | Per point: inside, outside or boundary, with the signed distance and nearest face. Per ray: the hits with face names. |
| `section` | `plane` (required: `{origin?, normal}`), `detail?` (boolean) | The exact cross-section loops, their areas and the plane frame. `detail: true` adds the polyline points. |
| `sections` | `axis` (required: `x`, `y` or `z`), `n?` (1 to 200), `positions?` | Areas of several slices and the volume they add up to, compared with the exact volume. |
| `snapshot` | `view?`, `up?`, `size?` (64 to 2048), `style?`, `projection?` (`ortho` or `perspective`), `section?`, `sheet?`, `highlight?`, `markers?`, `frame?`, `annotate?`, `background?` | A PNG image plus a short text summary (view, size, bytes). |
| `checkpoint` | `name` (required) | Saves the whole document under a name. At most 20 are kept in memory; the oldest goes. |
| `restore` | `name` (required) | Replaces the document with a checkpoint. Notes are not restored. It can be undone. |
| `checkpoints` | none | Lists the saved checkpoints. |
| `notes` | `text?`, `append?` | Reads the scratch notes, or replaces them with `text`, or adds to them with `append: true`. Notes survive restore and undo. |
| `list_methods` | `query?` | Searches the registered script methods. With no query it returns the guide, all methods with signatures, and the recipes. |
| `docs` | `names` (required, 1 to 30) | Full entries (signature, summary, example) for methods, or the code of recipes by id. Unknown names are reported as `unknown`. |
| `undo`, `redo` | none | Step through the document history (50 states). |
| `ask_user` | `question` (required), `options?` | A "needs user input" result. MCP has no screen of its own, so the agent should ask in its reply. |
| `export` | `format` (required: `step`, `stl`, `glb` or `ckpart`), `path?` | Writes the file and returns the path and size. Without `path`, it writes `./<part name>.<extension>` in the **server's working directory**. The server is one shared process per machine, so that is the folder of whichever client started it first, not necessarily where you are working. Always pass an absolute `path`. |

### Attach mode

In `attach` mode the script's features are added to the features already in the server's document, which can only come from earlier scripts, since nothing can load your own part. Each feature a script makes carries an `origin` mark such as `script#2`. By default a re-run first removes the features of the previous script run, so a corrected script does not duplicate its output; `replace: "all"` removes every script's features and `replace: "none"` only adds. If a later feature depends on one that would be replaced, the run is refused and names it. `tree` reports `handMade`, which is always 0 here. Runs are all-or-nothing: a script with an error leaves the document as it was.

### What `list_methods` and `docs` cover

The registry behind `list_methods` and `docs` is a small core set of about thirty entries: `part`, `variables`, `expr`, `face`, `edges`, `at`, `through`, `sketch`, `extrude`, `cut`, `revolve`, `thin`, `hole`, `holes.*`, `fillet`, `chamfer`, `shell`, `linearPattern`, `circularPattern` and the basic sketch builder methods. The script language itself has many more methods, such as `loft`, `sweep`, `mirror`, `gear`, `thread`, surfaces and assemblies (see [Scripting](scripting.md)). These work in `run_script`, but the registry does not describe them: `list_methods {"query":"loft"}` returns no methods, and `docs {"names":["loft"]}` answers "unknown". An agent that knows the method can still use it; for example this builds a valid solid:

```js
part('L').loft([{ on: at('front', 0), draw: (s) => s.rect(20, 20) }, { on: at('front', 30), draw: (s) => s.circle(6) }])
```

Point your assistant at [Scripting](scripting.md) or give it the method names directly when you want these.

## Resources

Besides tools, the server offers read-only resources:

| URI | Content |
| --- | --- |
| `ck://docs/guide` | How the script API works and the build-check loop. |
| `ck://docs/methods` | The registered methods with signatures and summaries. |
| `ck://recipes/<id>` | A complete example script. The ids are `bracket`, `flange`, `box`, `bc-pulley`, `bc-washer`, `bc-hex-nut`, `bc-enclosure`, `bc-motor-end-cap`, `pickleball` and `speedboat-dash`. |
| `ck://document` | The open part as JSON. |
| `ck://notes` | The scratch notes. |

## Errors

A failed tool call returns `isError: true` and a JSON body `{"ok": false, "error": {"code", "message", "hint"}}`. A script that fails reports its errors inside the `run_script` result. The `line` is given for runtime errors. A syntax error, or an error found only when the finished document is rebuilt, has `"line": 0`, which means no line is known. For example `this is not js` returns `{"line":0,"message":"Unexpected identifier 'is'"}`.

| Code | Meaning |
| --- | --- |
| `bad_input` | An argument is missing, has the wrong type, or is unknown. The message names the field. |
| `unknown_tool` | No tool has that name. The hint lists the tools. |
| `no_such_feature` | `inspect` or a similar call named a feature that does not exist. |
| `no_such_checkpoint` | `restore` named a checkpoint that was not saved. |
| `nothing_to_undo`, `nothing_to_redo` | The history has nothing in that direction. |
| `no_body` | Only `export` raises it: the document has no solid to export. |
| `snapshot_unavailable` | The snapshot renderer is not available. The checkout includes it, so you only see this in a build without it. |
| `snapshot_failed` | The renderer returned no image. Try another view or a smaller size. |
| `script_crash` | The script runner failed unexpectedly. |
| `internal_error` | The kernel or the tool failed unexpectedly. Retry, or restore a checkpoint. |

Protocol-level errors use JSON-RPC codes: `-32700` (parse error), `-32600` (invalid request; a message that has an id but no method is treated as a client reply and ignored), `-32601` (method not found), `-32602` (invalid parameters), `-32603` (internal error) and `-32002` (resource not found).

Tool output is capped at about 48,000 characters. Long lists are cut with a "more items" marker.

## Flags and environment

Pass flags after `ck-mcp.mjs`. In a client configuration they go in the `args` array, for example `"args": ["<checkout>/packages/mcp/bin/ck-mcp.mjs", "--idle-seconds", "600"]`.

| Flag | What it does |
| --- | --- |
| (none) | Normal mode. Connects to the shared background process, starting it if needed. |
| `--stdio-direct` | No background process: the kernel lives inside this one, and its state ends with the client. Useful for tests and simple setups. |
| `--daemon` | Run the background process in the foreground. |
| `--status`, `--stop` | Report on, or stop, the background process. |
| `--idle-seconds N` | The background process exits after N idle seconds (default 1800). |
| `--wasm PATH` | The kernel binary to use. |
| `--allow-origin URL[,URL]` | Let a specific web page call the process (for a future browser link). Off by default. |

| Variable | What it does |
| --- | --- |
| `CK_WASM` | Path of the kernel binary, if `--wasm` is not given. |
| `CK_MCP_HOME` | The state folder (default `~/.ck-cad`). |
| `CK_MCP_IDLE_SECONDS` | The idle time, if `--idle-seconds` is not given. |

The state folder is created with mode 0700. Inside it, `daemon.json` (mode 0600) holds the port, process id and token of the running process. Only protocol messages go to the client's standard output.

## Security

- The background process listens on `127.0.0.1` only, on a random port.
- Every request must carry a 256-bit random token, made at start and held in `daemon.json`, as an `Authorization: Bearer` header.
- The `Host` header must be `127.0.0.1` or `localhost` with the right port, which blocks DNS rebinding.
- Any request with an `Origin` header is refused unless you listed that origin with `--allow-origin`. A web page always sends one, so a page cannot reach the process by guessing the port.
- Any other program running as your user can read `daemon.json`. Treat the process as trusted by that user.
- Scripts run in a restricted environment that stops accidents. It is **not** a security boundary. Do not run scripts you do not trust.

## Limits

- One document per process. `run_script` with `mode: "new"` replaces it; `undo` brings it back.
- Checkpoints (20) and history (50 states) are in memory and end when the process stops.
- The process exits after its idle time (30 minutes by default). The next call starts a new one, with an empty document.
- The first start takes a few seconds. Later starts are fast.
- Script sketches have no constraints.
- GLB export writes flat-shaded triangles. GLB is available only through this server, not the app's Export menu.
- The server is a developer tool, started from a checkout. It is not installed from the app.

## Next

- [Scripting](scripting.md)
- [The local kernel service](local-kernel.md)
- [Saving and opening](../files/files.md)
- [Exporting](../files/export.md)
