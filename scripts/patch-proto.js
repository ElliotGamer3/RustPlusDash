/**
 * Patches applied after npm install:
 *
 * 1. rustplus.proto — makes all SellOrder fields optional.
 *    The Rust game server omits fields like itemIsBlueprint and amountInStock
 *    for some vending machines, but the upstream proto marks them `required`.
 *    protobufjs throws a ProtocolError on any absent required field.
 *
 * 2. rustplus.js — wraps AppMessage.decode() in a try/catch so a single bad
 *    message cannot crash the Node process. The partial decoded instance is
 *    appended to proto-decode-errors.jsonl for debugging.
 */
const fs = require("fs");
const path = require("path");

const protoPath = path.resolve(
    __dirname,
    "../node_modules/@liamcottle/rustplus.js/rustplus.proto",
);

const rustplusJsPath = path.resolve(
    __dirname,
    "../node_modules/@liamcottle/rustplus.js/rustplus.js",
);

if (!fs.existsSync(protoPath) || !fs.existsSync(rustplusJsPath)) {
    console.warn("[patch-proto] rustplus files not found, skipping patch.");
    process.exit(0);
}

let src = fs.readFileSync(protoPath, "utf8");

const before = src;

// Make all fields in SellOrder optional — the Rust game server omits various
// fields depending on the vending machine state. We scope the replacement to
// the SellOrder block to avoid touching fields in other messages.

const toPatch = ["SellOrder", "AppInfo"];
toPatch.forEach((messageName) => {
    const regex = new RegExp(`message ${messageName} \\{([\\s\\S]*?)\\}`, "g");
    src = src.replace(regex, (block) =>
        block.replace(
            /\brequired\b(?=\s+(int32|bool|float|string|uint32)\s)/g,
            "optional",
        ),
    );

    if (src === before) {
        console.log(`[patch-proto] Proto ${messageName} already patched, nothing to do.`);
    } else {
        fs.writeFileSync(protoPath, src, "utf8");
        console.log(
            `[patch-proto] Patched ${messageName}: all fields are now optional.`,
        );
    }
});

// ---------------------------------------------------------------------------
// Patch 2: wrap AppMessage.decode() in rustplus.js with a try/catch so that
// a single bad protobuf message cannot bring down the whole process.
// ---------------------------------------------------------------------------
let jsSrc = fs.readFileSync(rustplusJsPath, "utf8");

const PATCH_MARKER = "// [patched] proto-decode try/catch";

if (jsSrc.includes(PATCH_MARKER)) {
    console.log("[patch-proto] rustplus.js already patched, nothing to do.");
} else {
    const oldDecode =
        "            this.websocket.on('message', (data) => {\n\n                // decode received message\n                var message = this.AppMessage.decode(data);";
    const newDecode =
        "            this.websocket.on('message', (data) => { " +
        PATCH_MARKER +
        "\n\n                // decode received message\n                var message;\n                try {\n                    message = this.AppMessage.decode(data);\n                } catch (decodeErr) {\n                    if (decodeErr && decodeErr.instance !== undefined) {\n                        const _fs = require('fs'), _path = require('path');\n                        const _log = _path.resolve(__dirname, '../../proto-decode-errors.jsonl');\n                        const _entry = { timestamp: new Date().toISOString(), error: decodeErr.message, instance: decodeErr.instance };\n                        try { _fs.appendFileSync(_log, JSON.stringify(_entry) + '\\n'); } catch {}\n                        console.warn('[proto] Decode error (saved to proto-decode-errors.jsonl):', decodeErr.message);\n                    } else {\n                        console.warn('[proto] Decode error:', decodeErr && decodeErr.message);\n                    }\n                    return;\n                }";
    const oldEmit =
        "                // fire message event for received messages that aren't handled by callback\n                this.emit('message', this.AppMessage.decode(data));";
    const newEmit =
        "                // fire message event for received messages that aren't handled by callback\n                var finalMessage;\n                try { finalMessage = this.AppMessage.decode(data); } catch { return; }\n                this.emit('message', finalMessage);";

    const patched = jsSrc
        .replace(oldDecode, newDecode)
        .replace(oldEmit, newEmit);

    if (patched === jsSrc) {
        console.warn(
            "[patch-proto] rustplus.js patch markers not found — file may have changed upstream. Manual patch needed.",
        );
    } else {
        fs.writeFileSync(rustplusJsPath, patched, "utf8");
        console.log(
            "[patch-proto] Patched rustplus.js: AppMessage.decode() now has try/catch.",
        );
    }
}
