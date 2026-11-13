# Integrar un proyecto con AIDP

Desk consume agentes desplegados en Oracle AI Data Platform. El repositorio del
agente mantiene su código, herramientas, modelos y publicación. No necesita
incorporar la interfaz de Desk a su implementación.

## Elegir el nivel de integración

| Entrega del agente | Experiencia en Desk |
| --- | --- |
| Texto de asistente nativo en PROD | Markdown completo al finalizar; sin fuentes ni métricas inventadas |
| Protocolo público v2 compatible | Eventos, resultados, evidencias, artefactos y respuesta canónica |
| Paquetes de texto incremental v2 | Texto visible conforme llegan los deltas |
| Capacidades opcionales v1 | Actividades independientes y análisis por contenido/comentarios |
| Comandos `replay` y `cancel` | Recuperación y cancelación de la misma solicitud, según la implementación del agente |

El adaptador enriquecido reconoce literalmente `protocol: ai-market-intelligence`
y `version: 2.0`. Su nombre no implica que Desk realice análisis comercial. Para
otro proyecto, adopta este contrato compatible o implementa y valida un adaptador
explícito. No hay negociación universal de protocolos.

## Preparar el Agent Flow

1. Despliega el agente con las herramientas de su proyecto. Para PROD necesita un
   endpoint de chat publicado y accesible mediante el perfil OCI del operador.
2. Haz que interprete el comando JSON que Desk incluye en el `INPUT_TEXT` del
   mensaje nativo. No recibirá únicamente la pregunta como texto plano.
3. Elige texto simple o el contrato enriquecido. Mantén la responsabilidad de
   mensajes, análisis, fuentes y límites en el agente.
4. Comprueba el contrato con fixtures y después con una consulta acotada al
   despliegue servido. Conserva la identidad de solicitud para recuperación.
5. Configura el perfil en Desk y verifica la representación con datos propios del
   dominio. En modo Oracle, asigna ese perfil a las identidades habilitadas.

Para TEST, Desk necesita un agente CODE con un despliegue TEST ACTIVE compatible
con el compute y endpoint seleccionados. Crea y verifica su sesión nativa; no
actualiza el despliegue. Una revisión TEST nueva requiere una conversación nueva.
TEST está disponible en modo local y para administradores autenticados con Oracle. Los miembros sólo pueden usar PROD.

## Entrada del agente

La investigación recibe un JSON serializado dentro de `INPUT_TEXT`:

```json
{"request_id":"req-001","question":"Resume los documentos del proyecto"}
```

Recuperación y cancelación conservan el mismo `request_id` y la misma sesión:

```json
{"request_id":"req-001","action":"replay","after_sequence":4}
```

```json
{"request_id":"req-001","action":"cancel"}
```

La solicitud del navegador a `/api/desk/stream` además contiene un `profile_id`
guardado, un `session_id` estable y `question` de 1 a 500 caracteres, incluso para
replay/cancel. La pregunta no se añade al comando nativo de replay/cancel. Los IDs
de solicitud y sesión admiten letras ASCII, números, guion y guion bajo, hasta
128 caracteres. En modo Oracle, el backend traduce los IDs al ámbito del usuario.
Consulta la API exportada en [OpenAPI](../contracts/openapi.json).

## Salida y streaming

El gateway entrega SSE nativo de AIDP. Los paquetes públicos enriquecidos viajan
como líneas NDJSON dentro de `assistant.content` de tipo `output_text`. Desk los
extrae en backend y entrega NDJSON al navegador. Cada línea debe terminar con un
salto de línea y comenzar con la propiedad `protocol`; el reconocedor actual
espera `{"protocol"` después del espacio inicial.

Respuesta pública mínima:

```json
{"protocol":"ai-market-intelligence","version":"2.0","kind":"response","request_id":"req-001","response":{"status":"completed","markdown":"## Resultado\n\nRespuesta del agente.","references":[],"artifacts":[]}}
```

El salto final de la línea no se ve en el bloque de ejemplo: el productor debe
añadirlo al serializar. No envíes NDJSON crudo en sustitución del SSE que espera
el adaptador del gateway.

Los tipos públicos admitidos son `event`, `text`, `snapshot`, `heartbeat` y
`response`. Los eventos tienen identidad inmutable, secuencia positiva continua
y `turn_id` de la solicitud. Las revisiones y las evidencias citadas deben ser
consistentes. Un hueco de secuencia exige recuperación, no una respuesta mezclada.

El agente debe emitir deltas mientras genera texto para obtener streaming real.
Los paquetes `text` usan `start`, `delta`, `end` y `discard`, con identidad de
stream, bloque y revisión. Un `end` provisional no es aceptación canónica;
`run.completed.text` y la respuesta final determinan el contenido aceptado.
`partial` cierra una ejecución con límites, no demuestra una investigación completa.

La [fixture sintética de presentación](../frontend/src/features/desk/fixtures/presentation-v1.ndjson)
incluye actividades, deltas, descarte, revisión y cierre parcial. Los validadores
en `aidp.ts`, `liveText.ts` y `presentation.ts` son la autoridad del consumidor;
OpenAPI no describe por sí solo todos los paquetes del stream.

## Proceso, contenido y comentarios

`coverage.presentation` v1 declara el propósito del evento y, opcionalmente, una
actividad con ID estable. Varias actividades de una fuente conservan identidades
distintas. Con esta capacidad Desk representa el texto recibido sin sustituir
frases; el agente decide cómo describir búsqueda, análisis y falta de resultados.
El proceso agrupa los encabezados por identidad de fuente y conserva dentro de
cada grupo las actividades, sus estados y los textos recibidos. La repetición de
una fuente no demuestra por sí sola que se repitió una búsqueda: para comprobarlo
se deben contrastar los IDs de actividad y operación con las ejecuciones del agente.

El bloque reservado `consolidated` alimenta la respuesta del chat; no genera otra
tarjeta de fuente. Los bloques propios de una fuente conservan su representación
también cuando el productor entrega una revisión `draft.compacted`.

En una respuesta `failed`, el objeto `failure` con `stage` y `error_type` no vacíos
identifica un cierre operativo. Desk conserva el paquete original, pero no usa su
Markdown como respuesta factual ni como texto para voz; muestra el aviso de fallo
de la solicitud. Sin esa señal reconocida, no elimina hechos parciales por buscar
frases de error. `resumable` controla por separado la recuperación de la solicitud.

`content_items` v1 relaciona cada contenido con su evidencia primaria, revisiones,
síntesis y base analizada. Puede incluir `comments_analysis` con padre explícito,
conteo, evidencia, resumen y limitaciones. Los comentarios originales llevan sus
propios autores y texto, asociados al padre; no deben enviarse como publicaciones
independientes. La [fixture de contenido](../frontend/src/features/desk/fixtures/content-items-v1.json)
muestra la estructura aceptada.

La colección y su manifiesto se validan contra el historial del turno antes de
proyectar las tarjetas. Una revisión rechazada conserva los datos aceptados;
una colección sin cambios admite nuevas referencias válidas. Los enlaces de
fuentes públicas conservan sus fragmentos; las URLs de medios mantienen sus
restricciones independientes.

En modo Oracle, la traducción de correlación incluye los inventarios de bloques
y actividades del snapshot. En TEST, una nueva invocación de continuación sólo
se autoriza con la señal de seguridad del agente o tras recuperar un snapshot
admitido. Puede emitir nuevos streams provisionales; las identidades retiradas
permanecen descartadas.

Entrega las URLs HTTPS de medios y sus roles explícitos. Que una publicación
contenga un video no garantiza que el proveedor entregue una miniatura válida.
No inventes imágenes, autores ni comentarios para completar la tarjeta. Si no se
recopilaron comentarios, conserva ese estado y no declares una muestra analizada.

## Verificación en el proyecto del agente

### Capacidad de informe por tarea

Desk persiste tareas, versiones, plantillas y ejecuciones en SQLite privada del
servidor. El administrador habilita informes por Agent Flow guardado y superficie
en Configuración, o desde el aviso de Nueva tarea. Debe comprobar antes que el
productor acepta `delivery.mode=report` y entrega el esquema 1.0; este ajuste es
una declaración del administrador, no una prueba automática de compatibilidad.
PROD y TEST se habilitan por separado. TEST sigue restringido a administradores.
El ajuste se conserva en `<directorio privado>/<id>/reports.json`, sin reinicios.
Los endpoints GET/PUT `/api/desk/profiles/{id}/reports` requieren administración;
PUT recibe `{"prod":true,"test":false}`. Deshabilitar una superficie revoca su uso.

`AGENT_DESK_REPORT_PROFILES` se conserva como configuración heredada: `<id>` para
PROD y `test:<id>` para TEST. Un ajuste persistido prevalece, incluso si deshabilita
ambas superficies. Los IDs se generan al guardar agentes y no pueden conocerse
al desplegar una VM vacía. El nombre del agente, su disponibilidad o una prueba
TEST no habilitan PROD. Cada resultado sigue pasando las validaciones del informe.
Otros agentes pueden continuar usando el chat sin informes.

Entrada de investigación (sin campos adicionales dentro de `delivery`):

```json
{"request_id":"run-001","question":"Investigar el mercado solicitado","delivery":{"mode":"report","task_id":"task-001","task_run_id":"run-001","template":{"template_id":"market","version":1,"sections":[{"section_id":"summary","title":"Resumen ejecutivo","visibility":"always"}]}}}
```

`question` tiene entre 1 y 500 caracteres; el comando de informe serializado admite
hasta 65536 bytes UTF-8. La primera ejecución omite `template`; la primera respuesta
válida fija el contrato de secciones. La plantilla debe describir secciones
opcionales aunque la muestra inicial no tenga datos. Las siguientes ejecuciones
reciben esa misma plantilla; editar su presentación crea una versión sin investigar.

`response.report` opcional usa el [esquema v1.0](../contracts/report-v1.schema.json).
El protocolo exterior, Markdown, referencias y artefactos se conservan. El consumidor
acepta respuestas terminales `complete`, `completed` y `partial`; SQLite normaliza
las dos primeras a `completed`. Un cierre parcial no acredita cobertura completa.

El núcleo contiene IDs de informe/tarea/ejecución, título, plantilla versionada,
secciones Markdown con evidencias y limitaciones. `source_request_id` identifica
una investigación original, sin autorizar acceso a otro usuario o agente. Desk
verifica la procedencia conocida o elimina el ID y registra esa limitación. El
periodo admite `[start,end)` por defecto y `[start,end]` para evidencia existente
con final inclusivo; no se amplía sumando segundos. Se validan calendario, orden
y zona horaria.

Las secciones siguen el orden de la plantilla y sólo citan evidencias de las
referencias finales. Las `always` deben estar presentes; las `when_present` pueden
faltar. La descarga conserva estado, procedencia, periodo, análisis y limitaciones.
Una versión desconocida o un informe inválido conserva Markdown con aviso.

Las extensiones opcionales [métricas](../contracts/extensions/market-platform-metrics-v1.schema.json)
y [sentimiento](../contracts/extensions/market-sentiment-v1.schema.json) se validan
por separado: unidad, población, denominador, objetivo/aspecto y evidencias. No se
infiere neutralidad de muestras vacías ni precisión de un modelo sin calibración.
`query_operations` cuenta intentos registrados de consulta: `started` incluye
rechazos previos a crear un run; `completed` y `failed` clasifican esa misma
población. Si la contabilidad es verificable, su suma no puede superar `started`;
los estados inciertos conservan `null`. No son contadores de runs creados.
La fixture sintética `query-rejections.json`, generada por el productor corregido
sin cloud, comprueba dos rechazos con 2 intentos, 0 completados, 2 fallidos y
muestra desconocida; no sustituye una ejecución nativa ni reescribe sus resultados.
La fixture `market-producer-response.json` es salida sintética del adaptador del
productor, SHA-256 `077b1991f866bf01690cee752920ef843123266be4936945c4cb7993e5efa714`;
prueba compatibilidad offline, no disponibilidad cloud. Las fixtures de mercado
vacío/abundante comparten plantilla; gobierno demuestra el núcleo sin sentimiento.

El renderer React oficial A2UI 0.15.0 utiliza wire v0.9 con el catálogo local
`https://agent-desk.local/catalogs/report/1.0.json`. La versión del informe 1.0 es
independiente. Desk genera el árbol determinista desde datos aceptados: no ejecuta
HTML, scripts, acciones ni catálogos remotos recibidos del productor. Markdown y
los datos originales persisten para permitir abrir informes sin ese renderer.

La recuperación manual conserva tarea, versión, sesión e IDs y empieza con replay.
Un snapshot se valida por identidad, cursor e inventarios antes de aceptar su
respuesta final; un replay incremental desde cero requiere secuencias contiguas.
El informe recuperado pasa la misma validación de informe, plantilla y evidencias
que una entrega original. Un snapshot sin resultado no autoriza investigación
por sí solo. La capacidad opcional `execution` sólo permite continuar si declara
`schema_version:"1.0"`,
estado `interrupted`/`waiting`, `owner_held:false` y `continuation_safe:true`, con
booleanos estrictos y la identidad del replay validada. Un registro antiguo o
`running`/`unknown` no aporta esa autorización. El productor es responsable del
fence, conciliación de efectos y declaración; Desk nunca deduce elegibilidad.
Tanto en PROD como en TEST, únicamente pending
con `continuation_safe=true` e identidad pendiente ausente o igual a la propia
permite repetir el mismo comando hasta dos veces. Se conserva incluso la ausencia
de plantilla. Una identidad ajena, transporte fallido o estado incierto interrumpe
la ejecución sin aceptar hechos ni fijar plantilla. No existe un worker remoto
implícito: `running` y `response:null` no demuestran que el grafo siga activo.
La entrega de tareas admite hasta 30 minutos por transporte; el chat conserva
su límite de 10 minutos. Una interrupción de transporte requiere recuperar la
misma solicitud; no se crea otra investigación por recarga o selección de tarjeta.
El progreso público se conserva como proyección acotada en el control JSON del
run existente (hasta 200 actividades, texto de 2000 caracteres). Sólo el detalle
autorizado lo expone; el listado omite el contenido. No cambia el esquema SQLite.
Los fallos y paradas conservan actividad sin aceptar hechos de un informe inválido.
El reinicio marca trabajos
activos como interrumpidos; no los repite automáticamente.

Verifica la entrada JSON, el texto simple si lo utilizas, Markdown, secuencias,
revisiones, cierre parcial, recuperación y cancelación. Para contenido enriquecido,
comprueba que cada selección del carrusel corresponde a su publicación, evidencia
y comentarios. Para otro dominio, comprueba también las etiquetas de fuente.

Una fixture prueba compatibilidad de estructura, no disponibilidad de AIDP. Una
consulta nativa prueba ese despliegue y sus datos, no todas las fuentes. Distingue
los límites del proveedor de los errores de transporte y conserva evidencia
privada fuera del repositorio público.

### Editor visual compatible con report/1.0

El editor conserva template.sections con section_id/title/visibility. La vista
previa proyecta los datos guardados: Markdown/GFM, tablas y barras de extensiones
validadas, más imágenes directas o enlaces a medios de página. Las cantidades null
no se convierten en cero y sentimiento insuficiente no crea una distribución.
El adaptador de mercado vincula sus secciones metrics/sentiment a esas vistas para
que tablas/gráficos sigan su orden, sin duplicarlas como apéndices. Otros informes
conservan las secciones genéricas y sus capacidades opcionales.

AI Market Intelligence 1 confirmó por código/evidencia existente que el productor
actual rechaza campos extra en template.sections. Seleccionar libremente tipos de
bloque del productor requeriría negociar una capacidad versionada y bindings
tipados a datos/evidencias. Desk guarda ahora su propia presentación opcional,
schema_version 1.0, con rows de uno o dos section_ids existentes, cada sección
exactamente una vez. Es metadato de la versión de tarea, fuera de report/1.0 y
del delivery enviado al agente; no añade tipos ni campos al contrato del productor.
GET/PUT de plantilla y ScheduledRun.presentation permiten reabrir distribución
actual/histórica sin investigar ni publicar. SQLite conserva ese metadato en
presentations con FK(owner,task_id,version); versiones previas sin layout siguen
mostrando una columna. El esquema 3 añade la tabla y conserva tareas/ejecuciones.

El mismo esquema añade hidden_reports con FK al ledger por propietario/tarea/run.
DELETE /scheduled-tasks/{task}/runs/{run}/report oculta sólo completed/partial;
POST al mismo recurso con /restore lo restaura. Devuelven 204, verifican permisos
actuales e históricos y no invocan AIDP. La respuesta y claves de ocurrencia siguen
guardadas; el historial público omite tombstones y el detalle devuelve 404.
