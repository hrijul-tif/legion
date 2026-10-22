/**
 * npm run bifrost:setup
 *
 * Prepares the optional Bifrost runner:
 *   1. copies $MOS_FRAMEWORK_PATH to runner/.work/mos-framework (the original repo is never touched)
 *   2. creates runner/.venv with uv (Python 3.12 is managed by uv) and installs the pinned runtime deps
 *   3. installs the copy in editable mode so `import framework` works there (generated jtyu files appear in place)
 */
import { existsSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { FRAMEWORK_COPY, RUNNER, WORK, hasUv, need, sh } from "./bifrost-env";

if (!hasUv()) {
  console.error("uv is not installed. Install it with `brew install uv` (or see https://docs.astral.sh/uv/), then re-run.");
  process.exit(1);
}
const src = need("MOS_FRAMEWORK_PATH").replace(/\/+$/, "");
if (!existsSync(`${src}/framework/mdb/super_class.py`)) {
  console.error(`MOS_FRAMEWORK_PATH=${src} does not look like a mos-framework checkout (framework/mdb/super_class.py missing).`);
  process.exit(1);
}

mkdirSync(WORK, { recursive: true });
console.log(`-> copying ${src} to ${FRAMEWORK_COPY}`);
// --delete keeps the copy identical to the source, but keeps files the generator wrote under framework/jtyu
sh("rsync", ["-a", "--delete", "--exclude", ".git", "--exclude", "__pycache__", "--exclude", "*.pyc", "--exclude", "/framework/jtyu", "--exclude", ".env", `${src}/`, `${FRAMEWORK_COPY}/`]);

console.log("-> uv sync (Python 3.12 + pinned deps)");
sh("uv", ["sync", "--project", RUNNER]);

console.log("-> installing the framework copy (editable, no deps)");
sh("uv", ["pip", "install", "--python", `${RUNNER}/.venv/bin/python`, "--no-deps", "-e", FRAMEWORK_COPY]);

console.log("-> smoke test: import framework.mdb.super_class");
sh(`${RUNNER}/.venv/bin/python`, ["-c", "import os; os.environ.update(ENVIRONMENT='x',MISSION='jtyu',INSTANCE='jtyu',YAMCS_URL='x',YAMCS_USERNAME='',YAMCS_PASSWORD='',WDS_ENDPOINT='',WDS_PORT='',SLACK_BOT_TOKEN=''); import tempfile; os.chdir(tempfile.mkdtemp()); import framework.mdb.super_class as s; print('framework OK', s.SuperCommand.__name__)"]);
console.log("\nRunner ready. Next: npm run bifrost:gen-mdb  (needs a RUNNING Bifrost simulation)");
