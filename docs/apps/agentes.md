# Un agente que maneja su información en Deprocast

Un agente de afuera (un bot, un asistente con herramientas) puede usar una cuenta de Deprocast como su memoria de largo plazo: leer lo que hay, cargar documentos y notas, y hablarle a Mastropiero para que cree misiones, entidades o recuerdos.

Lo más limpio es darle **su propia cuenta**: el dueño lo invita desde *Usuarios*, el agente (o quien lo configura) crea la cuenta, y adentro de esa cuenta se crea la app en *Apps conectadas* con los permisos que necesite. Así su base, su memoria y sus agentes quedan separados de los del dueño.

## La base

- **Cuenta del dueño:** `https://<servidor>`
- **Cuenta de un usuario:** `https://<servidor>/u/<id>` (el *Apps conectadas* de esa cuenta muestra la dirección exacta)

Todo pedido lleva `Authorization: Bearer dpc_…`. El token se ve una sola vez al crear la app; se guarda como secreto del agente y se puede revocar.

## Permisos

| Permiso | Qué deja hacer |
| --- | --- |
| `leer` | La puerta MCP (`POST <base>/mcp`): buscar en el corpus, leer piezas, entidades, el grafo, el día, el informe y explorar internet. Solo lectura. |
| `cargar` | `POST <base>/api/apps/cargar`: documentos y notas al corpus. |
| `mensaje` | `POST <base>/api/apps/mensaje`: hablarle a Mastropiero. |

## Cargar

Una carga, o hasta 50 en `{"items": [...]}`:

```json
{
  "id": "investigacion-competidores-2026-11-18",
  "titulo": "Competidores de X en Valencia",
  "contenido": "El cuerpo en Markdown.",
  "resumen": "Dos o tres líneas con lo esencial.",
  "proyecto": "X",
  "tipo": "investigacion",
  "nivel": "investigacion",
  "fuentes": ["https://…"],
  "fecha": "2026-11-18",
  "etiquetas": ["mercado"]
}
```

- **Obligatorios:** `titulo` y `contenido`.
- **`nivel`:** `fuente` (material primario tal cual), `investigacion` (síntesis con fuentes) o `generado` (escrito sin fuentes). Sin nivel, `generado`.
- **`proyecto`:** el nombre de una entidad que ya existe; se reconoce aunque venga mal escrito. Si no existe, la carga entra igual, sin proyecto, y vuelve un aviso.
- **`id`:** opcional pero recomendado. La misma carga reenviada con el mismo `id` no se duplica; si cambió el texto, corrige la pieza y guarda la versión anterior. Sin `id`, el mismo texto exacto no entra dos veces.

Respuesta (`201`):

```json
{ "piezaId": 812, "estado": "nueva", "proyecto": { "id": 14, "nombre": "X" }, "avisos": [] }
```

`estado` es `nueva`, `corregida` o `igual`. En lote vuelve `{"resultados": [...]}`, cada uno con su resultado o su `error`.

Lo cargado entra crudo: la liga lo procesa (entidades, etiquetas, vectores) y queda para buscar por palabras y por significado.

## Mensaje

```json
{ "texto": "Creá una misión secundaria: llamar a Ana el viernes 21/11 por el presupuesto.", "id": "msg-0042" }
```

Mastropiero lo recibe en la charla del día, como si lo escribiera el dueño de la cuenta, y contesta corto diciendo qué hizo.

| Código | Qué pasó |
| --- | --- |
| `200` | `{"estado": "listo", "respuesta": "…", "hechas": ["creó la misión …"], "error": null, "desde": 120, "ultimo": 125}` |
| `202` | `{"estado": "pensando", "desde": 120, …}`: tardó más de 90 segundos. Pedí lo que contestó con `GET <base>/api/apps/mensaje?desde=120` hasta que `pensando` sea `false`. |
| `409` | Está contestando otro mensaje: reintentá en unos segundos. |
| `200` con `"estado": "repetido"` | Ese `id` ya se mandó en los últimos 10 minutos. |

## Errores

- `401`: falta el token, no es válido o lo revocaron.
- `403`: el token no tiene ese permiso.
- `400`: el pedido está mal (el mensaje dice qué falta).
