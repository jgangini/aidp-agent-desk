# Agent Desk para Oracle AIDP

Agent Desk es una interfaz para conversar con Agent Flows de Oracle AI Data Platform (AIDP). Permite seleccionar agentes, seguir su proceso, leer respuestas Markdown y explorar publicaciones, documentos y evidencias cuando el agente entrega esos datos. Incluye voz con OCI Speech y una visualización 3D.

El proyecto del agente conserva su investigación, herramientas y síntesis. Desk proporciona la conversación, el transporte firmado y la presentación. No publica el código del agente en AIDP.

| Guía | Contenido |
| --- | --- |
| [Uso](docs/usage.md) | Conexión, conversación, resultados, voz y recuperación |
| [Arquitectura](docs/architecture.md) | Componentes, flujo de datos, almacenamiento y límites |
| [Integración AIDP](docs/aidp-integration.md) | Preparar otros Agent Flows y entregar texto, proceso y evidencias |
| [Despliegue](docs/deployment.md) | Oracle login, permisos, imagen y Deploy Studio v2 |
| [Seguridad](SECURITY.md) | Credenciales, sesiones y exposición del servicio |

## Inicio rápido

Requiere Docker con Compose:

```sh
docker compose up -d --build
```

Abre http://127.0.0.1:8317. El servicio se publica sólo en loopback, ejecuta como usuario sin privilegios y mantiene el filesystem de la imagen en modo de sólo lectura. Las credenciales se conservan en el volumen `agent-desk_desk-credentials`. No cambies el nombre del proyecto Compose existente sin migrar ese volumen.

Configura la conexión desde la tuerca: carga el archivo OCI config y su clave PEM, selecciona perfil y compartimento, después plataforma/workspace y agentes publicados. El backend valida la clave y firma las solicitudes; el navegador no recibe la clave privada. La opción TEST utiliza una publicación de desarrollo ya existente. Desk no publica ni actualiza el código del agente.

La demostración local es determinista y no consulta fuentes reales. Un fallo remoto nunca se sustituye por una respuesta de demostración.

## Login y administración

En modo Oracle, Continuar con Oracle redirige al dominio del tenant para autenticar al usuario. El administrador habilita identidades y asigna agentes; TEST sólo está disponible para administradores. El alta opcional de cuentas está deshabilitada por defecto y no recibe contraseñas. Consulta [docs/deployment.md](docs/deployment.md) para el cliente OIDC, los secretos base y Deploy Studio v2.

## Desarrollo

Requiere Python 3.12, uv y Node.js >=22.12. Las versiones se resuelven mediante los lockfiles.

```sh
uv sync --locked
npm ci --ignore-scripts --prefix frontend
uv run python tools/arko.py dev --root .
```

Backend: 127.0.0.1:8317. Frontend: 127.0.0.1:5178. Detén antes el contenedor de Desk si ocupa 8317. En Windows, `./scripts/dev.ps1` comprueba los puertos antes de arrancar. Ningún comando debe detener procesos de otros proyectos.

```sh
uv run python tools/arko.py check --root .
uv run python scripts/check-publication.py
sentrux gate .
```

`check` valida fronteras, compatibilidad OpenAPI, tipos, Ruff, mypy, pytest, Vitest y build. Los wrappers `scripts/arch-preflight.ps1` y `scripts/arch-postflight.ps1` añaden el gate Sentrux y propagan sus fallos. La baseline estructural permanece en `.sentrux/baseline.json`. El alcance de validación está en [docs/tasks/current.md](docs/tasks/current.md). El mapa local de código se genera con `./scripts/graphify.ps1`; instalación, exclusiones y límites están en [el perfil de desarrollo](docs/profiles/fastapi-react.md#local-architecture-map).

Las comprobaciones opcionales de navegador reutilizan Playwright instalado, sin descargar navegadores ni hacer capturas. Consulta [docs/profiles/fastapi-react.md](docs/profiles/fastapi-react.md).

## Integración y límites

- Un Agent Flow PROD puede entregar texto de asistente compatible, que Desk muestra como Markdown al finalizar. El proceso, los resultados enriquecidos, el streaming incremental y la recuperación requieren el contrato público compatible. La entrada siempre incluye un comando JSON: consulta [Integración AIDP](docs/aidp-integration.md) antes de conectar otro proyecto.
- Streaming de texto requiere deltas del agente. Desk no inventa fragmentos ni síntesis por publicación a partir de un resumen global.
- Los resultados agrupan publicaciones por identidad explícita. Los comentarios muestran su propio autor y texto. Se muestran imágenes sólo cuando el productor entrega una URL válida; los enlaces abren el origen en otra pestaña.
- El catálogo de audio ofrece OCI Speech Whisper en español y Carmen Natural en `us-chicago-1`. El micrófono del composer dicta; el control central conversa por turnos. Requiere permisos y disponibilidad del servicio.
- Tareas guarda tareas y versiones en el servidor, ejecuta una prueba inicial y conserva el historial de informes con descarga Markdown y visor A2UI. Requiere un agente compatible habilitado explícitamente; las notificaciones externas siguen pendientes. Consulta [Programado](docs/usage.md#programado).
- El historial público se guarda en sessionStorage de la pestaña. No es almacenamiento durable: al cerrar la pestaña puede perderse. Si falla la escritura se advierte antes de recargar; exporta las respuestas importantes.
- Compose conserva el modo local de una persona. El modo Oracle habilita una instancia para un tenant con sesiones y permisos por agente. Instalación y límites de la VM: [docs/deployment.md](docs/deployment.md). No publiques el modo local en Internet.

Los datos de desarrollo se guardan en `.local/agent-desk` o en `AGENT_DESK_DATA_DIR`; no se publican. No subas config OCI, claves, historiales, capturas o logs privados. Revisa [SECURITY.md](SECURITY.md) antes de compartir una instalación.

## Estructura

- `backend/app/features/desk`: perfiles OCI, descubrimiento, transporte TEST/PROD, audio y sugerencias.
- `frontend/src/features/desk`: chat, protocolo, resultados, demo, voz, tareas y visor de informes.
- `contracts`: OpenAPI actual, baseline y revisiones de compatibilidad.
- `tools/arko.py`, `.arko/project.json`: contexto de features y workflow de validación.
- `PRODUCT.md`, `DESIGN.md`: requisitos vigentes y dirección de interfaz.

## Licencia

Código propio bajo [MIT](LICENSE). Dependencias, SVG, marcas y código adaptado conservan sus avisos: [NOTICE.md](NOTICE.md).
