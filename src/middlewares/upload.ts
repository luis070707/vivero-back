import multer from "multer";
import path from "path";
import { v4 as uuid } from "uuid";
import mime from "mime-types";

const uploadsDir = path.resolve(__dirname, "../../uploads");

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadsDir),
  filename: (_req, file, cb) => {
    const ext =
      (mime.extension(file.mimetype) as string) ||
      path.extname(file.originalname).replace(".", "") ||
      "bin";
    cb(null, `${uuid()}.${ext}`);
  },
});

/**
 * Importante:
 * Algunos tipos de @types/multer te marcan error si pasas `Error` como primer argumento.
 * Para evitar el problema, no pasamos `Error`; guardamos el mensaje en `req.fileValidationError`
 * y devolvemos `cb(null, false)`. En la ruta verificamos `req.fileValidationError` y respondemos 400.
 */
function fileFilter(req: any, file: Express.Multer.File, cb: multer.FileFilterCallback) {
  const ok = /^image\/(jpe?g|png|webp|gif)$/i.test(file.mimetype);
  if (ok) return cb(null, true);
  req.fileValidationError = "Solo imágenes (jpg, png, webp, gif)";
  return cb(null, false);
}

export const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB
});

export const publicImageUrl = (req: import("express").Request, filename: string) =>
  `${req.protocol}://${req.get("host")}/uploads/${filename}`;
