# Oracle login y Deploy Studio v2

Instalación para una VM y un tenant. Requiere preparar el dominio, el cliente
OIDC, la imagen por digest y las credenciales del operador. La creación de cuentas
Oracle es opcional y está deshabilitada por defecto. La receta no registra
automáticamente un catálogo de despliegue.

## Acceso Oracle

El administrador del dominio debe registrar una aplicación confidencial con grant
Authorization Code, PKCE S256 y scopes `openid profile email`. Registrar exactamente
`https://<IP-publica>/api/auth/callback` como redirect URI y habilitar la aplicación
para las identidades autorizadas. La contraseña y el MFA se introducen en Oracle,
nunca en Desk. Se usa Authlib para validar state, nonce, firma, issuer y audiencia.
[Flujo Oracle](https://docs.oracle.com/en-us/iaas/Content/Identity/api-getstarted/AuthCodeGT.htm),
[integración Authlib](https://docs.authlib.org/en/latest/oauth2/client/web/).

Configurar `AGENT_DESK_OIDC_DOMAIN` con la URL HTTPS del dominio del tenant.
La receta admite el puerto HTTPS predeterminado `:443` cuando Oracle lo incluye
en esa URL; rechaza puertos alternativos.
Discovery se consulta en ese dominio; el `issuer` exacto se obtiene del documento
verificado por HTTPS y se conserva, incluido su slash final. Oracle puede usar
`https://identity.oraclecloud.com/` como emisor compartido: no usarlo como dominio
de discovery. Los permisos permanecen vinculados al dominio del tenant.
[Discovery Oracle](https://docs.oracle.com/en/cloud/paas/identity-cloud/idcsa/op-well-known-openid-configuration-get.html).

Si el endpoint de claves de firma responde 401, Desk puede recuperarlas con una
petición OCI firmada usando los archivos base del servidor. La lectura se limita
a `/admin/v1/SigningCert/jwk` del mismo dominio HTTPS configurado, conserva la
validación de firma y no cambia la política global de acceso a certificados del
tenant. Requiere que el operador tenga permiso para esa lectura. Sin archivos
base o si falla esa petición, el login se rechaza. Los errores registran sólo
su clase; un subject no habilitado deja una huella SHA-256 truncada, sin tokens.

Configurar la aplicación Oracle para emitir `sub=userName`. Con
`AGENT_DESK_DIRECTORY_LOGIN=1`, Desk valida el ID token y consulta ese nombre en
el directorio del dominio; sus permisos se vinculan a `directory:<id SCIM>`.
No usar el correo del formulario como prueba de identidad ni equiparar SCIM,
OCID y subject OIDC. Un mapeo de subject personalizado no está soportado por este
modo y se rechaza si no puede resolverse. No se promueve al primer usuario que
inicia sesión.

Deploy Studio permite elegir un usuario activo del dominio como administrador.
Preflight comprueba su OCID y obtiene el ID SCIM; post-apply vuelve a comprobarlo
antes de instalar `ADMIN_SUBJECT=directory:<id SCIM>`. El dominio elegido y la
URL OIDC deben coincidir. El selector usa `oci_identity_domain_users` y requiere
una versión de CloudTechNext que admita ese contrato, sin depender de un AIDP nuevo.

El administrador habilita miembros por correo desde **Perfil → Usuarios** y
selecciona sus agentes publicados. El servidor exige una única cuenta activa
en Oracle y conserva su ID inmutable. Cambiar permisos revoca las sesiones del
usuario. Cambiar `ADMIN_SUBJECT` deshabilita al administrador anterior.

Las instalaciones anteriores pueden conservar `AGENT_DESK_DIRECTORY_LOGIN=0`
y el `sub` verificado configurado manualmente. Antes de convertir una instalación
existente, respaldar SQLite y migrar las vinculaciones comprobadas a ID SCIM
conservando sus IDs internos; no se infiere esa equivalencia por correo. Cambiar
el subject sin migración crea otra identidad de portal y otro namespace de historial.

El botón de perfil abre el acceso/cuenta. La aplicación local sigue disponible sin
SSO en loopback; el modo Oracle es obligatorio para la receta pública. Variables
privadas y rutas base: [.env.example](../.env.example). Nunca usar variables VITE
para secretos. El entorno debe inyectarse al proceso; `.env.example` no se carga
automáticamente. Ocho horas de sesión propia, con logout local a Desk. No cierra
la sesión global del dominio Oracle. Cada acceso se inicia con el botón Continuar con Oracle, sin correo local, y envía `prompt=login` para solicitar autenticación al dominio configurado. La identidad procede exclusivamente del ID token validado, no de datos escritos en Desk. La exigencia de MFA y el comportamiento del proveedor federado dependen de la política del tenant. [Parámetro OIDC](https://openid.net/specs/openid-connect-core-1_0.html#AuthRequest).

Para exigir Authenticator en cada acceso, asignar al cliente de Desk una política
de inicio de sesión propia, activada, con autenticación adicional obligatoria,
factores Mobile App Notification/Mobile App Passcode y frecuencia Every time.
Comprobar antes que PUSH/TOTP estén habilitados y que el usuario pueda enrolarse
o ya esté enrolado. `prompt=login` por sí solo no exige MFA. No modificar para
ello la política predeterminada ni la de OCI Console; la política de Console no
cubre automáticamente otras aplicaciones. La receta de despliegue no crea esta
política: debe configurarla el administrador del dominio y validar el desafío
real antes de habilitar más usuarios.
[Políticas de acceso Oracle](https://docs.oracle.com/en-us/iaas/Content/Identity/signonpolicies/add-sign-policy.htm).

Para probar el login real en Docker local se puede registrar exactamente
`http://127.0.0.1:8317/api/auth/callback` y permitir HTTP en ese cliente de desarrollo.
Con `AGENT_DESK_AUTH_MODE=oracle`, habilitar explícitamente
`AGENT_DESK_ALLOW_LOOPBACK_HTTP=1` y usar ese mismo origen en `PUBLIC_ORIGIN`.
La excepción sólo admite `127.0.0.1` o `localhost`; el dominio Oracle sigue siendo
HTTPS. Las cookies locales tienen nombres separados sin prefijo `__Host-`;
state, nonce, PKCE y validación del ID token siguen activos. En producción se
mantienen HTTPS y cookies Secure, sin habilitar esa excepción.
[Cliente confidencial Oracle](https://docs.oracle.com/en-us/iaas/Content/Identity/applications/add-confidential-application.htm).

La asignación de usuario en la aplicación Oracle permite autenticarlo; su acceso
a Desk requiere además la identidad habilitada en el portal. Desk no solicita un
correo local para iniciar sesión ni permite usarlo como prueba de identidad.

### Crear usuarios

El combobox **Crear usuarios** ofrece **Deshabilitado / Habilitado**, con
Deshabilitado por defecto. Se instala como `AGENT_DESK_CREATE_USERS=disabled`
o `enabled`; habilitarlo requiere login con directorio. No es un modo demo.

- Deshabilitado: el formulario sólo habilita cuentas activas existentes.
- Habilitado: al pulsar **Guardar** en el formulario de alta, si la cuenta no
  existe, el backend crea la identidad y solicita su activación a Oracle; sólo
  después guarda los permisos del portal. No recibe ni genera contraseñas.

El operador necesita lectura de dominios/usuarios y certificados para resolver
identidades. Para crear cuentas necesita además permisos de creación y activación
en ese dominio. Los permisos de Compute o del compartimento AIDP no conceden
administración del directorio. Cuando la organización restringe esa operación,
dejar Crear usuarios deshabilitado y usar su proceso de altas habitual.

El buscador de correos consulta el directorio del dominio configurado con los permisos
del servidor. Sólo los administradores del portal pueden usarlo; devuelve hasta veinte
correos activos por búsqueda y no se almacena como catálogo local. La lista de usuarios
del portal contiene únicamente las identidades a las que se han asignado permisos.
La invitación usa `UserActivationInitiator` de Oracle: una respuesta correcta acredita
la solicitud al proveedor, no la entrega del correo al buzón del destinatario.
Una cuenta creada por Desk sin permisos locales todavía puede reintentar la activación
si el alta se interrumpió. Guardar de nuevo una cuenta ya registrada en el portal no
reenvía su activación. La creación en Oracle y la asignación local son operaciones
separadas: un fallo de la segunda no elimina la cuenta del dominio.

Desk no modifica grupos, políticas IAM, roles AIDP ni asignaciones de la aplicación
Oracle. Un **grupo normal** puede gestionar la asignación de personas al cliente
Oracle según la política del tenant; un grupo dinámico se reserva para recursos,
como la VM. Los permisos por agente se conservan en el portal. El administrador
del dominio debe asignar las cuentas nuevas al cliente Oracle cuando su política
lo exija y configurar MFA allí.

La creación remota y el permiso local no son una transacción distribuida. Si falla
la activación no se concede acceso local; se puede reintentar. Sólo las cuentas
marcadas como creadas por esta instalación pueden recibir una nueva activación
mediante ese reintento. Desk no adopta, elimina ni restablece cuentas existentes.
Deshabilitar una cuenta en Oracle impide su siguiente login; para revocar también
una sesión de Desk ya abierta, deshabilitarla en Usuarios. Las sesiones propias
caducan a las ocho horas y no consultan SCIM en cada petición.

## Datos y permisos

SQLite nativo, apropiado para una instancia y un disco persistente. La autoridad
de esquema/migración es `backend/app/core/access_store.py`, con `PRAGMA user_version`.
Cada conexión activa foreign keys; las escrituras de permisos son transaccionales.

| Tabla | Relación y propósito |
| --- | --- |
| users | ID aleatorio; UNIQUE autoridad del tenant + subject (columna `issuer`); rol admin/member; enabled |
| grants | PK usuario + perfil; FK usuario con borrado en cascada |
| sessions | Hash del token opaco; FK usuario; caducidad e índices de usuario/expiración |
| requests | Correspondencia privada de solicitud AIDP por usuario, perfil y conversación; native_request único |

Los perfiles OCI permanecen en el almacenamiento privado de archivos existente, por lo que su ID
en grants no tiene una FK SQL: el API valida que exista y que sea publicado antes
de concederlo. Retirar un perfil lo hace inutilizable; reimportar otro requiere
concesión explícita. Todos los endpoints Desk tienen control de sesión, y los de
invocación/audio comprueban el permiso antes del servicio cloud. Sólo admin gestiona
agentes, audio y sugerencias; TEST se permite en modo local o para administradores Oracle. Las instalaciones
locales sin conexión administrada conservan la carga de credenciales.

Sesión y solicitud nativas de AIDP se separan por usuario; el protocolo público
restaura los IDs del navegador. Historial, tareas, borradores y preferencias se
guardan bajo un namespace de usuario en el navegador; no se migran historiales
locales a una identidad de Oracle. Se comprueba la identidad al volver a la pestaña
y en cada petición protegida. SessionStorage sigue sin ser archivo durable.

Respaldar el directorio de datos completo con la aplicación detenida, incluyendo
`access.sqlite3`, perfiles y borrador. Proteger copias como secretos. SQLite no
añade cifrado de aplicación. Mantener estable el secreto de sesión; cambiarlo
invalida cookies temporales y el namespace nativo de las conversaciones.
Para múltiples réplicas, migrar permisos, sesiones y correspondencias de solicitudes
a una base compartida y definir concurrencia/backups antes de escalar.

## Imagen y release

`.github/workflows/image.yml` es manual. Requiere un tag `vMAJOR.MINOR.PATCH` existente;
construye Linux amd64, etiqueta la imagen con el SHA y MIT, la sube a GHCR y crea un
release **draft** con `agent-desk-image.json`. El descriptor contiene digest, plataforma
y commit. No publica el release ni ejecuta despliegues. Validar la imagen y hacer
el paquete GHCR descargable públicamente antes de publicar el draft. La primera
ejecución puede requerir habilitar permisos de GitHub Packages del repositorio.
El repositorio debe tener releases inmutables habilitadas antes de publicar el
draft: Deploy Studio exige una release estable, no draft/no prerelease, con
`immutable=true`. Verificar de nuevo ese atributo y la descarga anónima del
digest publicado; no basta con que el workflow haya terminado correctamente.
El hook preflight escribe `DEPLOY_STUDIO_RESULT`; `DEPLOY_STUDIO_OUTPUT` se
reserva para post-apply. Ambos consumen el contexto fijado al commit de la release.

Deploy Studio verifica el release estable, SHA y digest del asset. El preflight
propio compara descriptor, SHA fijado e imagen seleccionada. No usar `latest`,
reconstruir un tag ya publicado ni reutilizar un descriptor de otro commit.
La validación local no acredita el workflow remoto ni la descarga pública de
GHCR: comprobar ambos antes de distribuir una versión de la imagen.

## Infraestructura

`terraform/deploy-studio.json` sigue el contrato v2 actual de CloudTechNext:
`execution_source=oci_resource_manager`, grupos declarativos y hooks propios.
El descriptor incluido es la referencia de esta receta. Antes de registrarlo en
un catálogo de Deploy Studio, fijar y validar una versión compatible del contrato
del catálogo destino. La presencia del descriptor no registra la aplicación.

Entradas públicas: compartimento existente, región, availability domain,
imagen **Oracle Linux 9 amd64** con Oracle Cloud Agent, imagen Desk por digest,
dominio de identidad, URL OIDC, client ID,
usuario administrador del dominio y Crear usuarios. El cliente OIDC sigue siendo
una aplicación confidencial registrada por el administrador del dominio; la
receta no crea el cliente ni su política MFA automáticamente.

El secreto del cliente se solicita como campo secreto de Deploy Studio
(`secret:true`, `transform:none`). El hook lo recibe en `DEPLOY_STUDIO_SECRETS`,
separado de los inputs publicos y de Terraform. No se solicita un secreto de Vault.

Terraform crea VCN, gateway, ruta y subnet pública propios, VM.Standard.E4.Flex
(1 OCPU, 8 GB, boot de 50 GB), NSG web 80/443,
bucket privado temporal sin versionado, grupo dinamico para la instancia y politica
acotada al objeto `.bootstrap/runtime.json` y a sus ejecuciones Run Command.
Se necesitan permisos Compute/Networking, Object Storage e IAM para crear estos
recursos, y `manage instance-agent-command-family` para el operador en ese
compartimento. La subnet usa una security list explícita: entrada 80/443 e ICMP
para PMTU; salida stateful a Internet con todos los protocolos, igual que
Starter Kits (`terraform/e_oci_core_vcn.tf`). Permite completar la detección
de IP de `oci-public-ip`, incluidos los intercambios STUN. No se abre entrada
STUN ni SSH. No usa la security list
predeterminada ni crea una regla o clave SSH. IAM se crea en la región principal
del tenant. La receta admite Terraform 1.5, versión disponible en Resource Manager.

### Entrega sin Vault

Patrón de referencia: [OCI AIDP Workbench Starter Kits](https://github.com/jgangini/oci-ai-data-platform-workbench-starter-kits/tree/dd032cea1ddecdc46fe4d9c54f05c33d4ecc520b),
licencia MIT. Desk utiliza su propio sobre **v1**, distinto del v3 de Starter Kits:
incluye configuracion OIDC ademas del config/PEM. No son intercambiables.

1. Preflight valida la clave cargada y la huella OCI; fija como inputs publicos el
   usuario y la huella esperados. Las rutas privadas llegan por
   `DEPLOY_STUDIO_OCI_CONFIG` y `DEPLOY_STUDIO_OCI_KEY`.
2. La VM genera una clave RSA 3072 temporal que nunca sale de ella. Run Command
   devuelve solo la clave publica mediante un helper root acotado en sudoers.
3. Post-apply cifra config, PEM y configuracion runtime con AES-256-GCM; envuelve
   la clave AES mediante RSA-OAEP/SHA256 y sube solo el cifrado al bucket privado.
   El secreto de sesion se genera aleatoriamente, no es una variable Terraform.
4. La VM usa instance principal para descargar el objeto, valida el esquema,
   autenticacion GCM, usuario y huella del operador, e instala los archivos con
   permisos `0600` y directorios `0700`. Cada reemplazo es atomico; un recibo de
   hashes permite terminar si hubo una interrupcion tras instalar y borrar el sobre.
5. Se elimina el objeto con su ETag y se exige HEAD 404. Se retira la clave temporal
   antes de publicar READY. Los reinicios reconcilian restos de limpieza.
   Post-apply comprueba consumo y luego HTTPS, modo Oracle y API protegida.

La autenticidad de la clave publica depende de la API firmada de Run Command; la
autoria del objeto depende de IAM. GCM protege integridad del sobre, pero no es una
firma independiente del remitente. No se pasan secretos en argumentos de comandos,
user-data, state, outputs o logs. La receta se cambia a Oracle Linux porque Ubuntu
no figura entre las imagenes soportadas para este flujo de Run Command.
[Run Command oficial](https://docs.oracle.com/en-us/iaas/Content/Compute/Tasks/runningcommands.htm).

La identidad de instancia solo se usa para la entrega inicial. Las llamadas AIDP
posteriores usan la identidad del operador instalada en `/run/oci/config` y
`/run/oci/key.pem`, montados desde archivos privados del host. Estas credenciales
son la conexión administrada de la instalación. Bootstrap fija
`AGENT_DESK_MANAGED_CONNECTION=1` y `AGENT_DESK_COMPARTMENT_ID` al compartimento
elegido. La configuración muestra Agent Flow, Audio y Sugerencias; no muestra
Conexión ni permite cargar o sustituir config/PEM por API. Cancelar Agent Flow o
Audio limpia sólo su formulario y conserva la conexión del servidor.

Los perfiles guardados sólo se ofrecen si su perfil OCI, compartimento e identidad
del operador coinciden con la base. Las invocaciones usan los archivos base. Si
cambia el ámbito o la identidad, los archivos anteriores se conservan para rollback
pero quedan fuera del catálogo utilizable; el administrador debe volver a seleccionar
los agentes. La rotación operativa requiere actualizar la base y verificar el
catálogo antes de retirar la copia anterior. Las credenciales nunca forman parte
de la imagen ni de respuestas HTTP.

Cloud-init viaja comprimido con gzip y Base64 para respetar el límite OCI de
32.000 bytes de metadata; una precondición del PLAN impide superar ese límite.
Cloud-init instala Podman desde Oracle Linux, arranca la imagen OCI Desk sin
privilegios y con rootfs de solo lectura, y un contenedor Caddy separado por digest
para TLS (2.10.2 amd64, digest verificado del registro oficial). Caddy termina TLS y entrega el stream sin buffering. `default_sni` selecciona el certificado de la IP pública cuando el cliente no envía SNI, incluido el acceso del navegador por IP detrás del NAT de OCI. La VM obtiene su IP con
`oci-public-ip -g`, sin crear un ciclo entre IP y cloud-init. Certbot 5.4 por digest
usa el nombre completo `docker.io/certbot/certbot` para evitar la selección
interactiva de registro de Podman durante el arranque. El contenedor
solicita un certificado público de Let’s Encrypt para esa IP con el perfil
shortlived; un timer lo renueva dos veces al día. Se comprueban cadena, SAN IP,
vigencia y clave antes de activar; un fallo restaura la configuración anterior.
No se utiliza un certificado autofirmado ni se desactiva la verificación TLS.
Antes del certificado sólo se sirve el desafío ACME por HTTP, sin acceso al backend.
Firewalld conserva 80/443 tras reinicios. El backend publica sólo en 127.0.0.1.
No se requiere DNS. Tras APPLY, registrar el output `oidc_callback_url` exacto en
el cliente Oracle, conservando sus redirects y política MFA existentes. La
receta no modifica ese cliente. Un cambio de IP posterior exige revisar el
callback antes de cambiar el origen de la instalación. La propagación de
permisos del grupo dinamico puede tardar hasta 30 minutos; el hook dispone de una
hora, pero no interpreta health 200 como prueba de SSO real.

Los datos viven en `/opt/agent-desk/data` del boot volume y sobreviven reinicios de
contenedor. Configuracion runtime en `/opt/agent-desk/private/runtime.env`;
credenciales en `/opt/agent-desk/private/oci/`. El bucket queda vacio tras el consumo.
`prevent_destroy` protege la VM contra reemplazos accidentales; no es un backup ni
alta disponibilidad. Cambiar cloud-init no reinstala una VM existente. Actualizar
imagen, identidad o cliente OIDC requiere una operacion administrada con backup y
reinicio, fuera del APPLY inicial. No retirar la proteccion para forzar reemplazos.

## Aceptacion pendiente en el tenant

Comprobar SSO/MFA y logout reales, alta de un miembro, denegacion de otro agente,
stream/replay entre usuarios y revocacion de permisos; validar certificados públicos para la IP y renovación,
propagacion IAM, Run Command, entrega/consumo del sobre, reinicio y restauracion de
backup. La validacion local de Terraform y los dobles SDK no acreditan capacidad,
permisos ni un arranque real en OCI. No hay cuotas por usuario, auditoria
administrativa completa ni HA en esta version.

## Validacion local

El scheduler requiere un único proceso de aplicación por directorio de datos;
no configurar varios workers Uvicorn ni compartir su SQLite entre réplicas. El
bloqueo exclusivo falla cerrado si otro scheduler posee ese directorio. Incluir
`scheduled.sqlite3` en las copias coherentes del volumen privado junto al resto
de datos; no copiar únicamente el archivo mientras haya una escritura activa.
Al restaurar o reiniciar, las operaciones de resultado desconocido no se lanzan
de nuevo automáticamente.

Para habilitar informes, verificar primero el diagnóstico del productor y el
candidato servido, y configurar `AGENT_DESK_REPORT_PROFILES` con los IDs guardados
de destinos compatibles. Compose transmite esta variable. El prefijo `test:`
selecciona únicamente TEST; con Oracle requiere un administrador habilitado. Un TEST nuevo no cambia
la capacidad del PROD anterior. La demostración está disponible sólo en local y
no acredita investigación real. Un servidor detenido no ejecuta sus horarios;
las ocurrencias antiguas se omiten según la política documentada en uso.

Inicializar los proveedores con `terraform -chdir=terraform init -backend=false`;
esto no crea recursos. El flujo `scripts/arch-postflight.ps1` ejecuta las pruebas,
Ruff de hooks, formato/validate Terraform, control de publicacion y Sentrux. CI usa
los mismos checks funcionales y Terraform 1.15.6. La ejecución local no sustituye
la comprobación del workflow de GitHub en el repositorio destino.
Las pruebas de bootstrap verifican cifrado alterado, identidad incorrecta,
interrupcion tras el borrado del objeto, limpieza al reiniciar y ausencia de
secretos en Run Command. No sustituyen la aceptacion real descrita arriba.
