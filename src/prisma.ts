// prisma.ts

// Importo el cliente de Prisma generado a partir de mi schema
import { PrismaClient } from "@prisma/client";

// Creo una única instancia de Prisma para toda mi app
// y activo logs solo para warnings y errores
export const prisma = new PrismaClient({
  log: ["warn", "error"] 
});
