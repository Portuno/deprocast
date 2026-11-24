/**
 * El contrato de la API del dispositivo (Mobile 2.2): una sola lista de lo que un dispositivo (el teléfono, la app
 * nativa de escritorio en Rust, la que venga) puede pedirle a Deprocast en /api/dispositivo/*, con el token `dpd_…`
 * (salvo vincular). Es la fuente: el servidor no atiende una ruta que no esté acá (test/contrato-dispositivo.test.ts lo
 * verifica), el móvil copia este archivo (npm run traer-contrato en depromobile) y no pide nada que no esté, y
 * `npm run contrato` lo escribe en docs/api-dispositivo.json para los clientes que no son TypeScript.
 *
 * Cambiar algo que ya usa un cliente es romperlo: se agrega (y se sube VERSION); no se cambia en el lugar.
 */

/** Sube con cada ruta nueva o cambio compatible. */
export const VERSION = 6

export type Ruta = {
  /** Lo que va después de /api/dispositivo/. «:id» es un número; «:archivo», un nombre de archivo. */
  ruta: string
  metodo: 'GET' | 'POST'
  /** Para qué sirve, en una línea. */
  para: string
  /** El cuerpo (POST) o los parámetros (GET), en corto. */
  pide?: string
  /** Lo que devuelve, en corto. */
  da: string
  /** Desde qué versión de la app existe. */
  desde: string
  /** Sin token (solo vincular). */
  publica?: true
}

export const RUTAS: Ruta[] = [
  { ruta: 'vincular', metodo: 'POST', publica: true, para: 'Vincular con el código de 6 dígitos de Apps conectadas', pide: '{ codigo, nombre, plataforma: ios|android|web|otro, tipo: telefono|escritorio|… }', da: '{ token: "dpd_…", dispositivo }', desde: '1.0' },
  { ruta: 'hoy', metodo: 'GET', para: 'El paquete de Hoy: mensajes, lo que espera tu ok, actividad y uso', da: '{ dispositivo, estado, conversacion, mensajes[{id, rol, texto, en}], paraValidar, servidorEn, marca, actividad, uso }', desde: '1.0' },
  { ruta: 'cambio', metodo: 'GET', para: 'La marca barata de «algo cambió en Hoy»', da: '{ marca, servidorEn }', desde: '1.0' },
  { ruta: 'mensaje', metodo: 'POST', para: 'Escribirle a Mastropiero', pide: '{ texto, id?, en? }', da: '{ ok, repetido? }', desde: '1.0' },
  { ruta: 'voz', metodo: 'POST', para: 'Un tramo de voz (WAV/M4A crudo); se transcribe', pide: 'cuerpo: audio · ?modo=dictado|pasivo|conversacion&inicio&fin&caminando&id&lat&lon', da: '{ texto, destino: chat|nota|conversacion|nada, hablante? } (422: sin voz)', desde: '1.0' },
  { ruta: 'turnos', metodo: 'GET', para: 'Lo último que se dijo, con su hablante', pide: '?desde=<ms>', da: '{ turnos[{id, hablante, texto, inicio, fin, modo}], hablantes }', desde: '1.0' },
  { ruta: 'hablantes/:id', metodo: 'POST', para: 'Ponerle nombre a una voz', pide: '{ entidadId? , yo? }', da: 'Hablante', desde: '1.0' },
  { ruta: 'hablantes/:id/olvidar', metodo: 'POST', para: 'Olvidar una voz (borra su huella)', da: '{ ok }', desde: '1.0' },
  { ruta: 'personas', metodo: 'GET', para: 'Buscar en tus personas', pide: '?q=', da: '{ personas[{id, nombre, tipo}] }', desde: '1.0' },
  { ruta: 'capas', metodo: 'POST', para: 'Los minutos del día en capas (solo números)', pide: '{ minutos[MinutoCapa] }', da: '{ guardados }', desde: '1.0' },
  { ruta: 'rescate', metodo: 'GET', para: 'El estado del rescate de un teléfono recién vinculado', da: '{ estado, total, faltan, aSalvo, procesados }', desde: '1.0' },
  { ruta: 'rescate', metodo: 'POST', para: 'El inventario del rescate', pide: '{ items[{clave, tipo, nombre, bytes?, fecha?, meta?}] }', da: 'EstadoRescate', desde: '1.0' },
  { ruta: 'rescate/subir', metodo: 'POST', para: 'Un ítem crudo del rescate', pide: 'cuerpo: archivo o texto · ?clave=', da: '{ clave, estado }', desde: '1.0' },
  { ruta: 'rescate/cerrar', metodo: 'POST', para: 'Cerrar el rescate (de ahí en más, activo)', da: 'EstadoRescate', desde: '1.0' },
  { ruta: 'puntos', metodo: 'POST', para: 'Los puntos del recorrido', pide: '{ puntos[{en, lat, lon, precision}] }', da: '{ guardados }', desde: '1.0.1' },
  { ruta: 'mapa', metodo: 'GET', para: 'El recorrido de un día o de un rango', pide: '?dia=AAAA-MM-DD | ?desde=&hasta=', da: '{ fecha, puntos, paradas, distanciaKm, fuentes, ultimo }', desde: '1.0.1' },
  { ruta: 'ubicacion', metodo: 'POST', para: 'La ubicación en vivo (side quests cercanas)', pide: '{ lat, lon, precision?, en? }', da: '{ ok }', desde: '1.0.1' },
  { ruta: 'actividad', metodo: 'POST', para: 'Los pasos por día y por hora', pide: '{ dias[{fecha, pasos}], horas?[{hora, pasos}] }', da: 'Actividad', desde: '1.2' },
  { ruta: 'archivo', metodo: 'POST', para: 'Una foto, un video, un audio o un documento; se procesa de fondo', pide: 'cuerpo: archivo · ?id&nombre&tipo&nota&en&lat&lon&auto=1', da: '{ tipo, bytes, procesando } (202)', desde: '1.2' },
  { ruta: 'lugares', metodo: 'GET', para: 'Tus lugares y los que frecuentás sin nombre', da: '{ lugares[{id, nombre, lat, lon, tipo}], frecuentes[{lat, lon, dias, horas}] }', desde: '1.2' },
  { ruta: 'lugares', metodo: 'POST', para: 'Marcar un lugar', pide: '{ nombre, lat, lon, tipo?: casa|trabajo|empresa|destino|frecuente|otro }', da: '{ id, nombre, tipo }', desde: '1.2' },
  { ruta: 'uso', metodo: 'POST', para: 'El uso del teléfono por día (pantalla, desbloqueos, apps, sesiones y, desde 2.3, los cambios de app)', pide: '{ dias[DiaUso + cambios?[[t, paquete]]] }', da: '{ guardados, hoy }', desde: '1.3' },
  { ruta: 'avisos', metodo: 'GET', para: 'Lo que viene (para programar avisos locales) y el widget', da: '{ minutosAntes, avisos[{clave, titulo, cuerpo, en}], ahora?, paraValidar? }', desde: '1.3' },
  { ruta: 'pagos', metodo: 'POST', para: 'Los avisos de las apps de pago y banco', pide: '{ avisos[{paquete, app, titulo, texto, en}] }', da: '{ recibidos, sugeridos }', desde: '1.3' },
  { ruta: 'validar', metodo: 'GET', para: 'Una tanda de tarjetas para validar', pide: '?n=10', da: '{ total, tarjetas[Tarjeta] }', desde: '1.6' },
  { ruta: 'validar', metodo: 'POST', para: 'Sí o no a una tarjeta', pide: '{ tipo, id, accion: aceptar|descartar }', da: '{ ok }', desde: '1.6' },
  { ruta: 'adjunto/:archivo', metodo: 'GET', para: 'Un adjunto del chat (foto, PDF…)', pide: '?ancho= (miniatura)', da: 'el archivo', desde: '2.0' },
  { ruta: 'carga', metodo: 'POST', para: 'Cuándo estuvo enchufado (para el sueño estimado)', pide: '{ muestras[{en, cargando, nivel}] }', da: '{ guardadas }', desde: '2.1' },
  { ruta: 'animo', metodo: 'POST', para: 'Ánimo y energía, de 1 a 5', pide: '{ animo, energia?, en?, nota? }', da: '{ id, titulo } (422: fuera de 1–5)', desde: '2.1' },
  { ruta: 'sueno', metodo: 'POST', para: 'Lo que soñaste', pide: '{ texto, despertar?: HH:MM, fecha? }', da: '{ id, fecha }', desde: '2.1' },
  { ruta: 'escuchas', metodo: 'POST', para: 'Lo que sonó en las apps de música (de sus avisos de reproducción)', pide: '{ escuchas[{en, tema, artista, app?}] }', da: '{ nuevas }', desde: '2.3' },
  { ruta: 'contexto', metodo: 'POST', para: 'A qué wifi y a qué audio Bluetooth estaba conectado (cuando cambia)', pide: '{ en, wifi: string|null, bt: string[] }', da: '{ guardado }', desde: '2.3' },
  { ruta: 'llamadas', metodo: 'POST', para: 'Las llamadas del registro (quién, cuándo, cuánto, de qué tipo; nunca lo hablado)', pide: '{ llamadas[{en, numero?, nombre?, tipo: entrante|saliente|perdida|rechazada, duracionS}] }', da: '{ nuevas }', desde: '2.4' },
  { ruta: 'recibidos', metodo: 'POST', para: 'Quién te escribió (de los avisos de las apps de mensajería; nunca el texto)', pide: '{ mensajes[{en, app, remitente, conversacion?, grupo}] }', da: '{ nuevos }', desde: '2.4' },
  { ruta: 'diario', metodo: 'GET', para: 'El Diario del día: todo lo capturado en una línea', pide: '?fecha=AAAA-MM-DD', da: 'DiarioDia { fecha, resumen, momentos, pasosPorHora, mapa }', desde: '2.2' },
]

/** La ruta del contrato que atiende un pedido (o null): «hablantes/12/olvidar» → «hablantes/:id/olvidar». */
export function rutaDe(pedida: string, metodo: string): Ruta | null {
  const p = pedida.replace(/^\/+|\/+$/g, '').split('?')[0]
  return RUTAS.find((r) => r.metodo === metodo && new RegExp(`^${r.ruta.replace(':id', '\\d+').replace(':archivo', '[^/]+')}$`).test(p)) ?? null
}

/** El contrato como JSON, para los clientes que no son TypeScript (la app nativa en Rust). */
export const comoJson = () => ({ version: VERSION, base: '/api/dispositivo/', autenticacion: 'Authorization: Bearer dpd_… (salvo vincular)', rutas: RUTAS })
