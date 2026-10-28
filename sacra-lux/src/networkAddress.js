const os = require("os");
const { execFileSync } = require("child_process");

function listIpv4Addresses(networkInterfaces = os.networkInterfaces()) {
  const addresses = [];
  for (const [interfaceName, entries] of Object.entries(networkInterfaces || {})) {
    for (const info of entries || []) {
      if (info.family === "IPv4" && !info.internal) addresses.push({ interfaceName, address: info.address });
    }
  }
  return addresses;
}

function getDefaultInterfaceName({ platform = process.platform, exec = execFileSync } = {}) {
  try {
    const command = platform === "darwin" ? "route" : "ip";
    const args = platform === "darwin" ? ["-n", "get", "default"] : ["route", "show", "default"];
    const output = String(exec(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }));
    if (platform === "darwin") {
      const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith("interface:"));
      return line?.trim().split(/\s+/)[1] || null;
    }
    const line = output.split(/\r?\n/).find((entry) => entry.trim().startsWith("default"));
    const parts = line?.trim().split(/\s+/) || [];
    const deviceIndex = parts.indexOf("dev");
    return deviceIndex >= 0 ? parts[deviceIndex + 1] || null : null;
  } catch {
    return null;
  }
}

function getPreferredIpv4Address({
  selectedAddress = "",
  networkInterfaces = os.networkInterfaces(),
  defaultInterfaceName = getDefaultInterfaceName()
} = {}) {
  const addresses = listIpv4Addresses(networkInterfaces);
  const selected = addresses.find((entry) => entry.address === selectedAddress);
  if (selected) return selected.address;
  const defaultAddress = addresses.find((entry) => entry.interfaceName === defaultInterfaceName);
  return defaultAddress?.address || addresses[0]?.address || "localhost";
}

module.exports = { getDefaultInterfaceName, getPreferredIpv4Address, listIpv4Addresses };
