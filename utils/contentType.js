/**
 * Map file extensions to MIME types so S3 serves correct Content-Type
 * (browser preview breaks when objects are application/octet-stream).
 */
function contentTypeForFileName(name) {
  if (!name || typeof name !== "string") return "application/octet-stream";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  const map = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    jfif: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    ico: "image/x-icon",
    tif: "image/tiff",
    tiff: "image/tiff",
    pdf: "application/pdf",
    txt: "text/plain; charset=utf-8",
    csv: "text/csv; charset=utf-8",
    json: "application/json",
    html: "text/html; charset=utf-8",
    htm: "text/html; charset=utf-8",
    css: "text/css",
    js: "text/javascript",
    mjs: "text/javascript",
    md: "text/markdown; charset=utf-8",
    xml: "application/xml",
    mp4: "video/mp4",
    webm: "video/webm",
    ogv: "video/ogg",
    mp3: "audio/mpeg",
    wav: "audio/wav",
    ogg: "audio/ogg",
    m4a: "audio/mp4",
    aac: "audio/aac",
    flac: "audio/flac"
  };
  return map[ext] || "application/octet-stream";
}

function resolveUploadContentType(originalname, multerMimetype) {
  if (multerMimetype && multerMimetype !== "application/octet-stream") {
    return multerMimetype;
  }
  return contentTypeForFileName(originalname);
}

module.exports = { contentTypeForFileName, resolveUploadContentType };
