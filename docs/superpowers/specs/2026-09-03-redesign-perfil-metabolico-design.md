# Rediseño profesional de la aplicación de perfil metabólico

Fecha: 3 de septiembre de 2026

Estado: propuesta aprobada para especificación; pendiente de revisión final del usuario

Producto: MFPP Cycling Specialist — Perfil metabólico

Responsable funcional: entrenador MFPP

## 1. Contexto

La aplicación actual es un dashboard estático desplegado en Netlify. Lee datos de
Intervals.icu a través de una función proxy, permite introducir variables fisiológicas
manualmente y genera perfiles, recomendaciones e informes.

El prototipo ha permitido comprobar la conexión con Intervals.icu y explorar una primera
representación del perfil del ciclista. Su arquitectura y su modelo fisiológico todavía
no ofrecen la trazabilidad, seguridad y capacidad de validación necesarias para utilizar
los resultados como apoyo profesional a la prescripción.

Esta especificación define una reconstrucción progresiva. Se conservará el despliegue en
Netlify durante la primera versión y se sustituirá el HTML monolítico por una aplicación
modular en TypeScript con una API privada y persistencia estructurada.

## 2. Objetivo

Construir una aplicación privada para un entrenador de ciclismo que permita:

- consultar únicamente a sus ciclistas autorizados en Intervals.icu;
- integrar datos de potencia, actividades, entrenamientos y bienestar de forma selectiva;
- registrar tests de campo o laboratorio con protocolo, condiciones y procedencia;
- diferenciar datos medidos, importados, estimados y calculados;
- analizar el perfil potencia-duración y la pérdida de rendimiento con trabajo acumulado;
- revisar el entrenamiento prescrito frente al ejecutado;
- apoyar la decisión del entrenador sin emitir diagnósticos ni prescripciones automáticas;
- seguir la evolución del ciclista con resultados reproducibles y versionados;
- generar informes adecuados para entrenador, ciclista o familia.

## 3. Usuarios y alcance inicial

La primera versión tendrá un único entrenador administrador y aproximadamente diez
ciclistas. Puede haber menores de edad. El entrenador será el único usuario con acceso a
la aplicación durante la primera entrega.

Quedan fuera de la primera versión:

- cuentas independientes para los ciclistas;
- pagos y suscripciones;
- edición o publicación de entrenamientos en Intervals.icu;
- diagnóstico médico;
- decisiones automáticas de entrenamiento;
- modelos predictivos entrenados con aprendizaje automático;
- comparación pública entre ciclistas.

## 4. Principios de producto

### 4.1 Trazabilidad antes que completitud

Un campo vacío es preferible a un valor obtenido mediante una sustitución dudosa. Cada
valor mostrará:

- valor y unidad;
- fecha de observación;
- fuente;
- método o protocolo;
- estado de calidad;
- versión del algoritmo cuando sea derivado;
- intervalo de confianza, error típico o advertencia cuando esté disponible.

### 4.2 Conceptos fisiológicos separados

FTP, eFTP, CP, MLSS, LT1, VT1, Pmáx, potencia de cinco segundos, P@VO2máx, FRC y W′ se
almacenarán como variables distintas. La aplicación podrá mostrar relaciones entre ellas,
pero no reemplazará unas por otras silenciosamente.

### 4.3 Decisión humana obligatoria

Las recomendaciones serán borradores editables. La aplicación explicará qué observaciones
las sustentan, qué información falta y qué advertencias existen. El entrenador tendrá que
confirmar cualquier zona o prescripción antes de que aparezca en un informe.

### 4.4 Privacidad por defecto

Solo se recuperarán y almacenarán los datos necesarios. Los módulos de bienestar estarán
desactivados hasta que el entrenador los habilite expresamente y documente su finalidad.

## 5. Arquitectura

### 5.1 Opción elegida

Aplicación web modular privada:

```text
Navegador
  └── Frontend TypeScript
        └── API privada autenticada
              ├── Adaptador de Intervals.icu
              ├── Servicio de atletas y permisos
              ├── Servicio de tests y observaciones
              ├── Motor fisiológico versionado
              ├── Servicio de sesiones e informes
              └── Base de datos cifrada y copias de seguridad
```

El frontend no conocerá la clave de Intervals.icu. Todas las llamadas externas pasarán
por la API privada.

### 5.2 Frontend

- TypeScript estricto.
- Componentes separados por dominio.
- Estado remoto gestionado mediante consultas con caché y revalidación.
- Validación del formulario en cliente y servidor.
- Gráficos con resumen tabular y textual equivalente.
- Diseño adaptado a escritorio, tableta y móvil.

No se fija en esta especificación una librería visual concreta. La elección entre React,
Preact u otra alternativa se resolverá en el plan de implementación atendiendo al coste de
migración, soporte y tamaño final.

### 5.3 API privada

La API se implementará inicialmente mediante funciones de Netlify. Sus responsabilidades
serán:

- autenticar la sesión del entrenador;
- autorizar cada atleta solicitado;
- construir peticiones conocidas a Intervals.icu, sin aceptar rutas arbitrarias del cliente;
- seleccionar campos mediante listas permitidas por respuesta;
- validar y normalizar unidades;
- limitar frecuencia, tamaño de respuesta y rango temporal;
- registrar operaciones de acceso sin guardar secretos ni respuestas completas;
- aplicar tiempos máximos, reintentos limitados y cancelación;
- devolver errores estructurados y seguros.

### 5.4 Persistencia

La base de datos sustituirá `localStorage` como registro principal. Se empleará una base
PostgreSQL gestionada con cifrado en reposo. La elección del proveedor se realizará en el
plan de implementación.

Los datos originales importados no se conservarán completos por defecto. Se almacenarán
los campos normalizados necesarios, el identificador externo, la fecha de sincronización y
una huella que permita detectar cambios.

## 6. Modelo de datos

### 6.1 Athlete

- `id`: identificador interno no predecible.
- `intervalsAthleteId`: identificador externo cifrado o protegido en servidor.
- `displayName`.
- `status`: activo, archivado.
- `discipline`: ruta, BTT, CX, pista, triatlón u otra.
- `ageBand`: infantil, cadete, juvenil, sub-23, élite o máster.
- `sex`: opcional, solo cuando sea necesario para interpretar un modelo documentado.
- `trainingAgeYears`: opcional.
- `createdAt`, `updatedAt`.

La fecha de nacimiento exacta no se almacenará si una banda de edad satisface la finalidad.

### 6.2 Observation

Representa un dato fisiológico o de rendimiento individual:

- `id`, `athleteId`.
- `metric`: catálogo controlado, por ejemplo `VO2_MAX`, `POWER_AT_VO2MAX`, `FTP`,
  `EFTP`, `CRITICAL_POWER`, `W_PRIME`, `P_MAX`, `LT1_POWER`, `VT1_POWER`.
- `value`, `unit`.
- `observedAt`.
- `origin`: laboratorio, campo, Intervals.icu, manual o modelo.
- `quality`: medido, estimado, calculado, incompleto o rechazado.
- `protocolId` y `protocolVersion`.
- `device`, `environment`, `cadence`, `indoor`, `notes` cuando proceda.
- `uncertaintyLower`, `uncertaintyUpper` o `typicalError`.
- `sourceReference`.
- `createdBy`, `createdAt`.

Las observaciones serán inmutables. Una corrección crea una nueva versión y conserva la
anterior como reemplazada.

### 6.3 TestSession

Agrupa observaciones producidas durante un test:

- atleta, fecha, protocolo y versión;
- estado: borrador, completo, invalidado;
- condiciones previas: descanso, nutrición, calentamiento y fatiga declarada;
- equipamiento y calibración;
- muestras o esfuerzos realizados;
- incidencias;
- persona responsable;
- adjuntos opcionales.

### 6.4 DerivedResult

- entradas exactas mediante sus identificadores de observación;
- algoritmo y versión;
- parámetros de configuración;
- resultado, unidad e incertidumbre;
- fecha de cálculo;
- advertencias;
- estado: experimental, revisado o aprobado por el entrenador.

### 6.5 Activity y PlannedWorkout

Se almacenará una representación mínima de actividades y entrenamientos planificados:

- identificadores interno y externo;
- fecha, modalidad y duración;
- trabajo total, carga, potencia y frecuencia cardiaca resumidas;
- intervalos estructurados;
- referencia al evento o entrenamiento planificado;
- procedencia del potenciómetro y estado de calidad;
- fecha de sincronización.

### 6.6 Report

Cada informe será una instantánea reproducible que incluya:

- destinatario y finalidad;
- atleta y periodo;
- observaciones y resultados utilizados;
- versiones de modelos;
- texto editado y aprobado por el entrenador;
- fecha de generación;
- advertencias y limitaciones.

## 7. Integración con Intervals.icu

### 7.1 Autorización

La primera versión utilizará la clave del entrenador almacenada como secreto del servidor.
La aplicación tendrá autenticación propia. La lista de atletas permitidos se guardará y
aplicará en el backend.

Una petición a un atleta no autorizado devolverá `403` antes de contactar con
Intervals.icu. El frontend nunca podrá enviar una ruta completa ni elegir un endpoint
arbitrario.

### 7.2 Endpoints iniciales

Solo se habilitarán los necesarios para:

- listar atletas autorizados;
- consultar perfil y configuración deportiva;
- consultar actividades en un periodo limitado;
- consultar curvas de potencia y modelos;
- consultar streams e intervalos de una actividad seleccionada;
- consultar eventos o entrenamientos necesarios para el análisis prescrito/ejecutado.

Bienestar se desarrollará como módulo independiente y no formará parte de la sincronización
inicial.

### 7.3 Mapeo explícito

El adaptador tendrá funciones tipadas y probadas para cada respuesta. No se buscarán campos
recursivamente por nombres parecidos.

Ejemplos:

- `sportSettings.ftp` se importa como FTP de esa configuración deportiva;
- `sportSettings.indoor_ftp` se importa como FTP interior;
- `sportSettings.w_prime` se importa como W′ configurado;
- `sportSettings.p_max` se importa como Pmáx configurada;
- `PowerModel.criticalPower`, `wPrime` y `pMax` se vinculan al tipo y periodo del modelo;
- `vo2max_5m` se guarda como estimación de Intervals.icu, nunca como VO2máx medido.

### 7.4 Ventanas y calidad

Las curvas indicarán periodo, modalidad, filtros, número de actividades y fecha del último
esfuerzo relevante. Si una duración carece de esfuerzos suficientemente representativos,
se marcará como incompleta.

Se separarán al menos:

- exterior e interior cuando la información lo permita;
- ruta, BTT, CX y pista;
- ventanas de 42, 90 y 365 días;
- estado fresco y estado fatigado.

### 7.5 Sincronización

- Sincronización inicial limitada al periodo necesario.
- Actualización incremental posterior.
- Peticiones independientes en paralelo cuando no exista dependencia.
- Cancelación de peticiones al cambiar de atleta.
- Presentación de resultados parciales si falla un recurso opcional.
- Registro visible de la última sincronización y de las fuentes que fallaron.

## 8. Motor fisiológico

### 8.1 Clasificación de evidencia

Cada resultado mostrará una de estas categorías:

- **Medición directa:** protocolo registrado y datos primarios suficientes.
- **Estimación validada:** método publicado aplicado dentro de su población y condiciones.
- **Estimación exploratoria:** método con limitaciones relevantes o fuera de validación.
- **Heurística interna:** regla de trabajo del entrenador sin respaldo suficiente para
  presentarla como variable fisiológica.

### 8.2 Perfil potencia-duración

Se utilizarán las curvas de Intervals.icu y se conservará el tipo de modelo elegido. CP,
W′ y Pmáx siempre quedarán ligados al modelo, periodo y puntos de entrada.

La interfaz mostrará:

- curva observada y curva modelada;
- puntos empleados para ajustar el modelo;
- error de ajuste;
- periodos con falta de esfuerzos máximos;
- comparación con periodos anteriores;
- valores absolutos y relativos al peso.

### 8.3 Durabilidad

La durabilidad no será un campo manual de 0–100. Se calculará como la pérdida de rendimiento
después de trabajo acumulado.

Variables mínimas:

- cambio de MMP a 10 s, 1 min, 5 min y 20 min;
- trabajo previo en kJ/kg;
- trabajo previo por encima de CP;
- intensidad de acumulación;
- momento de inicio del deterioro;
- desacoplamiento potencia-frecuencia cardiaca cuando sea válido;
- número de observaciones detrás de cada estimación.

La comparación se realizará entre condiciones compatibles y mostrará incertidumbre.

### 8.4 VLa máx o tasa pico de acumulación

El módulo tendrá un protocolo guiado. Registrará:

- lactato previo y criterio de aceptación;
- calentamiento;
- duración y modo del esprint;
- resistencia, cadencia y potencia segundo a segundo;
- método del tiempo aláctico;
- muestras posteriores con minuto exacto;
- dispositivo y lugar de muestreo;
- pico observado y confirmación de descenso posterior;
- ecuación aplicada y sensibilidad al tiempo aláctico.

La aplicación no declarará una VLa máxima si el protocolo solo permite estimar una tasa
pico. No rellenará una única muestra posterior obtenida de Intervals.icu como si fuera el
pico del test.

### 8.5 Modelo de Mader

El modelo permanecerá como módulo experimental y aislado. Deberá:

- declarar ecuaciones, constantes y versión;
- usar únicamente entradas compatibles con el protocolo;
- permitir introducir o medir el coste de oxígeno y VO2 basal;
- registrar cadencia y advertir cuando no se modele su efecto;
- ejecutar análisis de sensibilidad;
- mostrar un intervalo de incertidumbre;
- comparar el resultado con LT2, MLSS, FTP o CP sin equipararlos;
- impedir que FATmax sustituya automáticamente a LT1;
- requerir aprobación explícita para utilizar un resultado en zonas o informes.

### 8.6 Índices internos

Las actuales puntuaciones de 0–100 y el radar se retirarán de la vista profesional hasta
que exista una referencia documentada. Si se recuperan, deberán:

- indicar que son índices internos;
- mostrar la fórmula y población de referencia;
- estratificar cuando la evidencia lo exija;
- evitar términos de diagnóstico;
- no alimentar automáticamente la prescripción.

## 9. Análisis de entrenamiento

### 9.1 Prescrito frente a ejecutado

La fuente principal será el entrenamiento estructurado de Intervals.icu y su vínculo con la
actividad. La interpretación del título quedará como alternativa manual claramente marcada.

La comparación alineará:

- calentamiento;
- bloques;
- repeticiones;
- recuperaciones;
- vuelta a la calma.

Para cada bloque se mostrarán duración, potencia objetivo, potencia realizada, variabilidad,
frecuencia cardiaca, cadencia, RPE y cumplimiento. El algoritmo no reducirá el resultado a
un único porcentaje cuando el entrenamiento tenga objetivos diferentes.

### 9.2 Contexto

El informe de sesión podrá incorporar:

- fatiga declarada;
- carga reciente;
- disponibilidad de sueño o HRV si el módulo está autorizado;
- temperatura;
- interior o exterior;
- incidencias de equipamiento;
- comentario del ciclista y del entrenador.

## 10. Prescripción

El generador producirá un borrador basado en:

- objetivo competitivo y demandas de la prueba;
- fase de temporada;
- disponibilidad semanal;
- historial reciente de carga y recuperación;
- fortalezas y limitaciones sustentadas por datos;
- respuesta a entrenamientos previos;
- edad deportiva y banda de edad;
- restricciones o lesiones declaradas.

Cada propuesta mostrará:

- objetivo fisiológico;
- datos utilizados;
- motivo de la elección;
- dosis inicial;
- criterio de progresión;
- criterio para reducir o cancelar;
- forma de evaluar la respuesta;
- campos que requieren decisión del entrenador.

En menores se evitarán etiquetas permanentes, rankings y especialización automática.

## 11. Experiencia de uso

### 11.1 Navegación

Orden propuesto:

1. Inicio.
2. Datos y tests.
3. Potencia y durabilidad.
4. Sesiones.
5. Prescripción.
6. Evolución.
7. Informes.
8. Configuración.

El selector de ciclista, el periodo y el estado de sincronización estarán en una cabecera
persistente. La configuración técnica de Intervals.icu no aparecerá en el flujo cotidiano.

### 11.2 Inicio

La aplicación arrancará sin datos de ejemplo. La pantalla inicial mostrará:

- ciclista seleccionado;
- última sincronización;
- completitud y calidad de datos;
- cambios relevantes desde la revisión anterior;
- sesiones pendientes de revisar;
- alertas de datos caducados o incompatibles.

El ejemplo será un modo demostración separado, con identificación visual permanente y sin
capacidad de mezclarse con ciclistas reales.

### 11.3 Presentación de datos

Cada tarjeta mostrará el valor principal, unidad, fecha, fuente y calidad. Los colores nunca
serán el único medio para comunicar estado. Las comparaciones longitudinales mostrarán el
cambio junto al error de medida.

### 11.4 Informes

La exportación generará documentos específicos. No imprimirá todas las pantallas de la
aplicación. Habrá tres plantillas:

- informe técnico para entrenador;
- explicación breve para ciclista;
- explicación para familia o tutor cuando proceda.

## 12. Accesibilidad

Objetivo: WCAG 2.1 AA.

- Estructura semántica con encabezados y regiones.
- Pestañas con roles, estado seleccionado y control por teclado.
- `label` asociado a cada campo mediante `for` e `id`.
- Foco visible en todos los elementos interactivos.
- Objetivos táctiles de al menos 44 × 44 píxeles.
- Contraste mínimo de 4,5:1 para texto normal y 3:1 para controles y texto grande.
- Alternativa textual y tabla para cada gráfico.
- Errores asociados al campo y anunciados por tecnologías de asistencia.
- Tablas desplazables y legibles en móvil.
- Navegación móvil compacta que no ocupe la primera pantalla completa.
- Pruebas con teclado, VoiceOver y zoom al 200%.

## 13. Seguridad y protección de datos

### 13.1 Controles técnicos

- Autenticación con sesión segura, caducidad e invalidación.
- Autorización por atleta en cada operación.
- Clave de Intervals.icu almacenada solo en el gestor de secretos.
- Ningún secreto en URL, código cliente, `localStorage`, logs o informes.
- Lista permitida de endpoints, parámetros y campos de respuesta.
- Limitación de peticiones e intentos de acceso.
- Cabeceras de seguridad sin `unsafe-inline` cuando termine la migración.
- Dependencias versionadas, verificadas y servidas localmente cuando sea viable.
- Cifrado en tránsito y reposo.
- Copias de seguridad cifradas y prueba periódica de restauración.
- Registro de accesos y cambios sin contenido fisiológico completo.
- Política de vulnerabilidades y actualización de dependencias.

### 13.2 Controles organizativos

Antes de producción se documentarán:

- responsable y finalidad del tratamiento;
- base jurídica;
- categorías de datos;
- proveedores y encargados;
- transferencias internacionales;
- plazos de conservación;
- proceso de acceso, rectificación, exportación y eliminación;
- gestión de incidentes;
- consentimiento o autorización cuando proceda;
- evaluación de impacto para menores y datos de salud cuando corresponda.

La revisión jurídica queda fuera del desarrollo de software y es un requisito previo a la
puesta en producción profesional.

## 14. Errores y estados parciales

La interfaz diferenciará:

- falta de autorización;
- dato inexistente;
- dato caducado;
- respuesta parcial;
- incompatibilidad de protocolo;
- insuficiencia de esfuerzos máximos;
- fallo temporal de Intervals.icu;
- error interno.

Un fallo opcional no borrará datos válidos ya guardados. Los cambios de atleta cancelarán
peticiones pendientes para impedir que una respuesta tardía se asigne a otra persona.

## 15. Estrategia de pruebas

### 15.1 Pruebas fisiológicas

- Casos de referencia publicados o calculados independientemente.
- Pruebas de unidades y conversiones.
- Límites fisiológicamente imposibles.
- Propagación de incertidumbre.
- Sensibilidad a las entradas de cada modelo.
- Comparación contra cálculos manuales revisados.
- Pruebas de no equivalencia: FTP no debe convertirse en CP, LT1 o MLSS sin un método
  explícito.

### 15.2 Integración

- Contratos generados desde el OpenAPI.
- Respuestas reales anonimizadas y guardadas como fixtures.
- Campos ausentes, nulos y nuevos.
- Diferentes modalidades y configuraciones interior/exterior.
- Caducidad, límite de peticiones y respuesta parcial.
- Garantía de que un atleta no autorizado nunca llega a Intervals.icu.

### 15.3 Aplicación

- Pruebas unitarias de dominio.
- Pruebas de componentes.
- Flujos de extremo a extremo: seleccionar atleta, sincronizar, registrar test, revisar
  sesión, aprobar recomendación y generar informe.
- Comprobación de que cambiar de atleta limpia y cancela el estado anterior.
- Accesibilidad automatizada y revisión manual.
- Vista móvil y exportación de informes.
- Pruebas de restauración y migraciones de base de datos.

## 16. Migración

### Fase 0 — Contención

- Proteger el despliegue actual con autenticación real o retirarlo temporalmente.
- Limitar el proxy a rutas y atletas utilizados.
- Retirar el código de acceso de la URL.
- Fijar Chart.js o servirlo localmente.
- Corregir errores de duración y escape de contenido.
- Arrancar sin datos de ejemplo.
- Desactivar prescripciones basadas en puntuaciones heurísticas.
- Añadir avisos inequívocos a estimaciones y al modelo de Mader.

### Fase 1 — Base modular

- Crear el frontend TypeScript y la API privada.
- Definir contratos y modelo de datos.
- Implementar autenticación, autorización y persistencia.
- Crear el adaptador tipado de Intervals.icu.
- Migrar selección de atleta y sincronización básica.
- Configurar pruebas, análisis estático y CI.

### Fase 2 — Perfil validable

- Migrar observaciones y tests con procedencia.
- Implementar curva potencia-duración y calidad del ajuste.
- Implementar durabilidad.
- Crear el protocolo guiado de lactato.
- Encapsular el modelo de Mader como experimental.
- Incorporar evolución longitudinal.

### Fase 3 — Trabajo del entrenador

- Comparar entrenamiento estructurado y actividad.
- Crear recomendaciones explicables y editables.
- Añadir informes específicos.
- Completar diseño móvil y auditoría WCAG.
- Documentar operación, copias y recuperación.

La aplicación actual permanecerá disponible solo como referencia durante la migración. El
archivo antiguo que no se publica se archivará cuando se confirme que no contiene lógica
única.

## 17. Criterios de aceptación

La primera versión profesional se considerará terminada cuando:

1. El entrenador debe autenticarse y solo puede consultar atletas autorizados.
2. Ningún secreto aparece en navegador, URL, repositorio, logs o documentos exportados.
3. Cambiar de atleta no puede mezclar datos ni respuestas pendientes.
4. Cada valor muestra fuente, fecha, estado de calidad y protocolo o algoritmo.
5. Medido, importado, estimado y calculado son estados visibles y persistentes.
6. FTP, eFTP, CP, MLSS, LT1, Pmáx, P@VO2máx y W′ se mantienen separados.
7. Los modelos tienen pruebas numéricas y una versión reproducible.
8. El modelo de Mader figura como experimental y no modifica zonas automáticamente.
9. La durabilidad se calcula desde pérdida de rendimiento tras trabajo acumulado.
10. El análisis prescrito/ejecutado usa el entrenamiento estructurado cuando existe.
11. Toda prescripción requiere revisión y aprobación del entrenador.
12. Los informes contienen fecha, fuentes, modelos, advertencias y autor de aprobación.
13. La aplicación pasa las pruebas funcionales, de seguridad y accesibilidad definidas.
14. Existe copia de seguridad restaurable y procedimiento de exportación y eliminación.
15. Se ha completado la documentación de protección de datos necesaria para producción.

## 18. Referencias científicas y normativas iniciales

- Dunst AK, Hesse C, Ueberschär O. *Enhancing endurance performance predictions: the
  role of movement velocity in metabolic simulations demonstrated by cycling cadence*.
  European Journal of Applied Physiology, 2025. DOI: 10.1007/s00421-024-05663-4.
- Quittmann OJ et al. *Maximal lactate accumulation rate: Current evidence and future
  directions for exercise testing and training*. European Journal of Applied Physiology,
  2025. DOI: 10.1007/s00421-025-06022-7.
- Sablain M et al. *Evaluating the maximal rate of lactate accumulation and estimated
  maximal lactate steady state in cycling*. European Journal of Applied Physiology, 2025.
  DOI: 10.1007/s00421-025-05751-z.
- Poffé C, Van Dael K, Van Schuylenbergh R. *INSCYD physiological performance software is
  valid to determine the maximal lactate steady state in male and female cyclists*.
  Frontiers in Sports and Active Living, 2024. DOI: 10.3389/fspor.2024.1376876.
- Maunder E et al. *The Importance of Durability in the Physiological Profiling of
  Endurance Athletes*. Sports Medicine, 2021. DOI: 10.1007/s40279-021-01459-0.
- Leo P et al. *Power profiling and the power-duration relationship in cycling: a
  narrative review*. European Journal of Applied Physiology, 2022.
  DOI: 10.1007/s00421-021-04833-y.
- Jones AM et al. *The Critical Power Concept: Applications to Sports Performance with a
  Focus on Intermittent High-Intensity Exercise*. Sports Medicine, 2017.
  DOI: 10.1007/s40279-017-0688-0.
- AEPD. Guía de privacidad desde el diseño y directrices para aplicaciones de actividad
  física, bienestar y salud.

## 19. Riesgos abiertos para el plan de implementación

- Confirmar si el despliegue publicado está actualmente accesible y con qué protección.
- Elegir proveedor de autenticación y base de datos.
- Obtener fixtures anonimizados representativos de todos los ciclistas y modalidades.
- Confirmar qué datos de bienestar tienen una finalidad necesaria.
- Definir con el entrenador los protocolos exactos que utiliza en campo y laboratorio.
- Decidir qué modelos de potencia de Intervals.icu se admitirán inicialmente.
- Revisar el tratamiento de datos de menores con asesoramiento jurídico.

Estos puntos no cambian la arquitectura aprobada. Se resolverán antes de implementar el
módulo afectado y quedarán registrados como decisiones técnicas.
