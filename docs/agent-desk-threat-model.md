## Executive summary

Agent Desk tiene un modo local loopback y un modo Oracle para una instalación
compartida. Las fronteras críticas son identidad Oracle, permisos sobre las
credenciales OCI del servidor y correlación de conversaciones AIDP. SSO y
operación reales requieren aceptación en el tenant además de pruebas locales.

## Scope and assumptions

Alcance: una VM, un tenant, identidades Oracle existentes y creación opcional
de cuentas, deshabilitada por defecto. El administrador habilita acceso a la
aplicación y, sólo con esa capacidad autorizada, solicita altas a Oracle. Se asume un
operador de confianza para imagen, DNS, entrega cifrada y configuración OIDC. Fuera de alcance:
compromiso de Oracle, OS del operador, administración general de IAM, multi-replica y lógica
de los agentes. Cada instalación requiere dominio, cliente, entrega privada del
secreto OIDC y el `sub` verificado del administrador. El entorno Docker local
tiene aceptación de SSO con un usuario existente; la aceptación de la VM sigue pendiente.

## System model

### Primary components

FastAPI compone el gate en `core/access.py`; Authlib y sesión propia en
`core/identity.py`; SQLite en `core/access_store.py`; ProfileStore conserva claves
en archivos. React monta Desk tras comprobar identidad (`shared/AccountGate.tsx`).
Terraform configura una VM con Podman/Caddy y bootstrap cifrado por Object Storage.

### Data flows and trust boundaries

- Navegador → Oracle: redirección HTTPS con state, nonce, PKCE y `prompt=login` fijado en servidor, sin identidad aportada por el formulario.
- Logout revoca el identificador opaco en SQLite y limpia el estado OIDC pendiente. No termina sesiones de otras aplicaciones del dominio; la política de Oracle controla la autenticación solicitada en el próximo acceso.
- Oracle → FastAPI: código; intercambio backend y validación de ID token. El correo
  no concede privilegios; el emisor se valida contra discovery del tenant. En modo
  directorio, el cliente emite sub=userName y una consulta firmada al mismo dominio
  resuelve su ID SCIM activo antes de comprobar permisos. Una cuenta recreada no
  hereda los permisos del ID anterior.
- Admin → directorio Oracle: correo validado, cuenta activa inequívoca y perfiles
  publicados; alta y activación sólo con capacidad explícita de servidor y permisos
  del operador. No se crean grupos, asignaciones a aplicaciones ni roles IAM/AIDP.
- Desk → certificados Oracle: si el endpoint del tenant exige autenticación,
  una lectura OCI firmada obtiene sus claves públicas desde una ruta fija del
  mismo dominio. Authlib mantiene la validación de firma, emisor y audiencia.
- Docker local → navegador: HTTP sólo mediante excepción explícita para loopback,
  con cookies separadas de producción. La VM conserva HTTPS y cookies Secure.
- Navegador → API Desk: cookie opaca, identidad esperada, JSON/form/audio; sesión,
  origen/cabecera en mutaciones, rol y permiso por perfil antes de OCI.
- Desk → AIDP/Speech: firma con perfil del servidor; IDs nativos aislados por usuario;
  salida normalizada y restauración de correlación pública.
- Hook → Object Storage → VM: sobre autenticado y cifrado a la publica de la VM obtenida por Run Command; IAM por objeto, validacion del operador, instalacion privada y borrado confirmado.
- GitHub/Deploy Studio → VM: source SHA, descriptor y digest de imagen; sin claves en
  imagen ni state. Es una frontera de suministro aún no probada en un release real.

## Assets and security objectives

| Asset | Why it matters | Security objective |
| --- | --- | --- |
| Claves OCI/OIDC | Acceso delegado y privilegios cloud | C/I |
| Permisos y sesiones | Impedir acceso a agentes no concedidos | C/I |
| Conversaciones y correspondencias | Separar investigación, replay y cancelación | C/I/A |
| Imagen y bootstrap | Código con acceso a secretos del servidor | I |
| Disco y backups | Continuidad de usuarios, perfiles y conversaciones nativas | C/I/A |

## Attacker model

### Capabilities

Atacante remoto puede enviar HTTP; un miembro puede alterar IDs, cuerpos, cookies
propias, abrir pestañas y llamar endpoints sin UI. Un productor puede devolver
contenido no confiable. Un operador controla la configuración de infraestructura.

### Non-capabilities

No se supone firma Oracle falsificable ni lectura del disco/bucket sin compromiso
previo. Administrador de VM y mantenedor de imagen son autoridades de confianza.

## Entry points and attack surfaces

| Surface | How reached | Trust boundary | Notes | Evidence |
| --- | --- | --- | --- | --- |
| Login/callback | HTTP | Oracle/Desk | State, nonce, firma, audiencia, issuer | core/identity.py |
| Desk APIs | HTTP cookie | Usuario/credenciales | Gate central + permiso de perfil | core/access.py; desk/api.py; desk/audio.py |
| Usuarios/permisos | POST/PUT admin | Admin/directorio/miembro | ID SCIM estable; sesiones revocadas; creación opt-in | core/access.py; core/directory.py; core/access_store.py |
| Stream/replay/cancel | POST | AIDP/usuario | IDs privados persistentes | desk/invocation_scope.py |
| Archivos OCI | Upload admin/montaje | Credenciales/host | Valida RSA y huella, nunca descarga clave | desk/credentials.py |
| Release/arranque | CI/cloud-init | Suministro/VM | Digest y source SHA; sobre cifrado de un uso | terraform; image.yml |

## Top abuse paths

1. Usar un correo del administrador → intentar login propio → correo no eleva rol.
2. Miembro cambia profile_id → stream/audio → permiso comprobado antes de servicio.
3. Copiar request/session de otro usuario → replay/cancel → IDs nativos distintos.
4. Cambiar cuenta en otra pestaña → conservar estado anterior → cabecera esperada
   impide ejecutar como otra persona y fuerza recarga.
5. Reutilizar sesión tras retirar acceso → cookie existente → consulta activa de
   usuario y eliminación de sesiones impiden uso posterior.
6. Sustituir imagen/descriptor de otro commit → preflight → digest/SHA no coinciden.

## Threat model table

| Threat ID | Threat source | Prerequisites | Threat action | Impact | Impacted assets | Existing controls | Gaps | Recommended mitigations | Detection ideas | Likelihood | Impact severity | Priority |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| TM-001 | Internet | Callback manipulado | Suplantar identidad | Admin indebido | Permisos/claves | Authlib; issuer/sub; pruebas adversas y SSO local | VM y MFA no acreditados por el control local | Aceptación en VM con política del tenant | Conteos de rechazo sin tokens | low | high | high |
| TM-002 | Miembro | Cookie válida | Alterar perfil/IDs | Datos o ejecución ajena | Conversaciones/cloud | Grants y namespace de solicitudes | Cuotas/auditoría parcial | Límites operativos por usuario | Rechazos 403 y volumen de uso | low | high | high |
| TM-003 | Navegador | Varias cuentas/pestañas | Reutilizar UI de otra cuenta | Mezcla de datos | Historial | Scope storage, revalidación y header esperado | Datos accesibles al mismo perfil OS | Usar perfiles de navegador en equipos compartidos | Respuestas 409 | medium | medium | medium |
| TM-004 | Cadena suministro | Imagen/operador comprometido | Ejecutar código con secretos | Control de tenant delegado | Claves y sesión | Digest, release fijado; sobre autenticado y borrado | CI real y catálogo no probados | Revisar y publicar release validado | Registrar SHA/digest | low | high | high |
| TM-005 | Host | Disco o backup expuesto | Leer claves y SQLite | Filtración | Secretos/usuarios | Archivos privados, VM sin app root | Sin cifrado adicional app | Proteger disco y backups; mínimo privilegio OCI | Auditoria Object Storage/host | low | high | high |
| TM-006 | Usuario habilitado | Acceso legítimo | Crear muchas investigaciones | Coste/disponibilidad | Cloud y disco | Validación de cuerpos y límite de transporte | Sin cuota por usuario | Definir presupuestos/concurrencia antes de ampliar uso | Métricas coste/latencia/espacio | medium | medium | medium |
| TM-007 | Admin comprometido | Creación habilitada y operador privilegiado | Crear cuentas del dominio | Ampliación de acceso al tenant | Directorio | Capacidad por defecto deshabilitada, rol y CSRF, solicitud explícita, sin roles/asignaciones cloud | Sin cuota/auditoría administrativa completa; alta remota no atómica con SQLite | Mantener deshabilitado en clientes que gestionan altas; permisos mínimos y auditoría Oracle | Audit de creación/activación en Oracle | medium | high | high |
| TM-008 | Cuenta recreada | Nombre reutilizado | Heredar grants anteriores | Acceso a agentes ajenos | Permisos | Resolución live del token validado a ID SCIM inmutable | Baja sólo en Oracle no revoca sesiones Desk abiertas | Deshabilitar también en Desk; caducidad propia de ocho horas | Rechazos de acceso y bajas administrativas | low | high | high |

## Criticality calibration

Critical: lectura arbitraria de claves OCI o ejecución remota en el host. High:
suplantar admin o recuperar conversaciones de otro usuario. Medium: saturación de
solicitudes o mezcla visual en un equipo compartido. Low: mensajes operativos
incompletos o preferencias de interfaz sin datos sensibles. La confianza en el
operador y una única instancia reducen alcance; no eliminan el impacto cloud.

## Focus paths for security review

| Path | Why it matters | Related Threat IDs |
| --- | --- | --- |
| backend/app/core/identity.py | Identidad y cookie | TM-001 |
| backend/app/core/oracle_keys.py | Certificados fijados al tenant | TM-001 |
| backend/app/core/access.py | Choke point de permisos | TM-002 |
| backend/app/core/access_store.py | Grants, caducidad y bootstrap admin | TM-001, TM-002 |
| backend/app/features/desk/invocation_scope.py | Correlación privada | TM-002 |
| frontend/src/shared/AccountGate.tsx | Cambio de identidad | TM-003 |
| terraform/bootstrap.py | Custodia de secretos | TM-004, TM-005 |
| .github/workflows/image.yml | Integridad de release | TM-004 |

## Notes on use

Se revisaron login, APIs, archivos, transporte, almacenamiento y bootstrap; se
distingue runtime de CI y pruebas. Los supuestos de tenant/usuarios/VM fueron
confirmados. Este modelo no es una auditoría exhaustiva ni aceptación productiva.
