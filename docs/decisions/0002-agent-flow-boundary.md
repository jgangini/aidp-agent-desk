# ADR 0002 — frontera de Agent Flow y demostración

Estado: aceptado; actualizado 2026-11-10.

Desk selecciona un Agent Flow por conversación. Las fuentes visibles son herramientas o fuentes de evidencia, no agentes remotos. El motor de demostración mantiene una simulación determinista independiente y nunca se usa como fallback de errores remotos.

El backend firma invocaciones TEST/PROD usando perfiles OCI custodiados localmente. El proyecto del agente conserva la responsabilidad de publicar, actualizar y verificar su código. Desk valida paquetes públicos y capacidades opcionales; no interpreta logs privados, no añade análisis de negocio ni inventa relaciones entre evidencias. La UI conserva estado por conversación y representa proceso y respuesta según los paquetes recibidos.

Audio remoto utiliza OCI Speech. Los datos del micrófono se envían al servicio configurado al activar dictado o conversación; los modos demo utilizan adaptadores del navegador. Las credenciales privadas permanecen en el backend. Los límites de origen/cabecera son para una instalación local de un usuario, no autenticación multiusuario.

El historial público reside en sessionStorage, sin garantía de durabilidad al cerrar una pestaña. Los fallos de guardado se notifican y no causan eliminación automática de conversaciones. La recuperación remota conserva identidad de solicitud y distingue interrupciones de rechazos definitivos antes de invocar.

La baseline estructural de Sentrux procede del scaffold inicial. Se preserva para mostrar la deuda acumulada; las pruebas funcionales no anulan un gate degradado. Un cambio de baseline requiere una revisión explícita y no forma parte de la preparación para GitHub.

El consumidor acepta `coverage.presentation` versión `1.0` en el protocolo público
v2. Valida propósito frente al tipo de evento y la combinación fase/estado/outcome;
el texto recibido con esta capacidad no pasa por sustituciones de frases. El
inventario `replay.snapshot.activities` conserva observaciones originales por ID,
con validación de turno, cursor e inmutabilidad. Se mantiene `activity` por fuente
para snapshots antiguos, sin duplicarlo cuando existe el inventario nuevo.
Los paquetes `text` conservan sus claves exactas, revisiones y `discard`;
`run.completed.text` sigue siendo respuesta canónica anticipada. `partial` es un
cierre de ejecución, no una declaración de calidad completa. La fixture local
`frontend/src/features/desk/fixtures/presentation-v1.ndjson` proviene del contrato
del productor, con identidades sintéticas y sin llamadas cloud; su prueba no
demuestra aceptación de un deployment servido.
