const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');

const repoRoot = path.join(__dirname, '..', '..');
const SOURCE_NAME = 'Sacra Lux Default Background HD.png';
const OUTPUT_NAME = 'default-text-background.avif';

// Clone the source PNG, convert the clone to AVIF, and leave the source in place.
async function buildDefaultBackground({
  sourcePath = path.join(repoRoot, SOURCE_NAME),
  outputPath = path.join(__dirname, '..', 'public', 'assets', OUTPUT_NAME)
} = {}) {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`Source image not found: ${sourcePath}`);
  }
  const cloneDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sacra-lux-bg-'));
  const clonePath = path.join(cloneDir, path.basename(sourcePath));
  try {
    fs.copyFileSync(sourcePath, clonePath);
    await sharp(clonePath).avif().toFile(outputPath);
  } finally {
    fs.rmSync(cloneDir, { recursive: true, force: true });
  }
  return outputPath;
}

if (require.main === module) {
  // Optional first argument: path to the source PNG (the file is local-only and git-ignored).
  buildDefaultBackground(process.argv[2] ? { sourcePath: path.resolve(process.argv[2]) } : {})
    .then((out) => console.log(`Wrote ${out}`))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}

module.exports = { buildDefaultBackground, SOURCE_NAME, OUTPUT_NAME };
