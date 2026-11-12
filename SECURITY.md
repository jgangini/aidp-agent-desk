# Seguridad y alcance de despliegue

El modo local de Agent Desk está diseñado para una persona en su equipo. Compose publica sólo 127.0.0.1:8317, usa un usuario sin privilegios, filesystem de sólo lectura, capacidades retiradas y volumen privado para credenciales. No cambies la publicación del puerto a 0.0.0.0 como sustituto de un diseño de autenticación.

El control de Origin exacto más X-Agent-Desk protege operaciones desde el navegador local frente a solicitudes cross-origin. No autentica clientes arbitrarios de red. Una exposición compartida necesita autenticación y autorización verificadas, aislamiento por usuario, límites operativos, TLS y revisión de custodia de secretos.

Config OCI y claves PEM se guardan en el backend local, no en el navegador. Los datos no están cifrados en reposo por la aplicación: protege el host, copias y volumen. Los permisos cloud del perfil deben ser los mínimos necesarios. Las consultas y el audio pueden salir a los servicios AIDP/OCI elegidos; la demo no realiza investigación real.

No incluyas secretos, archivos .env privados, claves, dumps, capturas, historiales ni evidencia de ejecución en commits o issues. Los lockfiles y ejemplos sin secretos sí son publicables. `python scripts/check-publication.py` detecta rutas prohibidas y algunos patrones de secretos; no sustituye una revisión humana ni el escaneo de secretos de GitHub.

Para comunicar un posible problema, proporciona una reproducción saneada y las versiones afectadas al mantenedor. Nunca publiques credenciales ni datos de conversaciones en un issue. Este repositorio todavía no declara una política de versiones con soporte ni una auditoría de seguridad exhaustiva.

## Tareas e informes

La API deriva el propietario de la sesión, comprueba permisos del agente al
guardar, ejecutar y leer, y vuelve a comprobar el agente histórico de cada versión.
La tarea y sus ejecuciones usan relaciones compuestas en SQLite privado; un ID
del navegador nunca concede acceso a otra cuenta. Las mutaciones conservan Origin
exacto, cabecera propia y límite temprano de 32 KiB. Las respuestas no se cachean.
La fixture de navegador admite su puerto 8320 sólo dentro de su proceso aislado
y exige un directorio de datos bajo `.cache`; no amplía los orígenes del producto.

El permiso cloud del servidor es compartido: el scheduler verifica al propietario
antes de invocar y deriva sesiones distintas por propietario/tarea/versión. La
capacidad `AGENT_DESK_REPORT_PROFILES` es opt-in por destino verificado, con TEST
separado de PROD y restringido a modo local o administradores Oracle. Esta opción no añade permisos cloud y no certifica un
candidato. Revocar un permiso impide próximas invocaciones y lecturas; no revoca
por sí solo una operación que el proveedor ya haya aceptado.

Un informe recibido no ejecuta código. Sus referencias y estructura se validan
antes de mostrarse. El renderer A2UI recibe únicamente una proyección acotada del
catálogo local; el Markdown usa react-markdown con HTML omitido. Las extensiones
desconocidas se conservan como datos, sin representar métricas ni acciones.

El SDK 0.15.0 requiere Zod 3, cuya auditoría npm mantiene un aviso de agotamiento de
memoria al validar colecciones excesivas (GHSA-mrhx-c7xc-m3w5). Desk limita antes de
Zod profundidad, claves, longitud de arrays, nodos y tamaño del JSON; el SDK recibe
sólo componentes generados localmente a partir de datos admitidos. Los controles
tienen regresiones de entrada excesiva. Se fija DOMPurify 3.4.17 para corregir los
avisos de su dependencia transitiva; el visor utiliza su propio renderer React de
Markdown. No se fuerza Zod 4 contra los peer dependencies del SDK. La actualización
a una versión oficialmente compatible y corregida es la vía de retirar la
mitigación; un audit con avisos no se informa como cero vulnerabilidades.

## Modo Oracle

`AGENT_DESK_AUTH_MODE=oracle` exige issuer HTTPS, cliente OIDC, secreto de sesión estable, origen público HTTPS y `sub` del administrador. La aplicación falla al arrancar si faltan. Authlib valida estado, nonce, firma, issuer y audiencia; código y tokens de Oracle nunca se guardan en el navegador. Una sesión propia opaca de ocho horas se guarda sólo como hash en SQLite y usa cookie Secure/HttpOnly/SameSite=Lax. Logout revoca la sesión de Desk y borra el estado OIDC pendiente, sin cerrar otras aplicaciones Oracle. El acceso no recibe correos ni credenciales en Desk: redirige a Oracle con `prompt=login` fijado por el servidor para solicitar autenticación, incluso con SSO activo. Oracle y su proveedor federado aplican sus políticas de acceso; no se garantiza un nuevo desafío MFA. Al cambiar el administrador configurado se deshabilita al anterior y se revocan sus sesiones.

El ensayo local de SSO admite HTTP únicamente en loopback con `AGENT_DESK_ALLOW_LOOPBACK_HTTP=1` y cookies locales separadas. No habilitarlo en una exposición compartida. La imagen no registra access logs de Uvicorn para evitar persistir el código OAuth de la URL de callback; cualquier proxy adicional debe omitir sus parámetros. Las claves públicas Oracle restringidas se obtienen mediante una lectura OCI firmada y acotada al dominio configurado; no se modifica la política global del tenant.

Con `AGENT_DESK_MANAGED_CONNECTION=1`, los archivos base y el compartimento del servidor son autoritativos. Se rechaza su sustitución por API y se excluyen los perfiles de otra identidad o compartimento sin borrar sus archivos. Los secretos se montan de sólo lectura y permanecen fuera de la imagen. En login con directorio la aplicación Oracle debe emitir `sub=userName`: después de verificar el token, Desk resuelve la cuenta activa y vincula permisos a su ID SCIM. No equipara ese ID con el OCID ni con el subject recibido.

El servidor comprueba rol/permisos, origen y cabecera de identidad esperada. Cambiar de cuenta en otra pestaña no permite enviar solicitudes con la identidad anterior. La configuración OCI es compartida y administrada por el operador; un permiso sobre un agente habilita usar sus credenciales del servidor, por lo que debe concederse deliberadamente. Crear usuarios está deshabilitado por defecto. Sólo con la capacidad habilitada en servidor, una acción explícita del administrador y permisos del operador en el dominio se crean/activan cuentas Oracle; nunca se otorgan roles IAM o AIDP. El correo sólo permite buscar una cuenta activa inequívoca, no autenticarla. Deshabilitar acceso en Desk revoca sus sesiones; una baja sólo en Oracle se aplica al próximo login y debe acompañarse de baja en Desk para revocación inmediata.

El despliegue propuesto recibe un sobre cifrado de un solo uso en Object Storage, valida usuario/huella y lo elimina despues de instalar archivos privados; no depende de Vault. El operador custodia la política, la VM, el disco y las copias de `access.sqlite3` y los perfiles. No hay alta disponibilidad, cuotas por usuario, auditoría completa de administración ni cifrado adicional de la base por la aplicación. La imagen y Terraform se validan localmente; esto no acredita una prueba de SSO o un despliegue real. Véanse [amenazas](docs/agent-desk-threat-model.md) y [operación](docs/deployment.md).

La revalidación al recuperar foco se realiza en segundo plano, con una única
petición pendiente, para no ocultar el control entre pointerdown y click. La
última vista verificada permanece visible durante esa petición; puede mostrar
contenido ya cacheado hasta detectar un cambio de cuenta. El servidor sigue
validando cookie y principal X-Agent-Desk-User en cada operación; una discrepancia
409 o un cambio de identidad fuerzan recarga. Si la comprobación falla, un estado
dedicado bloquea la vista hasta que vuelva a verificarse. La carga inicial sigue
bloqueada y los errores de logout no se usan como errores de revalidación.

Los administradores Oracle pueden descubrir e invocar TEST; los miembros siguen
recibiendo sólo PROD y no reciben metadatos de desarrollo. El servidor comprueba
el rol en la superficie efectiva, incluido un perfil guardado TEST enviado como
PROD. TEST utiliza namespace test:<profile> para correlación y superficie TEST en
el HMAC de sesión; PROD conserva su material y filas históricos. Las tareas TEST
exigen propietario habilitado y administrador en cada lectura/ejecución, además
del destino explícito AGENT_DESK_REPORT_PROFILES. Habilitar TEST no habilita PROD.

El visor de informes conserva su representación ante fallos temporales de red,
mostrando el error aparte, y sigue revalidando acceso con peticiones serializadas.
Una denegación 401/403/404/409 retira el informe; el evento de cambio de sesión lo
retira inmediatamente y cancela peticiones pendientes. No hay consultas AIDP en
esa actualización del visor. La vista previa reutiliza sólo el informe validado:
no acepta código, URLs libres ni campos de plantilla fuera del contrato vigente.
Los medios delivery=page se enlazan; únicamente imágenes directas se incrustan.

La presentación en columnas es metadato de Desk por propietario/tarea/versión,
validado como filas de uno o dos IDs sin duplicados y con cobertura exacta de la
plantilla. No acepta HTML/CSS ni se envía al agente. Su guardado comparte la
transacción y control expectedVersion de la plantilla. Lecturas de versiones
históricas comprueban permiso actual e histórico del agente. Abrir el último
informe consulta historiales autorizados, con cancelación ante selección manual,
cierre o cambio de sesión; no ejecuta tareas. La denegación del visor también
retira el editor integrado y sus datos de vista previa.

Eliminar un informe crea un tombstone por propietario/tarea/ejecución. Los listados
lo omiten y el detalle responde 404; Deshacer vuelve a comprobar agente actual e
histórico y restaura la misma respuesta. Sólo admite completed/partial. Conserva
el ledger y la unicidad de ocurrencia: no vuelve a ejecutar la investigación ni
libera su clave de idempotencia. Eliminar una tarea es una acción distinta.

La receta pública crea una red propia sin SSH, sirve la aplicación sólo por HTTPS
sobre su IP pública y valida certificados CA para esa IP. HTTP se limita a ACME
y redirección tras activar TLS. La renovación valida cadena, SAN, vigencia y
clave antes de recargar Caddy y restaura la configuración anterior si falla.
El callback Oracle debe coincidir exactamente con el output de la VM; no se
relaja MFA, validación TLS ni el control de sesiones. Las credenciales del operador
siguen fuera del ZIP Terraform, user-data y state; se entregan cifradas una vez.
