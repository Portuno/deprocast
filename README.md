# Deprocast 1.0 — Mastropiero

La base primitiva del orquestador. **Mastropiero es el agente omnívoro: no es una ficha, es la liga entera.** Los agentes son cartas que se forjan, se prueban, juegan, suben de nivel, se ganan un nombre y, si dejan de correr, se retiran.

No tiene dependencias en runtime: usa Node 24 (TypeScript nativo), `node:sqlite` y `node:test`.

```bash
npm run jugar                 # la pantalla de juego: http://127.0.0.1:7272
npm run mastro -- demo        # arma una liga de ejemplo en data/demo.db
npm run mastro -- forja       # forja interactiva
npm run mastro -- liga        # lo que ve el omnívoro
npm test
```

Todo vive en `data/mastro.db`: la liga, el corpus y la crónica sobreviven a cerrar el servidor. `npm run jugar -- --db otra.db` abre otra partida.

## Vivo: el día, la memoria y el diario

La pantalla abre en **Hoy**. Mastropiero ya no solo ingiere: acompaña el día.

- **Memoria** (`src/memoria.ts`): lo que sabe del operador (hechos, metas, preferencias, sueños, visión), con fecha. Se escribe sola. Después de cada charla, un escriba lee **solo lo que dijo el operador** y anota de 0 a 3 cosas. Corregir no borra: la versión vieja queda como corregida. Cada recuerdo sabe de qué charla o pieza salió.
- **Aprender de lo cargado**: en Norte, pasa el escriba por las charlas pasadas y por las piezas propias más pesadas, de a 4 en paralelo. Con las grabaciones es más cuidadoso: puede haber otras voces o errores de transcripción. Aun así, conviene revisar lo nuevo.
- **Norte**: metas, visión y sueños en Castillo, Campamento y Trinchera, más "lo que sé de vos". Ahí se revisa, se corrige, se mueve de horizonte o se olvida.
- **Jornada** (`src/jornada.ts`): el día en bloques (12, 25 o 50 minutos, configurables), armado con la memoria, lo que hablaron, el calendario y cómo fue ayer. Los bloques se validan: sin solapes, dentro de la ventana y respetando la agenda. Para hoy se arma desde ahora. Los bloques se marcan como hecho o saltado, y se puede rehacer desde ahora.
- **Calendario** (`src/calendario.ts`): solo lectura, por la dirección secreta iCal de Google (`GCAL_ICS_URLS` en `.env`, sin OAuth). Entiende zonas horarias, eventos de día entero y repeticiones simples.
- **Rutinas** (`src/rutinas.ts`): la jornada a las 08:30 y el cierre a las 22:30, editables. Corren mientras el servidor está prendido, y si al arrancar ya pasó la hora, se ponen al día. Lo que producen llega a la conversación **Hoy**, con aviso. Tu respuesta al cierre queda guardada y alimenta el día siguiente. `npm run jugar -- --sin-rutinas` las apaga.
- **Diario**: en el chat, "Contale algo". Mastropiero escucha y pregunta poco. Cada entrada entra al corpus como voz propia, y se puede subir un audio, que transcribe el Whisper de NaN.
- **Quántomos**: quedan como plomería interna, detrás de un botón en Corpus.

## El chat: hablar con el omnívoro

El chat es la puerta principal. Con **Mastropiero** se habla en lenguaje natural, y él opera toda la plataforma con 31 herramientas (`src/chat/herramientas.ts`):

| Familia | Herramientas |
| --- | --- |
| Leer | Estado general, agentes, caídos, bus, misiones, corpus (búsqueda y piezas), fuentes, quántomos, entidades (con co-ocurrencias), cargas, crónica, **sus propios lineamientos** (este README y un mapa del código), propuestas. |
| Actuar | Forjar y bautizar agentes, crear proyectos, publicar misiones, correr ticks, ingerir, crear fuentes, crear, sellar y mejorar quántomos, **hablar con otro agente**, **proponer mejoras**. |
| Destructivas | Banca, retirar un agente, deshacer una carga. Solo corren con `confirmado: true`, después de un sí explícito del operador. |

- **Hablar con los agentes:** también se puede abrir una conversación directa con cualquier agente de la liga. Contesta desde su persona (clase, instrucciones, nivel, especialización) y solo con herramientas de lectura, con el tope de lectura que le da su nivel.
- **Quién es el operador:** Mastropiero lo arma con lo que hay cargado (la entidad marcada como operador y lo que más aparece en el corpus). No hay nada de eso escrito en el código.
- **Propuestas de mejora:** quedan abiertas hasta que el operador las acepta o las descarta. No se aplican solas.
- **Motor:** NaN con tool calling. La cadena es `deepseek-v4-flash → qwen3.8-flash → glm5.3-flash`, y se pisa con `NAN_CADENA_MASTROPIERO`.
- **Voz:** Mastropiero conversa, no reporta. Prosa en primera persona, sin ids ni jerga interna; lo que sale del corpus va citado con `[#id]` y la pantalla lo muestra como nota al pie que abre la fuente. Las herramientas que usó se resumen en una sola línea plegable.
- **Turnos:** cada turno corre en segundo plano, se guarda mensaje a mensaje y la respuesta llega en streaming (si el streaming falla, cae al camino sin streaming con todos sus reintentos). Un turno tiene como máximo 10 vueltas de herramientas.

Las conversaciones y las propuestas viven en la base (`conversaciones`, `mensajes`, `propuestas`).

## La pantalla

- **Secciones:** Chat · Liga (Roster, Forja, Misiones, Matriz 72, Cementerio) · Saber (Corpus, Quántomos, Entidades).
- **Estilo:** sobrio, con tema oscuro y claro. La crónica se oculta desde el botón ☰.
- **Entidades:** personas, proyectos, agrupaciones, dominios, lugares y conceptos. Cada una muestra con quién aparece y en qué piezas, y tiene un botón para preguntarle a Mastropiero por ella.

## Las seis piezas

| Pieza | Archivo | Qué es |
| --- | --- | --- |
| El bus | `src/bus.ts` | Una sola tabla de tareas. Todos los agentes leen y escriben ahí y ninguno llama a otro. |
| El roster | `src/roster.ts` | Fichas, forja, bautismo, banca y lápidas. |
| La liga | `src/mastropiero.ts` | El tick: **purga → reparte → corre**. También la ingesta y los proyectos. |
| El entrenador | `src/gerente.ts` | Hay un gerente por proyecto. Decide quién toma cada tarea. |
| El auditor | `src/auditor.ts` | Guarda input, decisión y output de cada corrida y de cada asignación. La especialización sale de este log. |
| El contexto | `src/contexto.ts` | Contexto en capas según el nivel. El corpus vive afuera y los agentes lo leen. |

## La carta

| Campo | Regla |
| --- | --- |
| Clase | Una de 9. La décima, Omnívoro, no se forja. |
| Designación | `GEN-0007`. No se recicla nunca, ni después de muerto. |
| Nombre | Se gana en nivel 3 (`bautizar`). Es único en la historia de la liga. |
| XP / Nivel | +10 por tarea cumplida, +2 por cada asignación de un gerente. Seis niveles: 0 · 50 · 200 · 450 · 800 · 1250. |
| Especialización | El dominio con más éxitos en el log, con un mínimo de 3. |
| Estado | `prueba` → `activo` ⇄ `banca` → lápida. |
| Creador | `operador`, `mastropiero` o el id de un gerente. |
| Celda | Opcional, de 1 a 72. Usa la geometría de la Matriz 72 de la 0.7.1. Varias fichas pueden compartir una celda. |
| Motor | `local` (sin modelo), `llm` (endpoint compatible con OpenAI) o `funcion:<n>` (lista blanca). |

### Lista6 de atributos

Cada clase trae una base de 9 puntos. En la forja se reparten 6 más, con un tope de 6 por atributo. Cada atributo mueve una perilla real del runtime:

1. **Potencia**: largo máximo de salida.
2. **Precisión**: temperatura más baja.
3. **Memoria**: cuántas tareas propias recuerda.
4. **Temple**: cuántos reintentos tiene.
5. **Iniciativa**: cuántas tareas nuevas puede publicar en el bus.
6. **Ritmo**: cuántas tareas corre por tick.

### Capas de contexto, por nivel

1. **Tarea**: el esquema chico y el payload.
2. **Memoria**: sus últimas tareas.
3. **Proyecto**: lo reciente de su proyecto.
4. **Especialidad**: el corpus de su dominio, precargado.
5. **Corpus**: lectura amplia.
6. **Liga**: el roster y la auditoría de los demás.

Todos los agentes pueden leer. Ninguno escribe salvo a través del bus. Mastropiero es el único que ve todo.

## Ciclo de vida

- **Forja**: el agente entra en `prueba`. Los reclutas tienen prioridad para recibir tareas, porque un agente que no corre no se puede evaluar.
- **Prueba**: con 3 éxitos pasa a `activo`. Con 3 fallos va a la lápida sin haber jugado.
- **Activo**: si falla 3 veces seguidas, va a la `banca`. Sus tareas vuelven al bus.
- **Siete días sin correr**: la lápida. **Se borra, no se mejora.** La ficha queda en `lapidas` como historia.
- **Vacantes**: si una tarea no tiene candidato, Mastropiero o el gerente del proyecto forjan un recluta. Hay dos excepciones: los ejecutivos y los gerentes nunca se reclutan solos.

## Contratos por clase

La liga valida la salida de cada corrida. Si la salida no cumple el contrato, la corrida cuenta como fallo.

| Clase | Salida |
| --- | --- |
| Generativo | `{texto}` |
| Ejecutivo | `{efecto, ok}`. Solo `funcion:*`: nunca un efecto improvisado por un modelo. |
| Gerente | `{decision}` |
| Buscador | `{respuesta, citas[]}`. **Sin cita es un fallo.** |
| Crawler | `{items[{titulo, contenido, url}]}`. Cada item entra al corpus como `web` y arranca la ingesta. |
| Vectorizador | `{embedding[]}` |
| Clasificador | `{etiquetas[]}` |
| Extractor | `{datos, quantomos[]}`. Los quántomos entran como proto. |
| Auditor | `{veredicto, hallazgos[]}` |

## Corpus

**El sistema arranca en blanco.** No trae datos de nadie: todo entra por ingesta o por cargas, y queda en `data/` (fuera de git).

### Cuatro niveles: de quién es la voz

| Nivel | Qué entra |
| --- | --- |
| I · Mía | Lo que dijiste, escribiste o viviste: audios, notas, cuadernos, chats, listas. |
| II · Fuente primaria | La obra de otro, tal cual: libro, paper, ley, repo, post, lo que trae un crawler. |
| III · Investigación | Síntesis o curación hecha con ayuda: informes, packs, repertorios. |
| IV · Generada | Lo que producen los agentes. Cada obra de un generativo entra acá sola. |

Cada fuente tiene un nivel por defecto, y cada pieza puede tener el suyo. Las fuentes se crean desde la pantalla. De fábrica vienen cuatro, que son estructura y no contenido: **Operador**, **Deprocast 0.7** (cada carga cuelga su subfuente, como `Deprocast 0.7.1`), **Web** y **Agentes**.

Las piezas además tienen tipo: `materia`, `referencia` (apunta a una obra), `ficha`, `lista` o `enlace` (una URL por traer, que se manda a un crawler). La búsqueda es FTS5, ignora tildes y ordena por bm25.

### Ingesta y cargas

- **Lo suelto** (una nota, una referencia, un informe) entra por el modal de Ingesta, elegido por nivel. Arranca crudo y recorre la pipeline del bus: **crudo → extractor → clasificador → vectorizador → disponible**.
- **Un archivo** entra como **carga**: se sube, se detecta el formato, se parte en segmentos y el operador elige qué entra, en qué fuente y si pasa por la pipeline (no, solo vectorizar o completa). Cada carga queda registrada y **se puede deshacer entera**. Repetir una carga no duplica nada: cada pieza lleva su origen.

| Formato | Importador | Qué hace |
| --- | --- | --- |
| `deprocast-backup` | `cargas/deprocast.ts` | Respaldo de la 0.7.x en 12 segmentos: entidades, audios, notas, cuadernos, chats, criba (con umbral de peso, sin slop), conocimiento, investigaciones, informes, listas AmazonA, quántomos (con sello L72 y haikus) y enlaces por traer. |
| `deprocast.entity-card` | `cargas/deprocast-ficha.ts` | Ficha de entidad: la entidad, su prosa, sus quántomos y el vínculo con las piezas ya cargadas. |
| `deprocast-quantomos` | `cargas/deprocast.ts` | Exporte de quántomos, proto o sellados. |
| `.csv` | `cargas/csv.ts` | Una pieza por fila. Si trae autor, clasificación o prioridad, es un repertorio de referencias. P0, P1 y P2 pasan a peso 12, 8 y 4. |
| `.txt` `.md` `.html` | `cargas/texto.ts` | Entero, o un Markdown partido por sección. |

```bash
npm run mastro -- cargar archivo.json            # analiza y muestra los segmentos
npm run mastro -- cargar archivo.json --todo     # la ejecuta con lo que propone
npm run mastro -- fuentes
npm run mastro -- reetiquetar 1                 # recalcula entidades y etiquetas de una carga hecha
```

El importador de la 0.7 ignora los vínculos `via_agrupacion`: son pertenencia propagada (cada persona de un grupo en cada entrada que nombra al grupo), no menciones. Una carga hecha antes de esa corrección se repara con **Recalcular etiquetas** en el detalle de la carga, sin tocar piezas ni quántomos.

### Quántomos

Son la unidad mínima: una afirmación atómica, colgada de la pieza de la que sale.

| Etapa | Cómo se llega |
| --- | --- |
| proto | Lo propone un extractor o lo trae una carga. |
| sellado | El operador lo pesa de 1 a 12. |
| propuesta | Un generativo propuso una versión mejor (✦ Pedir mejora). |
| superado | Su propuesta fue aceptada: queda en el linaje. |
| descartado | El operador lo tiró. |

Nada se pisa. Cada mejora es una versión nueva con su padre, y el linaje se puede recorrer completo.

### Entidades

Personas, proyectos, agrupaciones, dominios, lugares y conceptos. Por ahora nombran y agrupan piezas, y son la semilla del módulo Personas.

## Motores de modelo

Copiá `.env.example` a `.env`. La CLI lo carga sola.

**`nan`** (`src/nan.ts`) sigue la misma política que la 0.7.1: 402 pasa al siguiente modelo, 429 espera, 401 corta, 5xx reintenta dos veces. DeepSeek pide `max_tokens` de 16384 o más. El tope es de 50 pedidos por minuto. Cada llamada queda anotada en `llamadas`.

| Clase | Cadena |
| --- | --- |
| Gerente, Auditor | glm5.3-flash → deepseek-v4-flash (razonan) |
| Generativo, Extractor, Buscador | deepseek-v4-flash → … (1M de contexto, el cupo mayor) |
| Clasificador | qwen3.8-flash → deepseek-v4-flash (corto y masivo) |
| Vectorizador | qwen3-embedding |
| Ejecutivo, Crawler | No usan modelo. |

Cada cadena se pisa con `NAN_CADENA_<CLASE>`. MiMo entra al final de las cadenas de chat cuando `NAN_MIMO_ID` tiene su id exacto.

```bash
npm run mastro -- nan cadenas    # el ruteo
npm run mastro -- nan modelos    # ids reales de tu key
npm run mastro -- nan uso        # tokens del mes contra el cupo
```

**`llm`** es cualquier otro endpoint compatible con OpenAI. Se configura con `MASTRO_LLM_BASE_URL`, `MASTRO_LLM_KEY`, `MASTRO_LLM_MODEL` y `MASTRO_EMBED_MODEL`.

## Mudanza a otra compu

La base, las cargas y la memoria viajan en un respaldo; el código, por git o copiando la carpeta. El `.env` no viaja en el respaldo porque tiene las claves: se copia a mano.

1. En la compu de origen: `npm run mastro -- respaldo`. Deja una carpeta en `data/respaldos/AAAAMMDD-HHMM/` con `mastro.db`, los archivos de `cargas/` y un `manifiesto.json` con los conteos. Funciona con el servidor prendido.
2. Llevar a la compu nueva la carpeta del proyecto (sin `node_modules`), esa carpeta de respaldo y el `.env`.
3. Instalar Node 24 o más (nodejs.org). No hay dependencias que instalar.
4. `npm run mastro -- restaurar <carpeta-del-respaldo>`. Si ya hay una base, no la pisa: con `--forzar` la reemplaza y guarda la anterior como `mastro.db.antes-<fecha>`. Las rutas de las cargas se reescriben a la compu nueva.
5. `npm run doctor`: revisa Node, la búsqueda (FTS5), el `.env`, que NaN responda, la base, el puerto, el calendario y `ffmpeg`. Con `--rapido` no sale a la red.
6. `npm run jugar`. Arranca con las rutinas prendidas; `--sin-rutinas` las apaga.

## Pendiente, a propósito

- **Módulo Personas**: la matriz de relaciones, con la próxima acción sugerida por contacto.
- **Importar las 40 fichas de la 0.7.1** como cartas con su celda.
- **Búsqueda híbrida**: FTS5 más coseno, cuando haya embeddings de consulta (los de la 0.7.1 no se importan porque son de otro modelo).
- **Más importadores**: Gemini Takeout, NotebookLM, exportes de Perplexity, Grok y Claude, PDF y audio (Whisper de NaN).
- **El operador como contexto**: una capa que les dé a los agentes quién sos, a partir de las entidades y las piezas de nivel I.
- **Agentes que proponen cambios al código de Mastropiero** (La Fragua). Quedan como propuesta con firma humana, nunca como autoaplicación.
- **Agentes con dinero**: un ejecutivo con presupuesto por función, con tope duro y aprobación del operador.
