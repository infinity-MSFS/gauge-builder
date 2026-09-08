/** Byte/data-URL helpers shared by the reference-image loader and project I/O. */

export function bytesToDataURL(bytes: Uint8Array, mime: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return `data:${mime};base64,${btoa(binary)}`;
}

export function mimeFromExt(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase() ?? "";
  switch (ext) {
    case "png":  return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "webp": return "image/webp";
    case "bmp":  return "image/bmp";
    case "gif":  return "image/gif";
    case "svg":  return "image/svg+xml";
    default:     return "image/png";
  }
}

/** Strip the `data:<mime>;base64,` prefix, leaving the raw base64 payload. */
export function base64FromDataURL(dataURL: string): string {
  const comma = dataURL.indexOf(",");
  return comma === -1 ? dataURL : dataURL.slice(comma + 1);
}

export function fileNameOf(path: string): string {
  return path.replace(/\\/g, "/").split("/").pop() ?? "reference.png";
}
