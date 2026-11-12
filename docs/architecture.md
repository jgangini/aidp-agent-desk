# Arquitectura

Agent Desk separa la interfaz de conversación del proyecto que implementa el Agent
Flow. La investigación, las herramientas, los resúmenes por contenido y la síntesis
son responsabilidad del agente. Desk custodia la conexión OCI, valida la entrega y
representa lo recibido.

## Componentes

| Componente | Responsabilidad | Código |
| --- | --- | --- |
| React y TypeScript | Conversaciones, Markdown, proceso, resultados, voz, tareas y visor A2UI | `frontend/src/features/desk` |
| FastAPI | Configuración, descubrimiento AIDP, transporte firmado y audio | `backend/app/features/desk` |
| Identidad Oracle | Login OIDC, claves de firma, sesiones y permisos por agente | `backend/app/core/access.py`, `identity.py`, `oracle_keys.py`, `access_store.py` |
| Directorio Oracle | Resolver cuentas activas y crear/activar cuentas sólo si la instalación lo habilita | `backend/app/core/directory.py` |
| Almacén de perfiles | Config OCI, clave PEM y metadatos privados por perfil | `backend/app/features/desk/credentials.py` |
| Agent Flow | Ejecución de herramientas, análisis, evidencia y respuesta | Proyecto externo del agente en AIDP |
| OCI Speech | Transcripción y síntesis de voz configuradas | Adaptadores de audio del backend |

FastAPI sirve los assets compilados de React en la imagen de producción. Durante
desarrollo, Vite sirve la interfaz y reenvía `/api` al backend. OpenAPI describe la
API HTTP; el contrato de paquetes de streaming se valida por separado.

El cliente Oracle de esta receta emite `sub=userName`. Después de validar el ID
token, el backend resuelve ese nombre en el dominio configurado y utiliza
`directory:<id SCIM>` para los permisos. Un nombre reutilizado no hereda los
permisos de la cuenta eliminada. La selección del administrador en Deploy Studio
usa OCID y se comprueba contra el dominio antes de entregar su ID SCIM al servidor.
Los identificadores SCIM, OCID y OIDC no se consideran intercambiables.

`UsersPanel`, compartido, sólo consume la API administrativa. `Desk` decide dónde
mostrarlo y conserva montados chat y resultados. La API valida rol, origen,
identidad de sesión y perfiles publicados antes de consultar el directorio.
SQLite conserva habilitación y permisos del portal; Oracle conserva identidades,
autenticación, activación y MFA. Crear cuentas es una capacidad del servidor
deshabilitada por defecto y no depende de ocultar un control en la interfaz.

`Chat` coordina el runtime de conversación. `ChatHeader` posee la navegación,
el historial, el título y el acceso a configuración y cuenta; comprueba el rol
administrador para habilitar su control de configuración. `useChatVoiceAdapters`
selecciona los adaptadores de audio. `chatContext.ts` entrega el estado y las
acciones de feedback y regeneración a los mensajes, sin importar el motor de
demostración desde sus componentes de representación. El compositor sincroniza
el borrador por conversación y cancela la voz al cambiar de contexto.

En el consumidor, `publicManifest.ts` define artefactos y valida referencias sin depender
del estado de streaming. `aidp.ts` restaura snapshots y aplica eventos; `liveText.ts`
valida los fragmentos antes de modificar el estado provisional. `deskHttp.ts`
comparte la cabecera de las operaciones de Desk sin acoplar voz al transporte de
investigación. `ChatMessages.tsx` representa los mensajes y mantiene esa
responsabilidad fuera del coordinador de conversación. El carrusel de resultados
separa selección de publicación, navegación, vista previa y análisis, conservando
la identidad seleccionada cuando llega nueva evidencia. `Results` coordina
búsqueda y expansión; la medición de filas y los efectos de disposición tienen
su propio ciclo de observación y limpieza. Las animaciones de disposición no
transforman el carrusel.

`snapshot.ts` valida y restaura el estado público sin acceder al almacenamiento.
`chatStorage.ts` gestiona lectura, escritura y avisos de almacenamiento por
identidad. Tanto el motor de demostración como el consumidor remoto usan la misma
validación. La aceptación de contenidos distingue una colección admitida de una
colección rechazada; conservar el estado anterior no implica admitir su nuevo
manifiesto de referencias.

`AgentConfig` mantiene el ciclo de vida y el estado de edición. Sus paneles
representan cada sección; `configurationDraft.ts` valida, serializa y recupera
el borrador, y `credentialFiles.ts` valida archivos antes de cargarlos. Los hooks
de campos, pasos y panel separan validación visible, restauración, guardado y
cancelación. Las respuestas de operaciones abortadas no actualizan el panel.
El servidor declara si la conexión es administrada: en ese modo desaparece Conexión
y la selección utiliza las credenciales y el compartimento entregados al desplegar.
Los perfiles incompatibles se conservan en disco para rollback pero quedan fuera
del catálogo y de las invocaciones permitidas.
La restauración conserva los catálogos ya comprobados si falla un paso posterior;
sus avisos pertenecen a esa restauración. La
validación de tareas distingue descripción, calendario, recurrencia y metadatos
antes de permitir que se escriba el almacenamiento del navegador.

En el backend, el transporte separa la construcción de la invocación, la
validación HTTP y la decodificación de paquetes. La cancelación y el cierre
del stream siguen bajo una sola instancia de `AgentTransport`. El guardado
de configuración distingue conexión, agentes y audio; conserva la reversión
de perfiles si falla el guardado del borrador. Cada petición de guardado tiene
una instancia de `DraftWriter`; la comprobación OCI y la escritura se ejecutan
en el thread pool del servidor.

La captura de dictado mantiene un propietario por sesión para el transporte,
micrófono, grabador, analizador y temporizador. Parar o cancelar invalida sus
operaciones pendientes y libera los recursos. La conversación de voz espera el
fin del TTS antes de volver a escuchar. El núcleo 3D consume una envolvente de
amplitud y color independiente del ciclo de captura.

## Recorrido de una consulta

1. El navegador envía el perfil, la conversación, una identidad estable de solicitud
   y la pregunta a `/api/desk/stream`.
2. El backend comprueba acceso y perfil, construye un destino AIDP permitido y
   firma la petición con las credenciales del servidor.
3. AIDP ejecuta el agente. El backend lee su SSE nativo y extrae los mensajes
   públicos de asistente; los logs privados no son contenido de la interfaz.
4. Desk entrega paquetes NDJSON al navegador. El consumidor valida identidad,
   secuencia, revisiones y capacidades antes de actualizar proceso y resultados.
5. El texto incremental se presenta mientras llega. La respuesta canónica y el
   estado final cierran el turno. Una recuperación conserva la solicitud original.

El stream tiene límites de tamaño y cantidad. Los eventos acumulativos se
deduplican; cambiar el contenido de una identidad inmutable o mezclar solicitudes
produce un rechazo. El [contrato AIDP](aidp-integration.md) explica los requisitos
del productor y los límites del modo de texto simple.

## Almacenamiento y fronteras

Las tareas pertenecen a un propietario derivado del modo local o de la sesión
Oracle. `scheduled_store.py` mantiene las relaciones compuestas
propietario/tarea/versión/ejecución y la unicidad de cada ocurrencia. Un hilo de
calendario encola slots independientemente del worker serial que invoca AIDP;
un bloqueo del sistema operativo evita un segundo planificador sobre la misma
base. La construcción del runtime y la exportación OpenAPI no abren esta base.
El ciclo de vida de FastAPI inicia y detiene los hilos. No hay scheduler distribuido
ni ejecución por temporizadores del navegador.

El agente produce el contenido experto y propone la plantilla en el contrato
`report/1.0`. Desk valida su pertenencia y plantilla, persiste la respuesta y
proyecta componentes de un catálogo A2UI local: columna, sección y análisis.
La implementación usa los SDK oficiales 0.15.0 con wire v0.9; esa versión es
independiente de `report.schema_version`. El paquete publicado no expone el
renderer React v1.0 que anuncia la documentación web actual. No se aceptan árboles
A2UI arbitrarios, catálogos descargados, acciones remotas ni scripts del agente.

Los dominios se distinguen mediante extensiones opcionales, nunca por nombre de
agente. `reportExtensions.ts` valida forma, fuente/unidad de evidencia, subconjuntos
analizados, conteos y denominadores de mercado antes de proyectarlos. La exactitud
de una clasificación sigue siendo responsabilidad del productor y su calibración.
Un segundo dominio se comprueba con una fixture de gobierno sin extensiones de
mercado. Agentes sin `report` conservan el chat; las tareas requieren habilitación
explícita de la capacidad para el destino concreto.

| Dato | Ubicación | Duración y custodia |
| --- | --- | --- |
| Historial de chat | sessionStorage del navegador | Por pestaña e identidad; no es archivo durable |
| Preferencias y definiciones antiguas de tareas | Almacenamiento del navegador | Separado por identidad; importación explícita en pausa |
| Tareas, versiones, plantilla y ejecuciones | `scheduled.sqlite3` bajo el directorio privado de perfiles | Claves compuestas de propietario/tarea/versión y ledger de ocurrencias; informes durables |
| Perfiles OCI y borrador de configuración | Directorio privado del backend | Volumen persistente; no incluido en la imagen |
| Usuarios, permisos y sesiones Oracle | SQLite del backend | Una instancia, disco persistente y backups del operador |
| Mapeo de sesiones y solicitudes AIDP | Almacenamiento privado del backend | Aísla identidades del navegador y del runtime |
| Estado de investigación y replay | Implementación del agente | El agente define persistencia y semántica de recuperación |

La clave privada OCI no se envía al navegador. Las consultas y el audio sí salen
a los servicios configurados. La aplicación no cifra sus archivos de datos en
reposo; el operador protege el host, el volumen y las copias.

## Instalación local y compartida

Compose publica en loopback para una persona, con usuario sin privilegios,
filesystem de imagen de sólo lectura y volumen privado. Origin y una cabecera
local protegen las operaciones del navegador; no autentican clientes arbitrarios.

El modo Oracle añade OIDC, cookie de sesión opaca y permisos por perfil. Un
administrador habilita identidades existentes del tenant y les asigna agentes
publicados. El despliegue de una VM usa un proxy TLS y datos persistentes;
su preparación operativa está en [Despliegue](deployment.md). No hay soporte de
múltiples réplicas ni alta disponibilidad en esta arquitectura.

## Extensión para otros agentes

El texto simple de un Agent Flow PROD puede mostrarse al finalizar. La experiencia
enriquecida requiere el contrato compatible y sus capacidades opcionales. El
namespace público actual conserva el identificador `ai-market-intelligence`;
el soporte genérico de contratos AIDP arbitrarios no está implementado.

Los tipos de contenido permiten posts, videos, artículos, páginas, documentos y
registros. Las relaciones entre contenido, evidencias y comentarios deben venir
del agente. Algunas rutas legacy conservan convenciones de fuentes conocidas;
conectar otro dominio requiere comprobar su representación, no sólo la conexión.
