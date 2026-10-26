function sanitizePdfFileName(value, fallback) {
  const cleaned = String(value || "")
    .replace(/[<>:"/\\|?*\p{Cc}]/gu, "")
    .trim();
  return cleaned || fallback;
}

module.exports = { sanitizePdfFileName };
