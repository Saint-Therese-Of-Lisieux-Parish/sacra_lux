const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageLockPath = path.join(__dirname, '..', 'package-lock.json');
const repoRoot = path.join(__dirname, '..', '..');

// Documentation fields that must show the current package version.
const DOC_VERSION_FIELDS = [
  { file: 'README.md', pattern: /^The current package version is `([^`]+)`\./m },
  { file: path.join('docs', 'codebase_info.md'), pattern: /^- version: `([^`]+)`/m }
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// Return an error message for each doc field that is missing or differs from the package version.
function findDocVersionErrors(packageVersion, rootDir = repoRoot) {
  const errors = [];
  for (const { file, pattern } of DOC_VERSION_FIELDS) {
    const text = fs.readFileSync(path.join(rootDir, file), 'utf8');
    const match = pattern.exec(text);
    if (!match) {
      errors.push(`${file}: current-version field not found`);
    } else if (match[1] !== packageVersion) {
      errors.push(`${file}: documents ${match[1]}, package.json=${packageVersion}`);
    }
  }
  return errors;
}

function main() {
  const packageJson = readJson(packageJsonPath);
  const packageLock = readJson(packageLockPath);
  const packageVersion = packageJson.version;
  const lockVersion = packageLock.version;
  const rootLockVersion = packageLock.packages && packageLock.packages[''] && packageLock.packages[''].version;

  if (!packageVersion || !lockVersion || !rootLockVersion) {
    console.error('Version sync check could not read all required version fields.');
    process.exit(1);
  }

  if (packageVersion !== lockVersion || packageVersion !== rootLockVersion) {
    console.error(
      `Version mismatch: package.json=${packageVersion}, package-lock.json=${lockVersion}, package-lock root=${rootLockVersion}`
    );
    process.exit(1);
  }

  const docErrors = findDocVersionErrors(packageVersion);
  if (docErrors.length > 0) {
    console.error(`Documentation version mismatch:\n${docErrors.map((error) => `- ${error}`).join('\n')}`);
    process.exit(1);
  }

  console.log(`Version sync OK: ${packageVersion}`);
}

if (require.main === module) {
  main();
}

module.exports = { findDocVersionErrors };
