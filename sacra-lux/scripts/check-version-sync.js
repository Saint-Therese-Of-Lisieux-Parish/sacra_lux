const fs = require('fs');
const path = require('path');

const packageJsonPath = path.join(__dirname, '..', 'package.json');
const packageLockPath = path.join(__dirname, '..', 'package-lock.json');

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

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

console.log(`Version sync OK: ${packageVersion}`);
