const { spawnSync } = require('child_process');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const appRoot = path.resolve(__dirname, '..');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd || repoRoot,
    stdio: 'inherit'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }
}

function getStagedFiles() {
  const result = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR'], {
    cwd: repoRoot,
    encoding: 'utf8'
  });

  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  return result.stdout
    .split('\n')
    .map((file) => file.trim())
    .filter(Boolean);
}

const stagedFiles = getStagedFiles();
const jsFiles = stagedFiles.filter((file) =>
  /^sacra-lux\/(src|tests|scripts)\/.+\.js$/.test(file) || file === 'sacra-lux/eslint.config.js'
);
const versionFilesTouched = stagedFiles.some(
  (file) => file === 'sacra-lux/package.json' || file === 'sacra-lux/package-lock.json'
);

if (jsFiles.length > 0) {
  console.log(`Linting staged JS files (${jsFiles.length})...`);
  const eslintArgs = ['eslint', '--max-warnings=0', ...jsFiles.map((file) => path.relative(appRoot, path.join(repoRoot, file)))];
  run('npx', eslintArgs, { cwd: appRoot });
}

if (versionFilesTouched) {
  console.log('Checking package version sync...');
  run('npm', ['run', 'check:version-sync'], { cwd: appRoot });
}
