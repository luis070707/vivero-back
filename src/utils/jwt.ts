//jwt.ts

// Aquí uso la librería jsonwebtoken para firmar y verificar mis tokens
import jwt, { type SignOptions } from "jsonwebtoken";

// Saco la clave secreta de las variables de entorno.
// Si por alguna razón no existe, uso este valor por defecto (solo para desarrollo).
const JWT_SECRET = process.env.JWT_SECRET || "d1c0f895f130bcd27eb8605b897ac761cbc9f6848d02db929e5a0345b1418d7cd527fe7e9705450022c29c75c7b7469f0e";

// Con esta función genero un token JWT a partir de un payload
// y unas opciones opcionales (como el tiempo de expiración).
export function signToken(payload: object, opts: SignOptions = {}): string {
  return jwt.sign(payload, JWT_SECRET, opts);
}

/** Verifica un token y devuelve el payload tipado o null */
// Aquí intento verificar un token; si todo está bien devuelvo el payload,
// si algo falla (token inválido, expirado, etc.) devuelvo null.
export function verifyToken<T = any>(token: string): T | null {
  try {
    return jwt.verify(token, JWT_SECRET) as T;
  } catch {
    return null;
  }
}
