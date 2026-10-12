# Mejoras del harness

Propuesta para aplicar a Deprocast lo que se transfiere de *An Empirical Study of Harness Design* (Fan, Zhang, Ma, Hu, Wang, Song, Liu, Zamani y Wang, arXiv:2609.20804, septiembre 2026).

Este archivo es la propuesta. No cambia el código. Cada cambio de abajo se implementa aparte, si se acepta.

## Qué midió el paper

El harness es la capa de software que convierte un modelo en agente: el bucle, las herramientas y la política de contexto. El trabajo fija un bucle ReAct (pensar, actuar, observar) y varía tres piezas, con el resto quieto: permisos, diagnósticos después de editar y detección de estancamiento.

Evaluaron 176 configuraciones emparejadas. Cuatro modelos: Nemotron-3 de 30B, 120B y 550B, y Mistral Medium 3.5 de 128B. Dos bancos: SWE-Bench Verified (500 issues de repositorio, solo Python) y Terminal-Bench 2.1 (89 tareas de terminal). Cinco políticas de contexto (T0 a T4), cuatro ventanas (32k, 64k, 96k y 128k), y ablaciones de plan y de espacio de acciones solo en T4 con ventana de 128k. Una corrida por tarea. Comparan con el test de McNemar y corrigen por Benjamini–Hochberg.

Las tres piezas:

| Pieza | Qué varían |
| --- | --- |
| Contexto | T0 no compacta y corta si se pasa de la ventana. T1 elide observaciones viejas de herramientas. T2 agrega un almacén y la herramienta `recall_event` para recuperarlas. T3 resume con el modelo, sin elidir. T4 elide primero (umbral blando) y resume solo si sigue sin entrar (umbral duro). |
| Plan | Un plan persistente que el modelo actualiza con `update_plan`. Se inyecta en cada turno y no se guarda dentro del historial. |
| Acciones | Herramientas tipadas (`read_file`, `edit_file`, `grep_text`, `bash`, etc.) frente a bash como única interfaz. |

Umbrales de T4: elisión al 60 % de la ventana usable, resumen al 85 %. El system prompt, la tarea y una ventana reciente (30 % de la ventana, con piso de dos turnos) quedan verbatim. Solo se compacta el medio.

### Hallazgos

1. **El contexto importa cuando la ventana aprieta.** En SWE-Bench, la ventaja media de T1–T4 sobre T0 cae de 35,7 puntos porcentuales en 32k a 2,7 en 128k. El mecanismo es evitar que la corrida muera por overflow (en T0, el 78,7 % de las tareas de SWE-Bench se pierden así a 32k; en las políticas gestionadas, cero). La conducta del agente casi no cambia: la corrida simplemente dura lo bastante para llegar a editar y verificar.

2. **Elidir antes de resumir es la política más barata, con precisión parecida.** T4 mantiene una tasa de éxito comparable a T1–T3 y el costo medio más bajo en siete de los ocho paneles modelo–banco. La elisión temprana evita llamadas de resumen. El pico de contexto de T4 queda por debajo del de la elisión sola.

3. **Recuperar lo elidido no paga.** En 32 comparaciones emparejadas, T2 (elisión más recall) le gana a T1 (elisión sola) en 15, pierde en 14 y empata en 3. La diferencia media es −0,36 puntos. En el 56 % de las configuraciones con `recall_event` nadie la llama. La mediana de llamadas es cero. El uso se concentra en el modelo de 30B y en la ventana de 32k. Los modelos fuertes casi no la usan.

4. **El plan cambia de rol con la capacidad del modelo.** En Nemotron-3 30B, con plan, SWE-Bench sube 11,6 puntos y Terminal-Bench 4,5, a más costo: la corrida llega a intentar una edición en lugar de abandonar. En 550B y en Mistral, el costo de SWE-Bench baja cerca del 30 % y del 32 %, y la precisión baja 2,0 y 0,4 puntos. El plan les corta verificación repetida después de editar. En 120B el efecto depende de la tarea.

5. **Las herramientas tipadas sostienen al modelo flojo en shell. Bash solo le conviene al que ya sabe shell.** En 30B, el juego tipado sube 15,0 puntos en SWE-Bench y 10,1 en Terminal-Bench. En 550B, bash solo sube SWE-Bench a 69,4 % (frente a 65,8 %) y baja el costo de 2,33 USD a 1,11 USD por tarea. Bash agrupa varias operaciones en un llamado y escribe en bloques más grandes. Mistral invierte la preferencia según el banco: herramientas en SWE-Bench, bash en Terminal-Bench.

La conclusión del paper: cada pieza se elige según el modelo, el tipo de tarea y el presupuesto. Adoptar las tres por defecto no es el resultado.

## Qué me parece

El diseño es de los pocos que separa componentes en vez de comparar productos enteros (Claude Code, Codex, OpenHands, SWE-Agent). El análisis de trayectorias cierra el mecanismo: el contexto alarga la corrida, el plan mueve el punto de corte, las herramientas cambian el tamaño de cada escritura. Las limitaciones las escriben ellos y alcanzan para no copiar los números a otro stack.

Esas limitaciones pesan acá:

- Plan y espacio de acciones solo se miden en T4/128k. No se sabe si el plan sigue ayudando con la ventana corta, ni si bash solo sigue ganando cuando el contexto está justo.
- Una corrida por tarea. Terminal-Bench tiene 89 tareas: muchas celdas no llegan a significancia y la lectura se apoya en la dirección repetida.
- SWE-Bench es solo Python. El cruce “tools contra bash” mezcla la cantidad de herramientas con read-before-write, el estado de archivos y el diagnóstico automático después de editar. No aísla la granularidad.
- Los modelos son Nemotron y Mistral, servidos a temperatura 0, con tope de 300 pasos. El punto de cruce (a partir de qué tamaño el plan pasa de andamio a ahorro) hay que revalidarlo en otra familia.

Para Deprocast el paper es un diagnóstico, no una receta. El chat de Mastropiero corre en flash: `deepseek-v4-flash`, después `qwen3.8-flash`, después `glm5.3-flash` (`src/nan.ts`, pisable con `NAN_CADENA_MASTROPIERO`). DeepSeek declara un millón de tokens de contexto. El tope del bucle es de 10 vueltas de herramientas, no de 300 pasos. El cuello de acá es el corte del historial, no el overflow del modelo.

Eso ubica a estos modelos del lado “flojo” del paper en dos ejes: les rinde un andamio de plan en encargos largos, y les rinde un juego de herramientas tipadas. Les sobra, en cambio, la maquinaria de recall.

## Cómo está el harness hoy

El bucle del chat vive en `src/chat/index.ts`.

- `MAX_VUELTAS = 10`. Al llegar, guarda el texto fijo «Corté acá: fueron demasiadas vueltas…» y termina.
- `VENTANA = 40`. `historial` se queda con los últimos 40 mensajes y descarta el resto, incluidos mensajes del operador.
- Una salida de herramienta anterior al último mensaje del operador se recorta siempre a 3000 caracteres. La del turno en curso, a 12000 (`bucle`, al guardar el resultado).
- El razonamiento del modelo solo vuelve al modelo dentro del turno en curso.
- El system prompt (`promptMastropiero`) se arma entero en cada envío: voz, liga, día, memoria, finanzas, personas, librería. No se compacta.
- No hay región reciente protegida, ni resumen de lo viejo, ni detección de la misma llamada repetida.

Esa política tira turnos de conversación para ahorrar tokens que se ahorrarían vaciando el cuerpo de las herramientas viejas. En la grilla del paper queda por debajo de T1: T1 conserva el diálogo y reemplaza la observación pesada por un stub.

La Fragua (`src/fragua.ts`) es el otro harness, el que toca código. Son dos llamados JSON, sin bucle:

1. Elige hasta 6 archivos (`SISTEMA_ARCHIVOS`).
2. Recibe el contenido entero y devuelve `buscar` / `reemplazar` (`SISTEMA_CAMBIOS`). El campo `resumen` describe el diff; no es un plan que se inyecte en un turno siguiente.
3. `aplicarCambios` escribe en un worktree (`fragua/<id>`). `verificarDefecto` corre `tsc` y, si pasa, la suite `node --test`. El resultado queda en `salida`; el diff, en `diff`. El merge a main pide un ok humano.

El herrero ya usa una acción tipada, del estilo `edit_file` del paper. No tiene shell.

Las capas de `src/contexto.ts` son otra cosa: cuánto corpus se le precarga a un agente de la liga según su nivel. No arman el historial del chat. Este documento no las modifica.

## Qué queda afuera

Estas tres ideas salen del paper y no se implementan.

**Recall.** Ni `recall_event`, ni una tabla con el texto elidido para rehidratarlo. El paper muestra que el modelo casi no pide el original, y cuando lo pide la precisión no sube. Si hace falta el dato, la herramienta se vuelve a llamar: el corpus y la base siguen ahí. El stub lo dice.

**Bash como interfaz.** Ni en el chat ni en La Fragua. Los modelos de la cadena flash están del lado en que el paper ve ganancia con herramientas tipadas. Un shell además mezclaría permisos, efectos y el estado del repo en un solo canal. La Fragua sigue con `buscar` / `reemplazar` exactos.

**Plan en cada mensaje.** En el régimen flojo el plan alarga la corrida y sube el costo. En un «hola» o en el diario ese costo no compra precisión. El plan entra solo en los encargos largos de la sección 2.

Tampoco se copia el harness del paper como agente de código de 300 pasos, ni se cambia la temperatura 0,5 del chat, ni se mueve el tope de 10 vueltas. Ese tope es el presupuesto; la sección 3 hace que una repetición no se lo coma entero.

## Cambios realizables

### 1. Elisión por etapas en el chat

**Hallazgo.** La precisión se cae cuando el historial se corta de golpe. La política barata es elidir primero las observaciones viejas y pesadas, y resumir el medio solo si el armado sigue sin entrar. El system prompt y los turnos recientes quedan verbatim.

**Archivo.** `src/chat/index.ts`, función `historial`. El texto completo de cada herramienta sigue guardado en `mensajes`: la elisión es solo lo que ve el modelo en el próximo llamado. Hace falta un test en `test/chat.test.ts` que arme una conversación larga y compruebe el stub, la ventana reciente intacta y que el mensaje del operador viejo sigue presente.

**Comportamiento.**

- El system prompt no se toca. Sigue armándose en `promptMastropiero` / `promptAgente` / `promptDiario`.
- Ventana reciente, verbatim: desde el anteúltimo mensaje con rol `operador` hasta el final. Piso de dos turnos del operador. Ahí las salidas de herramienta conservan el tope actual de 12000 caracteres, para que un `leer_pieza` no se lleve el turno.
- Región media (todo lo anterior a esa ventana): si el cuerpo de una herramienta supera 800 caracteres, se reemplaza por un stub. El diálogo del operador y las respuestas de texto quedan. Forma del stub, sin id de recall:

  `[salida elidida: N caracteres. Volvé a llamar la herramienta.]`

- `VENTANA = 40` deja de ser el primer corte. Los mensajes viejos entran mientras el armado quepa.
- Tope blando: 48000 caracteres en el historial armado (sin el system prompt). Si después de elidir sigue arriba, un llamado aparte, sin herramientas, a la misma cadena, resume los mensajes más viejos del medio en un solo bloque y esos mensajes salen del arreglo. Encabezados fijos, se omite el que vaya vacío:

  - Objetivo
  - Hecho
  - Pendiente
  - Decisiones del operador

- Tope duro de seguridad: 80000 caracteres después del resumen. Si todavía no entra, se descartan los mensajes ya cubiertos por el resumen, de los más viejos a los más nuevos, sin volver a llamar al modelo. La ventana reciente no se recorta en este paso.
- El resumen se inyecta como un mensaje de sistema corto al armar el llamado. No se escribe en `mensajes` y no aparece en la pantalla como si Mastropiero lo hubiera dicho.

**Qué no se toca.** La base guarda el texto completo. No hay almacén de recall. El diario y el turno en curso no se resumen. El tope de 12000 del resultado recién ejecutado (`bucle`) queda igual.

### 2. Plan solo en encargos largos

**Hallazgo.** En un modelo del lado flojo, un plan explícito sostiene la corrida hasta que intenta el trabajo. En un modelo fuerte, sobre todo ahorra verificaciones de más. El plan del paper se inyecta en cada turno y vive fuera del historial.

**Archivos.** `src/chat/index.ts` (el bucle del turno) y `src/fragua.ts` (el herrero). Un test del chat comprueba que un mensaje cotidiano no dispara el plan, y que un pedido de run sí lo inyecta sin guardarlo como mensaje. Un test de la Fragua comprueba que el llamado de cambios recibe las tres líneas.

**Comportamiento en el chat.**

- Encargos largos, y solo esos: preparar o rehacer una run, forjar una mejora, ingerir o cargar en varios pasos. El criterio es la intención del mensaje del operador (run, fragua, ingesta o carga de más de un paso), no un plan en cada envío.
- Al entrar `bucle` en uno de esos encargos, el primer llamado lleva una instrucción aparte, fuera de `mensajes`: escribir un plan de hasta tres líneas (qué va a hacer, con qué herramienta, cómo sabe que terminó) y seguir. En las vueltas siguientes del mismo turno, ese texto se prepende al arreglo, al lado del system prompt, y no se persiste.
- Si el modelo lo actualiza a mitad del turno, la versión nueva reemplaza a la anterior en esa inyección. Tampoco se guarda como mensaje de la conversación.
- Diario, charla suelta y agentes de la liga en conversación directa no lo ven.

**Comportamiento en La Fragua.**

- Entre la elección de archivos y `SISTEMA_CAMBIOS`, un llamado JSON pide tres campos: `archivos` (los que ya eligió), `cambio` (una oración) y `verificacion` (qué tiene que pasar: typecheck, un test nombrado, o los dos).
- El llamado de `buscar` / `reemplazar` recibe esas tres líneas junto con la propuesta y el contenido. Sigue devolviendo el mismo JSON de cambios. Sigue habiendo herramientas tipadas: no se abre una shell ni un bucle de edición.
- Esas tres líneas se guardan en `resumen` de la fila `fragua`, delante del resumen del diff, para que quien revisa vea el plan y el diff juntos.

**Qué no se toca.** No hay herramienta `update_plan` en el chat cotidiano. El merge de la Fragua sigue pidiendo ok humano. El herrero no gana bash, ni `read_file`, ni un loop de reintentos.

### 3. Aviso de estancamiento, una sola vez

**Hallazgo.** El paper deja fija la detección de estancamiento: a la quinta llamada idéntica inyecta un recordatorio, y a la octava falla idéntica corta. No la mide. Entra acá porque `MAX_VUELTAS` es 10: repetir la misma herramienta con los mismos argumentos gasta el presupuesto del turno.

**Archivo.** `src/chat/index.ts`, dentro de `bucle`, al ejecutar cada llamada. Test: dos llamadas iguales en el mismo turno agregan el recordatorio; la tercera corta con un texto distinto del corte por vueltas.

**Comportamiento.**

- Una llamada es igual a otra si coinciden el nombre de la herramienta y los argumentos ya normalizados (el JSON parseado y vuelto a serializar con las claves ordenadas).
- La primera repetición de esa firma, en el mismo turno, ejecuta igual y le agrega al resultado un recordatorio, una sola vez por racha:

  `Ya llamaste a {herramienta} con estos argumentos y el resultado está arriba. No la repitas: cambiá el argumento o seguí con otro paso.`

- La segunda repetición de la misma racha no llama a la herramienta. Corta el turno con un mensaje corto del estilo «Paré porque la misma herramienta se repitió con los mismos argumentos» y lo guarda como asistente. No espera a la vuelta 10.
- Una firma distinta reinicia la racha. El recordatorio no se repite en cada vuelta.
- Errores de herramienta inexistente o de validación cuentan para la racha igual que un resultado normal: repetir el mismo error no es progreso.

**Qué no se toca.** `MAX_VUELTAS` sigue en 10 para un turno que sí avanza. El recordatorio no se escribe en la pantalla como si fuera prosa de Mastropiero: viaja en el contenido que ve el modelo. Entre turnos no se arrastra la racha.

### 4. Diagnóstico al editar en La Fragua

**Hallazgo.** En el harness del paper, después de editar un archivo soportado corre un chequeo rápido y el hallazgo vuelve en el resultado de la herramienta, antes de gastar un turno en la suite. Ellos lo dejan fijo en todas las ablaciones. En la Fragua el typecheck ya corre, pero recién al final de `verificarDefecto`, mezclado con el filtro de la suite, y el diff no dice qué rompió.

**Archivo.** `src/fragua.ts`: `verificarDefecto` y el cierre de `forjarMejora`. Test: un cambio que no compila deja `estado = 'rota'`, `salida` con archivo y mensaje del compilador, y la suite no llega a correr.

**Comportamiento.**

- Después de `aplicarCambios` y antes de `node --test`, correr `tsc -p tsconfig.json` en el worktree.
- Si `tsc` falla, no correr la suite. `estado` queda `rota`. `salida` empieza con las líneas de error del compilador (archivo, línea, mensaje), sin el recorte actual que se queda solo con líneas que matchean `error|fail`.
- El diff de git se guarda igual, para ver qué se escribió. `salida` es lo que dice por qué no verifica.
- Si `tsc` pasa, la suite corre como ahora.

**Qué no se toca.** No hay un segundo llamado al modelo para corregir solo. La rama queda para revisar o descartar. Main no se entera hasta el ok desde la pantalla, y después hay que reiniciar el servidor, como ya dice el módulo.

## Prioridad

| Orden | Cambio | Por qué primero |
| --- | --- | --- |
| 1 | Elisión por etapas en el chat | Es el cuello real: hoy se tiran turnos del operador. Es la pieza que el paper encuentra más sensible al presupuesto, y el presupuesto de acá es el historial, no la ventana de un millón. |
| 2 | Plan solo en encargos largos | Los modelos de la cadena son del lado flojo, donde el plan sostiene la corrida. Acotado a run, Fragua e ingesta, el costo no se paga en cada charla. |
| 3 | Aviso de estancamiento | Barato y local al bucle. Protege las 10 vueltas. El paper no lo mide; por eso va después de las dos piezas que sí midió. |
| 4 | Diagnóstico de `tsc` en la Fragua | El herrero ya verifica al final. Adelantar el error y mostrarlo junto al diff mejora la revisión humana. No cambia la tasa de éxito del modelo, porque no hay reintento. |

## Criterio para no seguir

Un cambio entra en esta lista si se cumple lo siguiente.

- El paper lo midió, o es una pieza que el paper dejó fija y que el tope de 10 vueltas o la revisión humana hacen cara.
- El modelo de destino es la cadena flash, un encargo de Deprocast (charla, run, ingesta, Fragua) y un presupuesto chico de vueltas. Si la pieza solo rinde en un modelo fuerte con shell y 300 pasos, queda afuera.
- Se puede implementar en los archivos de arriba sin un almacén nuevo, sin bash y sin auto-merge.

Si más adelante la cadena pasa a un modelo con buena shell y las corridas de la Fragua se vuelven largas, se reabre la pregunta de bash solo. Hasta entonces el juego tipado se queda.
