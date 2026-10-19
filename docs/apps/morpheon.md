# Morpheon → Deprocast: el contrato

Morpheon (la app de sueños) le manda a Deprocast cada sueño al despertar. Deprocast:

1. lo guarda como pieza tuya (fuente «Sueños»);
2. si viene en audio, lo transcribe y **borra el audio**;
3. lo lee en la nube: escenas, personas, símbolos, emociones, si fue lúcido, de qué fuente parece venir, y el cruce con tu día anterior.

Todo se ve en **Sueños**.

## 1. El token

En Deprocast: **Sueños → 🔌 Conectar Morpheon**, o **Hoy → ⚙ → Apps conectadas**.

1. Creá la app «Morpheon» con el permiso `suenos`.
2. El token (`dpc_…`) **se ve una sola vez**: guardalo en Morpheon como secreto, nunca en el código.
3. Si se filtra, revocalo ahí mismo y creá otro.

Cada pedido lleva:

```
Authorization: Bearer dpc_XXXXXXXX…
```

Sin token, o con un token revocado, la respuesta es `401`; sin el permiso, `403`. Las rutas `/api/apps/…` son las únicas que aceptan token: el resto de Deprocast sigue pidiendo tu clave.

## 2. Las rutas

Base: `https://deprocast-lautarosky-lautaro.apps.nan.builders`

### `GET /api/apps/yo`: probar la conexión

```json
{ "app": "Morpheon", "permisos": ["suenos"] }
```

### `POST /api/apps/suenos`: un sueño

Acepta tres formas.

**a) JSON, con el texto:**

```json
{
  "texto": "Soñé que volvía a la casa de mi abuela y las escaleras no terminaban…",
  "fecha": "2026-10-20",
  "despertar": "07:12",
  "duracion_min": 3,
  "lucido": false,
  "emociones": ["angustia", "curiosidad"],
  "nota": "Me desperté con el corazón acelerado"
}
```

**b) `multipart/form-data`, con el audio:**
- el archivo va en el campo `audio` (m4a, mp3, ogg, webm o wav, hasta 25 MB);
- los demás campos son de texto, iguales al JSON;
- `emociones` va separado por comas.

**c) El audio crudo:**
- `Content-Type: audio/m4a` (o el que corresponda);
- los datos van en la query: `?fecha=2026-10-20&despertar=07:12&lucido=1`.

Qué es cada campo (todos opcionales menos `texto` o `audio`):

| Campo | Qué es |
|---|---|
| `texto` | El sueño, como lo contaste. Si también mandás audio, se suman. |
| `fecha` | `YYYY-MM-DD`, el día en que te despertaste. Por defecto, hoy. |
| `despertar` | `HH:MM`. |
| `duracion_min` | Cuánto duró el relato o el sueño, como lo midas. |
| `lucido` | `true` / `false` (en multipart o query: `1` / `0`). |
| `emociones` | Lista, o texto separado por comas. |
| `nota` | Algo más (cómo dormiste, qué comiste…). |

Respuesta `201`:

```json
{ "id": 42, "fecha": "2026-10-20", "texto": "Soñé que…", "estado": "pendiente" }
```

`estado` pasa a `destilado` cuando la nube lo lee (unos segundos).

### `POST /api/apps/eventos`: lo genérico (para las próximas apps)

```json
{ "tipo": "registro", "titulo": "Lo que pasó", "texto": "…", "fecha": "2026-10-20", "datos": { "lo": "que sea" } }
```

Necesita el permiso `eventos`. Entra a tu corpus como tuyo, con el nombre de la app de etiqueta.

## 3. Ejemplos

### curl

```bash
curl -X POST "$DEPROCAST/api/apps/suenos" \
  -H "Authorization: Bearer $MORPHEON_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"texto":"Soñé que volaba sobre Valencia","lucido":true,"emociones":["alegría"]}'

curl -X POST "$DEPROCAST/api/apps/suenos" \
  -H "Authorization: Bearer $MORPHEON_TOKEN" \
  -F "audio=@sueno.m4a" -F "despertar=07:12" -F "emociones=miedo, alivio"
```

### JavaScript (React Native, Expo, navegador)

```js
async function mandarSueno({ uriAudio, texto, despertar, lucido, emociones }) {
  const form = new FormData()
  if (uriAudio) form.append('audio', { uri: uriAudio, name: 'sueno.m4a', type: 'audio/m4a' }) // en el navegador: un Blob
  if (texto) form.append('texto', texto)
  if (despertar) form.append('despertar', despertar)
  if (lucido != null) form.append('lucido', lucido ? '1' : '0')
  if (emociones?.length) form.append('emociones', emociones.join(', '))
  const r = await fetch(`${DEPROCAST_URL}/api/apps/suenos`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${MORPHEON_TOKEN}` }, // sin Content-Type: lo pone FormData con su boundary
    body: form,
  })
  if (!r.ok) throw new Error((await r.json()).error)
  return r.json()
}
```

### Kotlin (Android, OkHttp)

```kotlin
fun mandarSueno(audio: File?, texto: String?, despertar: String?, lucido: Boolean?, emociones: List<String>) {
    val cuerpo = MultipartBody.Builder().setType(MultipartBody.FORM).apply {
        audio?.let { addFormDataPart("audio", it.name, it.asRequestBody("audio/m4a".toMediaType())) }
        texto?.let { addFormDataPart("texto", it) }
        despertar?.let { addFormDataPart("despertar", it) }
        lucido?.let { addFormDataPart("lucido", if (it) "1" else "0") }
        if (emociones.isNotEmpty()) addFormDataPart("emociones", emociones.joinToString(", "))
    }.build()
    val pedido = Request.Builder()
        .url("$DEPROCAST_URL/api/apps/suenos")
        .header("Authorization", "Bearer $MORPHEON_TOKEN")
        .post(cuerpo)
        .build()
    OkHttpClient().newCall(pedido).execute().use { r ->
        if (!r.isSuccessful) error("Deprocast: ${r.code} ${r.body?.string()}")
    }
}
```

## 4. Recomendaciones para Morpheon

- **Mandar al despertar**, aunque sea un audio de 30 segundos: el detalle se va en minutos.
- **Sin red, en cola**: guardalo local y reintentá. Un `401` no se reintenta: pedí un token nuevo.
- **El token en el almacenamiento seguro** del sistema: Keychain en iOS, EncryptedSharedPreferences o Keystore en Android.
