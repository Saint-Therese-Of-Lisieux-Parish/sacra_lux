// Decoded size limit for one uploaded media file. The Electron pickers and the
// HTTP upload routes share it so a picked file is never rejected after it is read.
const MAX_SINGLE_UPLOAD_BYTES = 140 * 1024 * 1024;
const IMAGE_ASSET_EXTENSIONS = Object.freeze(["jpg", "jpeg", "png", "gif", "webp", "svg", "avif"]);

module.exports = { IMAGE_ASSET_EXTENSIONS, MAX_SINGLE_UPLOAD_BYTES };
