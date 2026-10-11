const SEMVER_PATTERN = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(version) {
  const match = SEMVER_PATTERN.exec(String(version).trim());

  if (!match) {
    return null;
  }

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : []
  };
}

function comparePrerelease(left, right) {
  if (left.length === 0 && right.length === 0) {
    return 0;
  }
  if (left.length === 0) {
    return 1;
  }
  if (right.length === 0) {
    return -1;
  }

  const length = Math.max(left.length, right.length);

  for (let index = 0; index < length; index += 1) {
    const a = left[index];
    const b = right[index];

    if (a === undefined) {
      return -1;
    }
    if (b === undefined) {
      return 1;
    }
    if (a === b) {
      continue;
    }

    const aNumeric = /^\d+$/.test(a);
    const bNumeric = /^\d+$/.test(b);

    if (aNumeric && bNumeric) {
      return Number(a) > Number(b) ? 1 : -1;
    }
    if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    }

    return a > b ? 1 : -1;
  }

  return 0;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (!left || !right) {
    throw new Error(`Invalid semantic version: ${!left ? a : b}`);
  }

  if (left.major !== right.major) {
    return left.major > right.major ? 1 : -1;
  }
  if (left.minor !== right.minor) {
    return left.minor > right.minor ? 1 : -1;
  }
  if (left.patch !== right.patch) {
    return left.patch > right.patch ? 1 : -1;
  }

  return comparePrerelease(left.prerelease, right.prerelease);
}

if (require.main === module) {
  const [prVersion, baseVersion] = process.argv.slice(2);

  if (!prVersion || !baseVersion) {
    console.error("Usage: node check-version-bump.js <pr-version> <base-version>");
    process.exit(1);
  }

  console.log(`PR version:   ${prVersion}`);
  console.log(`Base version: ${baseVersion}`);

  try {
    if (compareVersions(prVersion, baseVersion) > 0) {
      console.log("Version bump is valid.");
      process.exit(0);
    }

    console.error(
      `::error::Version in sacra-lux/package.json must be greater than the base branch. PR=${prVersion} base=${baseVersion}`
    );
    process.exit(1);
  } catch (error) {
    console.error(`::error::${error.message}`);
    process.exit(1);
  }
}

module.exports = { parseVersion, compareVersions };
