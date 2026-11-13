import { t, uploadDir } from "./constants.mjs";

const IMAGE_EXT = /\.(apng|avif|bmp|gif|jpe?g|png|svg|tiff?|webp)$/i;

/** Is this File an image we can pin? */
export function isImageFile(file) {
  return !!file && (file.type?.startsWith("image/") || IMAGE_EXT.test(file.name ?? ""));
}

/** Is this File a PDF (pinned as a document)? */
export function isPdfFile(file) {
  return !!file && ((file.type === "application/pdf") || /\.pdf$/i.test(file.name ?? ""));
}

/** Evidence files: images and PDFs. */
export const isEvidenceFile = file => isImageFile(file) || isPdfFile(file);

export const canUpload = (user = game.user) => user.can("FILES_UPLOAD");
export const canBrowse = (user = game.user) => user.can("FILES_BROWSE");

let dirReady = null;

/** Create the upload folder once per session. An "already exists" failure is fine. */
function ensureDir() {
  dirReady ??= (async () => {
    const FP = foundry.applications.apps.FilePicker.implementation;
    const parts = uploadDir().split("/");
    // worlds/<id> exists already; create each level below it.
    for ( let i = 3; i <= parts.length; i++ ) {
      try {
        await FP.createDirectory("data", parts.slice(0, i).join("/"));
      } catch(err) {
        if ( !/EEXIST|already exists/i.test(err?.message ?? "") ) console.debug("dimancer_board | createDirectory", err);
      }
    }
  })();
  return dirReady;
}

/** A filesystem-safe, collision-free name for an uploaded file. */
function uploadName(file) {
  const ext = (file.name?.match(/\.[a-z0-9]+$/i)?.[0] ?? `.${(file.type?.split("/")[1] ?? "png").replace("jpeg", "jpg")}`).toLowerCase();
  const base = (file.name ?? "evidence").replace(/\.[^.]+$/, "").slugify({ strict: true }).slice(0, 40) || "evidence";
  return `${base}-${foundry.utils.randomID(6)}${ext}`;
}

/**
 * Upload an image or a PDF into the world's evidence folder.
 * @param {File|Blob} file
 * @returns {Promise<string|null>}  The stored path, or null (the user has been told why)
 */
export async function uploadFile(file) {
  if ( !canUpload() ) {
    ui.notifications.warn(t("Notify.NoUpload"));
    return null;
  }
  await ensureDir();
  const named = new File([file], uploadName(file), { type: file.type || "image/png" });
  const FP = foundry.applications.apps.FilePicker.implementation;
  const response = await FP.upload("data", uploadDir(), named, {}, { notify: false });
  if ( !response?.path ) {
    ui.notifications.error(t("Notify.UploadFailed"));
    return null;
  }
  return response.path;
}

/**
 * The natural size of an image, or null if it can't be loaded.
 * Uses a plain <img>, which (unlike a WebGL texture) doesn't need CORS for remote URLs.
 * @returns {Promise<{width: number, height: number}|null>}
 */
export function imageSize(src) {
  return new Promise(resolve => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve(null);
    img.src = src;
  });
}
