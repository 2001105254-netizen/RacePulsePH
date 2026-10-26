const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const project = 'demo-racepulseph';
const secretFile = path.join(root, 'functions/.secret.local');
const npxCli = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npx-cli.js');
const children = [];
let stopping = false;

function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children.reverse()) {
    if (process.platform === 'win32' && child.pid) {
      // Stop only processes started by this launcher, including emulator JVMs.
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    } else {
      child.kill('SIGTERM');
    }
  }
  process.exitCode = code;
}

async function main() {
  if (!fs.existsSync(secretFile)) throw new Error('Create the private functions/.secret.local file with SMTP_APP_PASSWORD and AUTH_CODE_SECRET first.');
  if (!fs.existsSync(npxCli)) throw new Error('The Node.js bundled npx launcher is unavailable. Install Node.js with npm to run local emulators.');
  const secrets = fs.readFileSync(secretFile, 'utf8');
  for (const key of ['SMTP_APP_PASSWORD', 'AUTH_CODE_SECRET']) {
    if (!new RegExp(`^${key}=.+$`, 'm').test(secrets)) throw new Error(`The private secret file is missing ${key}.`);
  }
  // The shared Functions entry point also exports payments. Supply inert local
  // values so emulator startup never tries to fetch payment secrets from cloud.
  const missing = ['PAYMONGO_SECRET_KEY', 'PAYMONGO_WEBHOOK_SECRET'].filter((key) => !new RegExp(`^${key}=`, 'm').test(secrets));
  if (missing.length) fs.appendFileSync(secretFile, `\n${missing.map((key) => `${key}=local-test-only`).join('\n')}\n`);
  const env = {
    ...process.env,
    VITE_USE_FIREBASE_EMULATORS: 'true',
    DISABLE_HMR: 'true',
    GCLOUD_PROJECT: project,
    GOOGLE_CLOUD_PROJECT: project,
    FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9099',
    FIRESTORE_EMULATOR_HOST: '127.0.0.1:8080',
    FIREBASE_CLI_DISABLE_UPDATE_CHECK: 'true',
  };
  const emulator = spawn(process.execPath, [npxCli, '--yes', 'firebase-tools@15.34.1', 'emulators:start', '--config', 'firebase.local.json', '--project', project, '--only', 'auth,firestore,functions'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
  children.push(emulator);
  emulator.on('error', () => { console.error('Could not start the local Firebase emulators.'); stop(1); });
  emulator.on('exit', (code) => { if (!stopping) stop(code || 0); });
  console.log('Starting local Firebase accounts and data. SMTP will deliver real codes to the email entered.');
  const deadline = Date.now() + 5 * 60 * 1000;
  while (!stopping && Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:5001/${project}/asia-southeast1/accountApi`, { method: 'HEAD', signal: AbortSignal.timeout(1000) });
      if (response.status === 405) {
        const web = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'server.ts'], { cwd: root, env, stdio: 'inherit', windowsHide: true });
        children.push(web);
        web.on('error', () => { console.error('Could not start the local web app.'); stop(1); });
        web.on('exit', (code) => { if (!stopping) stop(code || 0); });
        console.log('Local account preview: http://127.0.0.1:3000/?register=local-test');
        return;
      }
    } catch { /* Wait for startup/downloads; never fall back to a cloud API. */ }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!stopping) throw new Error('Local Firebase startup timed out. Check the emulator output above.');
}

process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
main().catch((error) => { console.error(error.message); stop(1); });
