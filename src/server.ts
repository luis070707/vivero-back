// server.ts

// Cargo variables de entorno desde .env al inicio
import "dotenv/config";

// Importo Express y middlewares que uso en el servidor
import express from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";
import fs from "fs";

// Importo mi instancia de Prisma para hablar con la base de datos
import { prisma } from "./prisma";

// Importo las rutas separadas por responsabilidad
import profileRoutes from "./routes/profile";
import authRoutes from "./routes/auth";
import wishlistRoutes from "./routes/wishlist";
import adminRoutes from "./routes/admin";
import ordersRouter from "./routes/admin.orders";
import productsRouter from "./routes/products";
import adminReportsRouter from "./routes/admin.reports";

// Creo la app de Express
const app = express();

// Defino el puerto: primero intento leerlo de .env y si no, uso 4000
const PORT = parseInt(process.env.PORT || "4000", 10);

// ====== CORS ======
// Aquí preparo CORS para permitir solo orígenes que yo decida

// 1) Tomo la lista de orígenes desde .env (CORS_ORIGIN=URL1,URL2,...)
// 2) Además dejo pasar cualquier localhost/127.0.0.1 en desarrollo
const envOrigins = (process.env.CORS_ORIGIN || "")
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

// Esta función me ayuda a detectar si el origin es un localhost cualquiera
function allowDevLocalhost(origin: string | undefined) {
  if (!origin) return true; // permito peticiones sin origin (curl, Postman, etc.)
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

// Configuro el middleware de CORS con mi lógica de orígenes permitidos
app.use(
  cors({
    origin: (origin, cb) => {
      // Si no hay origin (por ejemplo en Postman) lo dejo pasar
      if (!origin) return cb(null, true);
      // Si el origin está en la lista del .env, lo acepto
      if (envOrigins.includes(origin)) return cb(null, true);
      // Si es un localhost cualquiera, también lo permito en dev
      if (allowDevLocalhost(origin)) return cb(null, true);
      // Todo lo demás lo bloqueo
      return cb(new Error("Not allowed by CORS"));
    },
    credentials: true,
  })
);

// ====== Parseo ======
// Aquí le digo a Express que entienda JSON y formularios urlencoded
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ====== /uploads estático (con CORP cross-origin) ======
// Defino la carpeta donde voy a guardar las imágenes subidas
const uploadsDir = path.resolve(__dirname, "../uploads");
// Si la carpeta no existe, la creo
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

// Expongo /uploads como estático y además seteo un header para permitir
// que las imágenes se usen desde otros orígenes (ej: front en puerto 5500)
app.use(
  "/uploads",
  (req, res, next) => {
    // Permito que otros orígenes consuman estos recursos
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    next();
  },
  // Sirvo los archivos estáticos con cache largo (1 año) y marcados como inmutables
  express.static(uploadsDir, { maxAge: "1y", immutable: true })
);

// ====== Seguridad (Helmet) ======
// Helmet me ayuda con cabeceras de seguridad. Aquí ajusto dos políticas
app.use(
  helmet({
    // Permito recursos (como imágenes) desde otros orígenes
    crossOriginResourcePolicy: { policy: "cross-origin" },
    // Desactivo esta política para evitar problemas con algunos recursos embebidos
    crossOriginEmbedderPolicy: false,
  })
);

// Registro HTTP logs en consola con formato "dev"
app.use(morgan("dev"));

// Evito que Express use ETag (para que no responda 304 en la API)
app.set("etag", false);

// ====== No-cache para API (evita 304 en /api/wishlist) ======
// Para cualquier ruta que empiece por /api, fuerzo cabeceras de no-cache
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.setHeader("Surrogate-Control", "no-store");
  }
  next();
});

// ====== Rutas ======
// Aquí monto las rutas agrupadas por módulo

// Rutas de autenticación (login, registro, etc.)
app.use("/api/auth", authRoutes);
// Rutas de wishlist del usuario
app.use("/api/wishlist", wishlistRoutes);
// Rutas de administración (categorías, productos, etc.)
app.use("/api/admin", adminRoutes);
// Rutas relacionadas con el perfil del usuario logueado
app.use("/api/me", profileRoutes);
// Rutas de pedidos de admin
app.use(ordersRouter);
// Rutas públicas de productos (catálogo)
app.use(productsRouter);
// Rutas de reportes para admin (ventas, top productos)
app.use(adminReportsRouter);

// ====== Helpers públicos ======
// Con este helper escapo comillas simples para armar SQL a mano
function esc(str: string) { return str.replace(/'/g, "''"); }

// Helper para convertir un string a entero con valor por defecto
function toInt(v: string, def: number | null = null) {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : (def as any);
}

// Limito los valores de sort permitidos para evitar inyecciones en ORDER BY
function whitelistOrder(v: string) {
  switch (v) {
    case "price-asc":  return "p.price_cents ASC";
    case "price-desc": return "p.price_cents DESC";
    case "name-asc":   return "p.name ASC";
    case "name-desc":  return "p.name DESC";
    default:           return "p.created_at DESC";
  }
}

// Con este helper convierto los bigints que vienen de la BD a números normales
// para que se puedan serializar bien a JSON
function jsonSafe<T>(data: T): T {
  return JSON.parse(JSON.stringify(data, (_k, v) => (typeof v === "bigint" ? Number(v) : v)));
}

// ====== Categorías públicas ======
// Endpoint público para listar las categorías del vivero
app.get("/api/categories", async (_req, res, next) => {
  try {
    const sql = `
      SELECT id::int AS id, name, slug
      FROM categories
      ORDER BY name ASC
    `;
    // Hago la consulta cruda con Prisma
    const categories = (await prisma.$queryRawUnsafe(sql)) as Array<{ id: number; name: string; slug: string }>;
    // Envuelvo la respuesta con jsonSafe por si hay algún bigint
    res.json(jsonSafe({ categories }));
  } catch (e) { next(e); }
});

// ====== Productos públicos ======
// Endpoint público para listar productos con filtros y paginación
app.get("/api/products", async (req, res, next) => {
  try {
    // Leo los filtros que me llegan por querystring
    const {
      q = "", category = "", minPrice = "", maxPrice = "",
      sort = "recent", page = "1", pageSize = "12",
    } = req.query as Record<string, string>;

    // Normalizo página y tamaño máximo/mínimo
    const pageNum = Math.max(toInt(page, 1)!, 1);
    const sizeNum = Math.min(Math.max(toInt(pageSize, 12)!, 1), 48);
    const offset  = (pageNum - 1) * sizeNum;

    // Aquí voy armando condiciones de WHERE de forma segura
    const where: string[] = [];
    if (q) {
      const like = `%${esc(q)}%`;
      // Busco por nombre o descripción ignorando mayúsculas/minúsculas
      where.push(`(LOWER(p.name) LIKE LOWER('${like}') OR LOWER(COALESCE(p.description,'')) LIKE LOWER('${like}'))`);
    }
    if (category) where.push(`c.slug = '${esc(category)}'`);
    if (minPrice) { const v = toInt(minPrice); if (v != null) where.push(`p.price_cents >= ${v}`); }
    if (maxPrice) { const v = toInt(maxPrice); if (v != null) where.push(`p.price_cents <= ${v}`); }

    // Uno las condiciones en un solo string de WHERE si hay filtros
    const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
    // Defino el ORDER BY según el sort permitido
    const orderSql = whitelistOrder(sort);

    // Primero saco el total de filas para poder paginar
    const totalRows = (await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::bigint AS count
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      ${whereSql}
    `)) as Array<{ count: bigint }>;
    const total = Number(totalRows?.[0]?.count ?? 0);

    // Luego saco los productos con join de categoría e imágenes
    const items = (await prisma.$queryRawUnsafe(`
      SELECT
        p.id::int AS id, p.name, p.slug, p.description,
        p.price_cents, p.stock,
        p.category_id::int AS category_id,
        c.name AS category_name, c.slug AS category_slug,
        COALESCE(pi1.url, '') AS image_url,
        COALESCE(JSON_AGG(pi.url) FILTER (WHERE pi.url IS NOT NULL), '[]') AS images
      FROM products p
      LEFT JOIN categories c      ON c.id = p.category_id
      LEFT JOIN product_images pi ON pi.product_id = p.id
      LEFT JOIN LATERAL (
        SELECT url FROM product_images
        WHERE product_id = p.id
        ORDER BY id ASC LIMIT 1
      ) pi1 ON TRUE
      ${whereSql}
      GROUP BY p.id, c.id, pi1.url
      ORDER BY ${orderSql}
      LIMIT ${sizeNum} OFFSET ${offset}
    `)) as any[];

    // Devuelvo la respuesta paginada
    res.json(jsonSafe({ total, page: pageNum, pageSize: sizeNum, items }));
  } catch (e) { next(e); }
});

// ====== Health ======
// Endpoint simple para revisar si la API está viva
app.get("/health", (_req, res) => res.json({ ok: true }));

// ====== Error handler ======
// Middleware final de errores: logueo en consola y devuelvo 500 genérico
app.use((err: any, _req: any, res: any, _next: any) => {
  console.error(err);
  res.status(500).json({ error: "Error de servidor" });
});

// Finalmente arranco el servidor en el puerto definido
app.listen(PORT, () => {
  console.log(`✅ API escuchando en puerto ${PORT} (http://127.0.0.1:${PORT})`);
});
