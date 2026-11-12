# Usar Agent Desk

## Conectar un agente

1. Inicia la aplicación con el [inicio rápido](../README.md#inicio-rápido).
2. En una instalación desplegada, inicia sesión con Oracle. El servidor aporta
   las credenciales OCI y el compartimento; la configuración comienza en Agent Flow.
   Para preparación local sin conexión administrada, usa Conexión para cargar
   config y PEM, seleccionar el perfil y el compartimento, y guardar.
3. En Agent Flow, selecciona la plataforma, el workspace y los agentes publicados
   que quieres habilitar. Guarda esa sección.
4. Selecciona un agente en el composer y escribe una consulta de hasta 500 caracteres.

Necesitas un perfil OCI con acceso a los recursos seleccionados y un agente que
entienda la [entrada de Desk](aidp-integration.md). La disponibilidad del agente y
los permisos del tenant se comprueban contra AIDP; guardar un perfil no concede IAM.

En una instalación con acceso Oracle, inicia sesión con una identidad del dominio
habilitada por el administrador. Cada miembro ve los agentes que tiene asignados.
Pulsa Continuar con Oracle e identifícate en la página de tu organización. Desk no solicita correo ni contraseña. Cerrar sesión invalida el acceso a Desk; el siguiente acceso solicita autenticación a Oracle. Las sesiones de otras aplicaciones Oracle se conservan.
La conexión OCI y los permisos se administran desde el servidor.

## Usuarios del portal

El administrador abre **Perfil → Usuarios**. El panel izquierdo conserva la
cabecera Agent Desk y muestra la tabla de usuarios, su acceso y sus agentes.
El botón **+**, junto a la X, abre el formulario en un diálogo.
El lápiz abre un diálogo para editar los permisos de un miembro:
correo de sólo lectura, acceso **Habilitado / Deshabilitado** y agentes permitidos.
**Guardar** aplica los cambios; **Cancelar** o Escape descartan la edición.
Cancelar el diálogo descarta su borrador. Cerrar el panel recupera el tablero
anterior y el borrador del chat.
Escribe al menos dos caracteres para buscar correos de cuentas activas en el dominio.
El desplegable ofrece hasta veinte coincidencias y permite elegir con el teclado;
puedes seguir escribiendo para precisar la búsqueda. Buscar no habilita ni crea cuentas.
Introduce un correo, selecciona **Agent Flow** y pulsa **Guardar**. El servidor
busca una única cuenta activa en el dominio Oracle y vincula el acceso a su ID
inmutable. El correo no sustituye el inicio de sesión de Oracle.

Puedes cambiar los agentes asignados o deshabilitar el acceso de un miembro.
Guardar permisos revoca sus sesiones de Desk. La cuenta inicial de administrador
se configura al desplegar y no se edita desde este formulario.

**Crear usuarios** se elige en Deploy Studio: **Deshabilitado** por defecto o
**Habilitado**. En ambos casos se pueden habilitar cuentas existentes. Sólo al
habilitar esa opción, **Guardar** también permite crear la identidad si aún no existe
y solicita a Oracle el correo de activación. El formulario indica esa capacidad antes
de confirmar. Con la opción deshabilitada se rechazan correos sin cuenta existente.
Oracle gestiona la activación y la contraseña; el administrador del dominio conserva el control
de asignación a la aplicación y de MFA. No se crean permisos IAM ni roles AIDP.
Los requisitos del operador se describen en [despliegue](deployment.md).

## Conversar y explorar resultados

Los mensajes del agente se representan como Markdown, con listas, títulos,
enlaces y menciones. Cuando el agente entrega eventos de proceso, puedes abrirlos
para consultar su actividad. Los fragmentos de texto aparecen conforme llegan;
si el agente sólo entrega una respuesta completa, aparecerá al finalizar.

El tablero muestra las evidencias que entrega el agente. Busca texto para filtrar
tarjetas y resaltar coincidencias; abre un resumen para leerlo completo. Los puntos
del carrusel seleccionan publicaciones y actualizan su descripción y comentarios.
Cada publicación abre su enlace de origen en otra pestaña. Las imágenes, autores,
fechas y comentarios dependen de los datos recibidos; Desk no los obtiene por su cuenta.

El resumen de comentarios corresponde a la muestra analizada de esa publicación.
Cuando existen comentarios originales asociados, se muestran con el autor
recuperado. Una muestra parcial no representa toda la conversación pública.

## Historial y recuperación

Opciones del chat contiene las conversaciones de la pestaña y Nueva conversación.
La lista desplaza su contenido cuando hay más de cinco chats; Nueva conversación
permanece debajo, fuera del desplazamiento. El botón de eliminar aparece al pasar
por la fila o al enfocarlo con teclado y solicita confirmación.
Puedes renombrar el título de la conversación.
El historial se conserva al recargar mediante sessionStorage, pero cerrar la
pestaña puede eliminarlo. Exporta a Markdown las respuestas que necesites conservar.

El icono de cuenta abre el menú Perfil con Cerrar sesión cuando has iniciado
sesión con Oracle. Sin una sesión, abre la pantalla de acceso.

Si se interrumpe una solicitud recuperable, el aviso sobre el composer permite
intentar recuperar **la misma solicitud**. Esta opción depende del soporte `replay`
del agente. No equivale a iniciar una investigación nueva. Detener la generación
envía una cancelación explícita; cerrar la conexión del navegador no garantiza que
el trabajo remoto se cancele.

Una respuesta parcial puede ser útil y seguir teniendo límites de evidencia.
Lee el alcance que declara el agente; la finalización del transporte no demuestra
que todas las fuentes hayan respondido.

## Voz

En Audio selecciona y guarda OCI Speech Whisper para transcripción y Carmen
Natural para respuesta hablada. El catálogo actual los ofrece en `us-chicago-1`.
Necesitas acceso a esos servicios y permiso del navegador para el micrófono.

El micrófono del composer dicta sobre el borrador. El control central activa una
conversación por turnos: escucha, envía, reproduce la respuesta y vuelve a escuchar.
Puedes detenerlo para terminar la captura y la reproducción. El audio se envía a
los servicios configurados cuando utilizas estas funciones.

## Tareas

Tareas se abre con un clic a la derecha y cambia el área izquierda por la
cabecera de informes, con la marca como botón de Inicio. Selecciona automáticamente
el último informe terminado accesible una vez al abrir. Sustituye el panel de Usuarios;
al seleccionar una fila de informe en Completadas muestra esa ejecución a la
izquierda. **+** de la cabecera derecha abre el formulario dentro de ese panel,
sin diálogo: nombre, instrucciones de
hasta 500 caracteres, agente, repetición, inicio y zona horaria. **Guardar y ejecutar**
guarda la programación y solicita una primera prueba real; con Demostración local
produce exclusivamente datos sintéticos, sin consultar fuentes.

Selecciona una tarjeta para desplegar sus ejecuciones en el panel derecho.
**Activadas** contiene programaciones habilitadas; **En pausa**, sólo pausadas.
Ambas muestran únicamente ejecuciones pendientes, en curso o con errores, sin
descargas. Tareas no ofrece **Ejecutar ahora**: crear la tarea ya solicita su
primera ejecución automática. Los controles de icono tienen los tooltips breves
Editar, Pausar y Eliminar en Activadas; En pausa sólo ofrece Reanudar. Eliminar
utiliza el color de peligro. Reanudar habilita la programación; no es ejecución manual.
Abrir una fila muestra a la izquierda sólo esa ejecución, sus
evidencias y su estado, sin repetir la definición ni el historial. La selección se
recupera al recargar, sin otra investigación. **Completadas** muestra únicamente
tareas con informes completos o parciales, con el estado explícito; no repite los
controles de programación. Incluye informes de programaciones aún activas o pausadas,
pero excluye tareas sin informes terminados. Su descubrimiento utiliza las 200
ejecuciones recientes que devuelve el historial autorizado de cada tarea.
Cada informe de Completadas ocupa una tarjeta compacta, sin bloque interior.
A la derecha tiene los iconos Ver informe (ojo), Descargar y Eliminar informe.
No repite el agente; fecha, estado, versión y tipo comparten una fila cuando hay
espacio. Eliminar informe requiere confirmación y ofrece Deshacer; conserva la
programación y el registro de ejecución para no repetir la investigación.
La descarga Markdown
incluye estado, periodo, fuentes y límites, sin investigar.
La **×** derecha cierra Tareas y el visor juntos. En móvil el visor ocupa
la pantalla; el logo Inicio vuelve al chat y conserva su borrador. La flecha de
móvil vuelve sólo a la lista de Tareas para elegir otra ejecución.

Cada versión conserva su plantilla: una muestra vacía no elimina las secciones
opcionales que puedan tener datos en otra ejecución. El icono **Formato** de la tarjeta en Completadas cambia
títulos, orden, visibilidad y columnas para próximas ejecuciones, sin nuevas consultas.
La edición ocupa el panel izquierdo en lugar del informe, sin popup. La barra
inferior conserva Guardar y Cancelar. Editar plantilla y su × ocupan la cabecera
superior, sin cabecera intermedia. La distribución se guarda por versión de tarea
y reaparece al abrir el editor; los informes anteriores conservan su distribución.
El editor permite arrastrar desde el asa de una sección o usar subir/bajar y las
flechas de teclado. Arrastra sobre otra sección para ordenar, o sobre la zona
«añadir una columna» para colocarlas juntas. Los botones Agrupar y Separar ofrecen
la misma distribución sin arrastre, con hasta dos secciones por fila. En móvil
se muestran apiladas. La hoja muestra texto, tablas, gráficos de datos conocidos e
imágenes del último informe guardado, sin investigar de nuevo. No crea recursos
para rellenar bloques sin evidencia. Las fuentes se despliegan por sección y usan
títulos/dominios legibles; imágenes no disponibles conservan un enlace al origen.
La revalidación de acceso en segundo plano conserva el informe mientras no cambie
y muestra un error de red aparte, sin reconstruir la página en cada consulta.
Los informes anteriores conservan su formato. Cambiar las instrucciones o el
agente crea una versión con otra prueba inicial. Editar nombre/calendario o pausar
no repite la prueba. La API de ejecución manual se conserva para integraciones y
comprobaciones autorizadas; no aparece como acción de esta interfaz.

Las tareas continúan con el navegador cerrado mientras el servidor esté en marcha.
No se solapan ejecuciones de una tarea. El calendario encola otras tareas mientras
el ejecutor serial investiga; su inicio real puede retrasarse. Horarios omitidos
durante una parada de más de 60 segundos se saltan al próximo, sin una ráfaga de
investigaciones antiguas. En cambios de hora se omiten instantes inexistentes y se
usa una sola ocurrencia del instante repetido. Día 31 mensual omite meses sin ese día.
En **Una vez**, la primera ejecución automática consume esa única ejecución;
al terminar, la programación queda en pausa y sin próxima fecha. Sus informes
completos o parciales permanecen en Completadas. Fallos e interrupciones conservan
su estado real; recuperar consulta la misma solicitud, sin crear otra investigación.
Una recurrente permanece activa aunque ya tenga informes. Las ejecuciones interrumpidas al
reiniciar no se repiten automáticamente. El historial muestra las 200 más recientes.
Si una ejecución interrumpida admite recuperación, **Recuperar ejecución** consulta
la misma solicitud mediante replay. Sólo una señal explícita de continuación segura
permite continuar con los mismos identificadores; no crea otra investigación por
interpretar un snapshot incompleto. Los errores de transporte impiden aceptar como
informe una respuesta dudosa.

Las definiciones locales antiguas no se borran ni se activan automáticamente:
**Definiciones guardadas en este navegador → Importar en pausa** permite conservarlas
en el servidor si su agente es compatible. No hay envío de notificaciones externas.

El operador habilita informes por destino verificado mediante
`AGENT_DESK_REPORT_PROFILES` (IDs de perfiles guardados separados por comas).
`test:<id>` habilita sólo ese TEST (local o administrador Oracle); habilitar `<id>` PROD no habilita TEST.
La capacidad usa el destino explícito y el perfil guardado; el campo informativo
`ready` no certifica ni bloquea informes. TEST requiere además instancia y workspace.
La conexión, el nombre del agente o un TEST aceptado no acreditan que PROD tenga
la misma capacidad. Los agentes sin capacidad conservan su chat. El primer agente
de mercado añade cobertura y sentimiento opcionales; un agente de otro dominio
puede usar otras secciones sin adoptar esos análisis. Sin evidencia suficiente no
se presenta sentimiento neutral ni se extrapola la muestra a una población.

## Modos

En el detalle de cobertura, el visor y la vista previa muestran sólo el nombre
de la fuente en los encabezados técnicos reconocidos del productor. Su estado
se conserva en la tabla y sus limitaciones; el Markdown descargado mantiene el
texto original del agente. No se reescriben narrativas ni informes guardados.

| Opción | Uso |
| --- | --- |
| Demostración local | Explorar la interfaz con datos deterministas, sin investigar fuentes |
| Agente publicado | Conversar con un Agent Flow disponible en AIDP |
| Nombre del agente `(TEST)` | Probar un despliegue de desarrollo existente, en modo local o como administrador Oracle |

La demo no sustituye una respuesta remota fallida. El modo TEST no publica cambios
de código: esa operación pertenece al proyecto del agente.

El + de Tareas abre siempre el formulario con los Agent Flows disponibles.
Al recargar la misma pestaña del navegador, Tareas conserva si estaba abierto y
su pestaña Activadas, En pausa o Completadas; el informe abierto se restaura sin
ejecutar otra investigación. Cerrar Tareas o volver a Inicio se conserva también.
Este estado pertenece a la sesión de la pestaña y al usuario actual.

En los análisis de mercado, el sentimiento se consolida por entidad, aspecto y
tipo de texto mediante barras verticales. Los porcentajes se calculan sobre los
textos clasificados; los no clasificados se cuentan aparte. Se mantiene la
categoría Mixto y no se dibujan barras cuando no hay clasificaciones. El desglose
por fuente y la evidencia se pueden desplegar. No se mezclan comentarios con
publicaciones ni entidades diferentes.
La vista del informe omite la tabla operativa de consultas/fallos y el detalle
crudo del agente; conserva los gráficos de evidencia recuperada, las fuentes y
los límites de interpretación. No altera el informe almacenado ni inventa
hallazgos o recomendaciones que el productor no haya sustentado.
La capacidad de informes se comprueba al guardar el Agent Flow elegido, no al
abrir el formulario. El aviso amarillo aparece dentro y conserva los datos; puedes
seleccionar otro Agent Flow y volver a guardar. No habilita un destino incompatible.

Las tarjetas de Activadas y En pausa muestran nombre y una línea de frecuencia/
próxima fecha, sin repetir agente ni estado de la pestaña. Los tooltips de
Completadas son Ver, Formato, Descargar y Eliminar. El origen visible es Manual
(incluida la primera ejecución al guardar) o Programada; los triggers internos
no cambian. La confirmación de eliminación usa el mismo diálogo del historial.
