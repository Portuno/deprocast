# Reporte: Firecrawl y Alexandria en Deprocast (plan v32, 3/11/2026)

## Contexto
Lautaro pidió revisar Firecrawl Alexandria (firecrawl.dev/alexandria) e incorporarlo de la mejor forma, todo dentro de la prueba gratis, con un reporte.

## Qué es
- **Firecrawl:**
  - buscador web (resultados tipo Google, con `includeDomains`);
  - lector de páginas que se arman con JavaScript, en Markdown;
  - **plan gratis de 1.000 créditos por mes**, sin tarjeta, que se renuevan. Buscar cuesta 2 créditos cada 10 resultados y leer, 1 por página. Hasta 10 pedidos por minuto y 2 a la vez.
  - **Sin clave también anda**, con menos cupo (probado en vivo).
- **Alexandria:** un catálogo de **430 proveedores y 2.461 capacidades** de datos. Las categorías más grandes son registros públicos, retail, inmobiliario, ciencias de la vida, desarrollo, viajes y finanzas.
  - Ejemplos: Apollo (personas y empresas), Particle (podcasts), Benzinga (noticias financieras), índices de papers y de código.
  - Descubrir herramientas es gratis; usarlas cuesta lo que diga cada una.
  - **Pide clave** (la de la cuenta gratis).

## Lo que se hizo (82c60cd)
- **`src/explorar/firecrawl.ts`:** buscar (con dominios), leer y Alexandria (descubrir y usar). El cupo se cuenta en `cuotas`: 300 búsquedas + 400 lecturas por mes, ajustables con `FIRECRAWL_CUOTA` y `FIRECRAWL_LECTURAS`.
- **`buscarWeb`:** Firecrawl es un buscador más, después de Brave y Tavily y antes de Exa.
- **Explorar:**
  - en **X va primero**: trae tweets y perfiles reales de x.com, que Exa no indexaba;
  - de respaldo en Reddit, LinkedIn, Instagram y Facebook;
  - lector de respaldo en la web (después del propio) y en Reddit.
- **Canal `alexandria`:** buscar = las herramientas que sirven para una consulta (proveedor, capacidad, entradas, precio).
- **Chat:** `usar_alexandria` (acción: gasta créditos, pide su ok antes). Los agentes y el MCP no la tienen: no gastan créditos solos.
- **Doctor:** dice si hay clave de Firecrawl.

## Para prender Alexandria (lo hace él)
1. Crear la cuenta gratis en firecrawl.dev (sin tarjeta).
2. Copiar la API key (`fc-…`).
3. Ponerla como `FIRECRAWL_API_KEY` en el `.env` de la compu y en las variables de la app de NaN (la nube).
4. Reiniciar.

Sin clave, todo lo demás de Firecrawl ya anda.

## Lo que no se puede
- Instagram no lo soporta Firecrawl.
- Las empresas de LinkedIn piden activar un proveedor de enriquecimiento en Alexandria, con la cuenta.
- Ninguna herramienta corre sola gastando créditos.

## Probado en vivo (3/11)
- **Buscar en X:** Firecrawl trajo x.com/claudeai, un artículo de @addyosmani y un tweet de @claudeai (antes, 0 resultados).
- **Buscar en Facebook:** Exa (páginas de Cinema Jove, Las Provincias y MICE).
- **Leer festiav.com:** el lector propio, 13.729 caracteres. Firecrawl queda de respaldo.
- **Cupo:** se contó 1 búsqueda de 300.
- **Alexandria sin clave:** responde «An API key is required for provider tools», como se esperaba.
- **Tests:** 420. Uno de Telegram es intermitente porque sale a internet; no tiene que ver con esto.
