# Agent Desk — dirección visual

Interfaz oscura y compacta: base #090a0c, chat #0d0e10, composer #17181b, texto #eeeeef, texto secundario #a4a4aa y bordes #303236. Manrope variable se aloja localmente. Usar los tokens existentes de foco, espaciado y movimiento; no añadir estilos de control independientes.

Escritorio: escena 3D, resultados y chat. Resultados sólo ocupa espacio cuando hay hallazgos; puede ampliarse. En móvil prima el chat. La cabecera del panel derecho muestra el título de conversación o Configuración, Tareas y Nueva tarea. X desde Nueva tarea vuelve a Tareas.

El núcleo de partículas es ilustrativo y continúa su deriva durante la ejecución remota. Blanco al escuchar y paleta de Desk al responder por voz. Las fuentes visibles corresponden a actividad recibida; no representan infraestructura interna de AIDP. Movimiento reducido conserva el estado sin deformación temporal.

Composer inferior en conversación y centrado en bienvenida. Proceso plegable y respuesta con Markdown. Avisos amarillos recuperables o rojos terminales encima del composer; sin repetirlos como mensaje del agente. Acciones discretas con teclado y foco visible.

Resultados en tablero compacto, sin huecos de filas compartidas. Resúmenes con elipsis y expansión explícita. Carrusel de publicaciones sin avance automático ni efectos que deformen contenido. Imagen con proporción original calculada desde el ancho. La publicación abre el origen en otra pestaña; no hay modal de medios. Autor/fecha, resumen y comentarios pertenecen a la publicación activa. Cada comentario muestra su propio autor.

Combobox flotantes con valor truncado antes de la flecha y selección accesible. El selector del composer puede abrir hacia arriba si falta espacio inferior. Mantener estados de carga/error, navegación por teclado y opciones sin desplazar el contenido subyacente. No añadir tooltips redundantes en texto, puntos del carrusel o botones cuyo significado ya es visible.

SVG y código adaptado mantienen las atribuciones de NOTICE.md, docs/licenses y frontend/public/icons. Las capturas no son requisito automático: usar DOM/AX y pruebas; una revisión visual con capturas requiere autorización expresa.


Login Oracle: extensión de la identidad existente, con composición dividida como la referencia aprobada de CloudTechNext. Se implementa de forma independiente: fondo animado en azul pizarra, verde y malva sobre grafito; tipografía Manrope existente; acceso directo a Oracle, sin campos de identificación locales. Un solo control de perfil SVG Lucide, a la derecha de Configuración. Sin campos de contraseña ni alta pública. El footer conserva la atribución solicitada. En pantallas estrechas el formulario baja debajo del bloque de marca; con movimiento reducido el fondo permanece estático.

Acceso: sin barra superior; Agent Desk es el título principal, con el degradado de Desk y la frase blanca Your Agent Flows, in one place. debajo. La insignia Oracle precede al texto de acceso y al botón, sin repetir un título de inicio de sesión. La insignia usa el SVG local del catálogo con atribución. Dos campos de luz independientes recorren el fondo en azul pizarra, verde y malva; solo se animan transform y opacidad. Ambos se detienen con prefers-reduced-motion. La comprobación de sesión al recuperar el foco mantiene estable el acceso anónimo; el contenido autenticado permanece oculto mientras se comprueba.

Cuenta: el perfil del chat abre un desplegable titulado Perfil con la acción Cerrar sesión. El acceso comunica el uso de Agent Flows; el corazon y la atribucion de Joel Ganggini usan rojo. La marca del acceso permite regresar al escritorio cuando esta disponible.
Publicaciones: una fila desplazable de puntos conserva visible la seleccion. Descripcion y Comentarios agrupan sintesis y entradas por autor. Una imagen entregada tiene prioridad sobre el fotograma pausado del video directo; no hay autoplay.

Botones: los fondos de hover se definen por componente. No aplicar un fondo general a todos los botones; los primarios conservan contraste y los controles de icono usan la superficie de interacción del escritorio.

Tareas: tarjetas con borde completo, radio de 12 px y superficie #191a1e;
12 px entre pestañas y lista y entre tarjetas. Título y metadatos alineados a la
izquierda, acciones de icono a la derecha. Activadas y En pausa conservan una sola
tarjeta compacta, sin desplegar ejecuciones bajo un separador. Seleccionar nombre
u horario abre la ejecución más reciente a la izquierda; Recuperar usa un SVG
junto a Editar/Pausar/Eliminar y conserva la misma solicitud. El visor
izquierdo se reserva para una ejecución; no repite nombre de tarea, agente e
historial. En móvil, elegir tarjeta conserva Tareas visible; sólo abrir una
ejecución cambia al visor.

Las pestañas separan programación e informes: Activadas/En pausa no muestran
descargas ni informes terminados. Completadas sólo incluye tareas con informes
completos/parciales; omite metadatos y controles de programación. La acción manual
se retira de Tareas. «Programación habilitada»
distingue una recurrencia futura del estado «En ejecución» de un trabajo concreto.

Acciones de tarjeta: tooltips breves Editar, Pausar/Reanudar y Eliminar, conservando
el nombre accesible completo con la tarea. Eliminar usa el token --danger.
El botón de contenido de la tarjeta no muestra tooltip con su texto completo.
Completadas muestra las tarjetas de informes y sus descargas. La actividad de una
ejecución sólo aparece a la izquierda, sin botón textual de recuperación ni
tabla de historial. Los errores siguen visibles.
El panel se llama Tareas en título, tooltip y navegación de retorno. La lista usa
aria-busy durante la carga sin mostrar el texto Cargando tareas.

Informes: las actualizaciones silenciosas conservan la superficie y sus nodos;
no hay animación recurrente ni desmontaje al revalidar. Fuentes por sección en
desplegable compacto, numeración estable y título o dominio en lugar de hashes.
Imágenes en marcos 4:3 sin recorte; errores conservan el marco con enlace al origen.
Tablas y barras representan sólo cantidades conocidas de la muestra, separadas por
unidad; sentimiento sin clasificación suficiente no dibuja distribución.

Editor de formato: sustituye el informe en el panel izquierdo, sin modal ni
backdrop. Lienzo con controles y asa en cada sección, filas de una o dos columnas
y pie de acciones estable con Guardar/Cancelar. La zona para añadir columna acepta
otra sección; los botones permiten agrupar/separar y ordenar sin arrastre. En móvil
las columnas refluyen. Entrada y destino de arrastre adaptan la receta Panel reveal y
tokens de posición de Transitions.dev (250/150 ms), sin animar datos del informe.
Movimiento reducido desactiva las transiciones. La vista previa identifica que
usa datos guardados y que guardar aplica el formato a ejecuciones posteriores.

La cabecera superior reúne la marca Inicio, Editar plantilla y su ×; no hay
cabecera intermedia. Inputs y SelectValue reutilizan los campos oscuros de tareas,
con altura de 40 px. Detalle del agente y fuentes se colocan después del análisis.
Fuentes usa un disclosure con SVG y contador, enlaces por filas y apertura breve;
su estado permanece al revalidar el informe. Nueva tarea/editar tarea se muestra
dentro del panel derecho, bajo su cabecera, con validación y Cancelar.
En pausa sólo muestra Play. Completadas omite agente, mantiene metadatos en una
fila cuando cabe y dispone Eye/Download/Trash a la derecha. Eliminar informe
ofrece confirmación y Deshacer sin borrar la programación.

Las tarjetas de programación no muestran bloque Estado de ejecución ni historial.
### Revisión de Tareas e informe ejecutivo (2026-11-12)

Tareas y su pestaña se restauran por sesión/usuario al recargar. El pie del
formulario integrado reutiliza config-cancel y save-profile, juntos a la derecha.
En las extensiones de mercado, el sentimiento agrupa fuentes compatibles por
entidad/aspecto/tipo de texto en barras verticales con cantidades y porcentajes
explícitos; el desglose queda plegado. Sin clasificaciones no hay gráfico.
Se retira la tabla operativa y el Markdown técnico de los bloques analíticos.
Los límites materiales y fuentes se conservan; las recomendaciones comerciales
siguen dependiendo de evidencia y contenido del productor.
### Tarjetas compactas y acciones de informe

Activadas/En pausa muestran el nombre y una línea de recurrencia y próxima fecha,
sin nombre del agente ni repetir el estado de la pestaña. La zona horaria sigue
en el formulario y en la descripción accesible. Completadas ofrece Ver, Formato,
Descargar y Eliminar como iconos Lucide con tooltips de una palabra. Formato abre
el editor izquierdo desde la ejecución elegida; desaparece el enlace redundante
en el cuerpo del informe. Los orígenes visibles se reducen a Manual/Programada.
La confirmación usa history-delete-dialog y su acción destructiva estándar.
