# Escenarios metabólicos

Fecha: 16 de septiembre de 2026
Estado: aprobado para revisión del usuario

## Contexto

MFPP Metabolic Lab ya reproduce el modelo de Mader y deriva de él el reparto de sustratos.
`mader-reproduction@1.0.0` entrega MLSS y FATmax modelados con su sensibilidad, y
`substrate-metabolism@1.0.0` entrega la oxidación de grasa en gramos por minuto, el consumo
de carbohidrato en gramos por hora y el gasto energético por vatio. Ambos exigen entradas
con procedencia y emiten avisos cuando un valor procede de software de terceros, como la
VLa máx que el entrenador introduce desde WKO5.

Lo que la aplicación no hace todavía es responder a la pregunta con la que trabaja un
entrenador delante de un perfil. Ver que un ciclista tiene una VLa máx baja y un perfil muy
oxidativo no decide nada por sí solo: la decisión aparece al confrontarlo con la prueba que
ese ciclista va a correr. Una prueba explosiva, de latigazo en latigazo, exige una capacidad
glucolítica que un perfil muy oxidativo no tiene, y el entrenador necesita ver qué ocurriría
si la subiera y qué pagaría por ello.

Existe además una carencia previa. La vista de Mader y sustratos solo está montada con
valores de demostración escritos en `src/app/DemoViews.tsx`. Nunca ha leído las
observaciones reales de un ciclista. Este bloque la conecta, porque un simulador alimentado
con datos ficticios no tiene ningún valor profesional.

Todo el trabajo se realizará exclusivamente en
`/Users/manuelfrancisperezperez/Desktop/MFPP Metabolic Lab`.

## Objetivo

Permitir que el entrenador formule una hipótesis sobre el perfil metabólico de un ciclista
real, vea sus consecuencias sobre el reparto de sustratos junto al perfil actual, y disponga
del coste del cambio en la misma pantalla que el beneficio, con toda la procedencia y todas
las limitaciones a la vista.

## Alcance

Incluido:

- Ruta de Tests real: ciclista activo, sin demostración, con estados de perfil incompleto.
- Lectura de las observaciones reales del ciclista activo para alimentar el modelo de Mader.
- Entrada manual de las métricas que Intervals.icu no devuelve, incluida `p_vo2max`.
- Escenario con VLa máx objetivo obligatoria y VO₂max objetivo opcional.
- Perfil de prueba y banda orientativa de VLa máx tomada de la literatura y citada.
- Curvas de oxidación de grasa actual y objetivo en un mismo gráfico, con FATmax de cada
  una, MLSS de cada una y referencia del FTP medido.
- Tabla comparativa y lectura del cambio, con lo que se gana y lo que se pierde.
- Aviso cuando la diferencia propuesta cae dentro de la propia sensibilidad del modelo.
- Guardado explícito del escenario, inmutable y reproducible.
- Pruebas unitarias, numéricas, de base de datos, de seguridad y de accesibilidad.

Fuera de este bloque:

- Sesiones o prescripciones para alcanzar el objetivo. El escenario termina en la lectura.
- Plazos, probabilidades o juicios de alcanzabilidad del objetivo.
- Porcentaje de grasa corporal, masa magra, reservas de glucógeno y nutrición.
- Las rutas de Sesiones, Prescripción, Evolución e Informes, que siguen en demostración.
- Masa corporal como palanca del escenario.
- Escritura de cualquier valor del escenario en Intervals.icu.
- Cualquier escritura de un valor objetivo en `observations`.

## Decisiones funcionales

### Qué es un escenario

Un escenario será una hipótesis fechada y firmada por el entrenador. Contendrá el perfil
real del ciclista, con la procedencia de cada entrada, y un conjunto de valores objetivo
propuestos por él. La aplicación responderá a una sola pregunta: si este ciclista tuviera
esa VLa máx y ese VO₂max, cómo quedaría su reparto de sustratos.

Un escenario no dirá si el objetivo es alcanzable, ni en cuánto tiempo, ni con qué
entrenamiento, ni con qué probabilidad. Tampoco será una predicción del futuro del
ciclista. Es aritmética del modelo sobre unos valores supuestos.

### Un valor objetivo no es una observación

Ningún valor objetivo se escribirá en `observations`, en `derived_results` ni en ninguna
tabla de mediciones. Vivirá exclusivamente en la tabla del escenario. El motivo es de
seguridad del dato: una VLa máx objetivo de 0,42 guardada junto a las mediciones sería
indistinguible, meses después, de una VLa máx medida.

La interfaz reforzará la separación. El perfil actual y el objetivo nunca compartirán
tratamiento visual: el actual se dibujará con trazo continuo y el objetivo con trazo
discontinuo, y toda cifra objetivo irá acompañada de la palabra «objetivo» en su etiqueta,
también en la alternativa textual y en la tabla.

### Las entradas reales mandan

El escenario exigirá primero un perfil real válido. Se construirá a partir de las
observaciones del ciclista activo, tomando la más reciente de cada métrica necesaria:
VO₂max, VLa máx, masa corporal y P@VO₂max, más el FTP para la referencia del gráfico.

Si el motor de Mader bloquea el perfil real por procedencia o por calidad insuficiente, el
escenario quedará bloqueado con las mismas razones. No habrá escenario sin perfil real: una
hipótesis construida sobre datos que no superan la guarda no es más fiable que la guarda que
se ha saltado.

### Palancas

El escenario admitirá dos palancas, las dos del propio modelo:

- **VLa máx objetivo**, obligatoria, en mmol·l⁻¹·s⁻¹.
- **VO₂max objetivo**, opcional, en ml·kg⁻¹·min⁻¹. Si se deja vacía se conservará la real.

La masa corporal y la P@VO₂max se conservarán siempre en su valor real. Mover el peso
mezclaría dos conversaciones distintas y alteraría la conversión a vatios, con lo que la
comparación dejaría de ser limpia.

Cada palanca se validará contra el rango del catálogo de métricas. Fuera del intervalo
habitual descrito en la literatura, el valor se aceptará pero la pantalla advertirá de que
queda fuera de lo observado en la bibliografía disponible.

Si el objetivo coincide con el valor real hasta la precisión mostrada, no se dibujará una
segunda curva y la pantalla lo dirá: no hay nada que comparar.

### Perfil de prueba y banda orientativa

El entrenador seleccionará el perfil de la prueba objetivo entre cuatro valores:
`explosiva`, `rodador`, `escalador` y `fondo`. La selección sombreará en el eje de entrada
una banda orientativa de VLa máx con su cita bibliográfica visible.

La banda será orientación, nunca objetivo. El número lo seguirá tecleando el entrenador, la
banda solo indicará dónde cae respecto a lo publicado. Ninguna banda se mostrará sin la
referencia de la que se leyó: si un perfil de prueba no dispone de banda sustentada, se
mostrará sin banda antes que con un intervalo inventado.

### Guardado explícito

Por defecto el escenario será exploración en pantalla y no se guardará. Un botón de guardado
lo fijará con nombre, justificación, fecha, autor, entradas reales usadas y resultado
calculado. Solo un escenario guardado podrá citarse en un informe, y solo si el resultado de
Mader del que depende fue reconocido por el entrenador.

Un escenario guardado conservará copia de las entradas reales que usó. Si más adelante se
vuelve a medir la VLa máx del ciclista, el escenario antiguo seguirá reproduciendo su
resultado en lugar de cambiar solo.

## Modelo fisiológico

### `metabolic-scenario@1.0.0`

El escenario no introducirá ecuaciones nuevas. Proyectará dos veces la misma aritmética ya
versionada: el barrido de estados metabólicos de `mader-reproduction@1.0.0` y el reparto de
sustratos de `substrate-metabolism@1.0.0`. La versión propia documenta la comparación, no el
cálculo.

### Separación entre puerta y proyección

`buildSubstrateProfile` mezcla hoy dos responsabilidades: la guarda de procedencia, que
llama a `runMaderModel`, y la proyección numérica de la curva. Se separarán en dos piezas:

- una proyección pura que recibe valores numéricos y la configuración, y devuelve la curva,
  FATmax y MLSS;
- la función actual, que conservará su comportamiento y su firma: primero la guarda, después
  la proyección.

El escenario ejecutará la guarda **una sola vez**, sobre las entradas reales, y llamará a la
proyección dos veces: con los valores reales y con los objetivo. Así el resultado real y la
curva actual del escenario son numéricamente idénticos, la guarda de procedencia no se toca
ni se debilita, y no existe ninguna ruta por la que un valor sin observación pueda atravesar
`runMaderModel`.

### Lectura del cambio

Bajo el gráfico, el escenario publicará el precio del cambio en cifras derivadas de las dos
proyecciones:

- desplazamiento del FATmax, en vatios y en gramos de grasa por minuto;
- desplazamiento del MLSS, en vatios;
- cambio del consumo de carbohidrato, en gramos por hora, a una potencia de referencia;
- cambio del porcentaje de VO₂max al que cae cada punto.

La potencia de referencia será por defecto el FTP medido del ciclista, y el entrenador podrá
fijar otra dentro del rango de la curva. Sobre ella se leerá el efecto práctico del cambio a
una intensidad que el entrenador reconoce.

El texto que acompañe a la lectura se generará a partir de los valores calculados, en
ningún caso se escribirá a mano. Esto incluye el título del gráfico y las etiquetas de cada
FATmax. Un rótulo tecleado puede contradecir a la curva que acompaña, y una figura que
afirma dos cifras distintas del mismo punto no es utilizable en un informe.

### Diferencias indistinguibles del ruido del modelo

`runMaderModel` ya calcula la sensibilidad del resultado a una variación de la VLa máx. Si
la diferencia entre el objetivo y el valor real no supera ese delta, el escenario lo dirá
con claridad: la separación entre las dos curvas no se distingue de la propia incertidumbre
del modelo. Las curvas se seguirán dibujando, pero la lectura no presentará el cambio como
un efecto.

### Límites heredados

El escenario heredará y mostrará, sin excepción, todas las limitaciones ya documentadas:
carácter experimental de la reproducción de Mader, coste de oxígeno deducido y no medido,
cadencia no modelada, reparto de sustratos derivado de la propia glucólisis del modelo y no
de calorimetría indirecta, consumo de carbohidrato infravalorado por debajo de FATmax, y
extinción de la oxidación de grasas exactamente en el MLSS.

Esta última merece mención propia en la pantalla. En un escenario con VLa máx alta la curva
objetivo cae a cero gramos por minuto dentro del rango dibujado, y eso es un artefacto de la
formulación, no una afirmación fisiológica. El gráfico lo rotulará donde ocurra.

Se añade una limitación nueva: el modelo trata VLa máx y VO₂max como parámetros
independientes, y el entrenamiento que mueve uno rara vez deja el otro intacto. Un escenario
que solo sube la VLa máx describe un cambio aislado que el organismo no suele conceder por
separado.

## Bandas de referencia `vlamax-reference-bands@1.0.0`

Las bandas se declararán en un módulo de referencia versionado, junto a las constantes de
los demás modelos, con esta forma por entrada: perfil de prueba, límite inferior, límite
superior, población descrita y cita completa con DOI.

La población descrita es obligatoria y se mostrará junto a la banda, porque un intervalo
leído en ciclistas adultos entrenados no describe a un cadete. Las revisiones de Quittmann
y colaboradores (2025) y de Sablain y colaboradores (2025), ya incorporadas al registro de
modelos del proyecto, son la fuente de la que se extraerán los valores iniciales.

Ambas versiones nuevas, `metabolic-scenario@1.0.0` y `vlamax-reference-bands@1.0.0`, se
incorporarán a `docs/model-register.md` con sus entradas, salidas, estado y límites, como
exige el proyecto para toda regla o modelo.

Regla de publicación: cada banda se acompañará de la referencia concreta de la que se leyó.
Un perfil de prueba sin banda sustentada se ofrecerá sin banda. Cambiar un límite exigirá
versión nueva del módulo, igual que cualquier otra constante del proyecto.

## Campos nuevos

En el escenario:

- `target_vlamax`, obligatorio.
- `target_vo2max`, opcional.
- `event_profile`, uno de `explosiva`, `rodador`, `escalador`, `fondo`.
- `reference_power_watts`, la potencia sobre la que se lee el efecto práctico.
- `scenario_name`, nombre corto con el que el entrenador lo reconocerá.
- `rationale`, texto libre con el motivo del movimiento propuesto. Es el criterio
  profesional del entrenador y será lo que justifique el escenario en un informe.

En el catálogo de métricas no se añade nada: VO₂max, VLa máx, masa corporal, P@VO₂max y FTP
ya existen con sus unidades y rangos.

## La ruta de Tests deja de ser una demostración

Cinco rutas de la aplicación siguen sirviendo datos sintéticos desde `src/app/DemoViews.tsx`:
Tests, Sesiones, Prescripción, Evolución e Informes. Solo Potencia y Durabilidad trabajan
con el ciclista real.

Este bloque convierte **Tests** en una ruta real, porque es donde vive el modelo de Mader y
sin ella el escenario no existe. Las otras cuatro quedan fuera de esta spec y se abordarán
después, cada una con su propio diseño: Evolución, Sesiones, Prescripción e Informes, en ese
orden, porque Informes depende de las tres anteriores.

Al terminar este bloque, la ruta de Tests mostrará el ciclista activo del contexto común, sin
botón de demostración y sin datos sintéticos.

### Entradas que Intervals.icu no devuelve

La API entrega FTP, peso, curva de potencia y actividades, pero **no devuelve VO₂max,
VLa máx, P@VO₂max, TTE ni Stamina**. El modelo de Mader necesita tres de esos valores, así
que el entrenador los introducirá a mano por el formulario de observaciones que ya existe,
con su origen, su protocolo y su fecha.

El formulario ofrece hoy nueve métricas y **P@VO₂max no está entre ellas**, de modo que el
modelo no puede alimentarse por completo desde la interfaz. Se añadirán a la lista
seleccionable `p_vo2max`, `pmax` y `tte`, que ya existen en el catálogo con su unidad y su
rango. La VLa máx procedente de WKO5 seguirá entrando con origen `external_model` y el
programa nombrado, como exige la guarda de procedencia.

### El test de esprint con lactato

El asistente de esprint con lactato dejará de trabajar sobre valores fijos: operará sobre el
ciclista activo y su resultado confirmado se guardará como observación suya, con el origen y
el protocolo del test. Un resultado que no supere las condiciones del protocolo seguirá sin
etiquetarse como VLa máx, tal y como hace hoy `lactate-sprint@1.0.0`.

### Perfil incompleto

Ningún ciclista de la base tiene hoy VO₂max, VLa máx ni P@VO₂max. La ruta de Tests lo dirá
con precisión: qué métrica falta, qué protocolo la produce y qué queda bloqueado mientras
falte. Un perfil incompleto es un estado legítimo y frecuente, no un error de la aplicación.

## Arquitectura de cliente

- Un módulo de lectura construirá las entradas del modelo a partir de las observaciones
  del ciclista activo, tomando la observación más reciente de cada métrica y conservando
  identificador, calidad, origen y referencia de software. Este módulo es la pieza que
  sustituye a los valores de demostración.
- Un módulo de escenario, puro y sin dependencias de interfaz, ejecutará la guarda una vez
  y la proyección dos, y devolverá las dos curvas, los dos juegos de anclajes, la lectura
  del cambio, los avisos y las limitaciones.
- Un componente de gráfico comparado, construido sobre el actual de sustratos, con las dos
  curvas, los anclajes rotulados y la vertical del FTP. Las anotaciones se resolverán con un
  complemento propio de Chart.js, sin añadir dependencias nuevas al proyecto.
- Un formulario de escenario con las palancas, el perfil de prueba, la potencia de
  referencia, el nombre y la justificación.
- Un adaptador de API para guardar y recuperar escenarios.

La vista de Mader pasará de estar montada solo en la demostración a tener su lugar en la
aplicación, alimentada por el ciclista activo del contexto común, igual que Potencia y
Durabilidad.

## Arquitectura de servidor

Una función de servidor atenderá el guardado y la consulta de escenarios. Validará la
autorización sobre el ciclista antes de cualquier lectura o escritura, recalculará el
resultado en el servidor a partir de las entradas recibidas en vez de confiar en el
resultado enviado por el navegador, y escribirá mediante `service_role` como el resto de la
escritura fisiológica del proyecto.

## Modelo de datos

### `metabolic_scenarios`

- `id uuid`.
- `athlete_id uuid`.
- `created_by uuid`.
- `scenario_name text`.
- `rationale text`, con límite de longitud.
- `event_profile text`, restringido a los cuatro valores admitidos.
- `real_inputs jsonb`, con valor, unidad, calidad, origen, identificador de observación y
  referencia de software de cada entrada real.
- `targets jsonb`, con la VLa máx objetivo y, si existe, el VO₂max objetivo.
- `reference_power_watts numeric`.
- `config jsonb`, con el VO₂ de reposo configurado.
- `model_versions jsonb`, con las versiones de Mader, sustratos, escenario y bandas.
- `outcome jsonb`, con FATmax y MLSS de los dos perfiles y la lectura del cambio.
- `content_hash text`, huella de entradas, objetivos y configuración, que evita guardar
  dos veces el mismo escenario sin impedir versiones distintas del mismo ciclista.
- `created_at timestamptz`.

Las filas serán inmutables: corregir un escenario creará otro. La lectura seguirá la RLS de
acceso al ciclista; la escritura será exclusiva de la función de servidor. El guardado
dejará un evento en `audit_events`, como el resto de decisiones del proyecto.

## Pantalla

La jerarquía será: perfil real con su procedencia; formulario del escenario; gráfico
comparado; lectura del cambio; tabla comparativa; avisos y limitaciones; guardado.

El gráfico mostrará la curva actual con trazo continuo, la objetivo con trazo discontinuo,
el FATmax de cada una marcado y rotulado con vatios y gramos por minuto, y una vertical
punteada en el FTP medido.

El MLSS de cada perfil es, en esta formulación, el punto exacto en que su curva llega a cero
gramos de grasa por minuto. Donde ese punto caiga dentro del rango dibujado se rotulará como
MLSS modelado y se advertirá en el mismo rótulo de que la extinción completa de la oxidación
de grasas es un artefacto de la formulación. Donde caiga fuera, el MLSS aparecerá solo en la
tabla.

La tabla repetirá en texto todo lo que el gráfico dice: para cada perfil, FATmax y MLSS en
vatios y en porcentaje de VO₂max, grasa en gramos por minuto, carbohidrato en gramos por
hora y gasto energético, más la fila de diferencias.

## Accesibilidad

El gráfico llevará alternativa textual que nombre las dos curvas y sus anclajes con cifras,
no solo su existencia. Toda la información del gráfico estará disponible en la tabla. El
formulario será operable con teclado, con foco visible y contraste suficiente, y los errores
de validación se anunciarán al lector de pantalla. La distinción entre perfil actual y
objetivo no dependerá solo del color: el trazo y la etiqueta la sostendrán por separado.
Se verificará en móvil de 360 px y con la escala de navegador al 200 %.

## Estados y errores

- Sin ciclista activo: la pantalla pedirá seleccionarlo, sin cálculo.
- Faltan observaciones para el modelo: se nombrará cuál falta y qué protocolo la produce.
- El perfil real no pasa la guarda: se mostrarán las razones del motor, sin escenario.
- VLa máx objetivo ausente o fuera del rango del catálogo: el cálculo no se ejecutará.
- Objetivo igual al valor real: una sola curva y aviso de que no hay comparación.
- Diferencia dentro de la sensibilidad del modelo: dos curvas y aviso explícito.
- Sin FTP medido: el gráfico se dibujará sin la vertical y lo advertirá, y la potencia de
  referencia pasará a ser el MLSS modelado actual.
- Error al guardar: el escenario permanecerá en pantalla con sus valores intactos.

## Seguridad y privacidad

Los escenarios contienen datos de salud y quedan bajo los mismos controles que el resto:
autorización por ciclista, RLS, escritura por función de servidor y registro de auditoría.
Ningún valor del escenario viaja a Intervals.icu.

En menores, el escenario añadirá un aviso propio: en un ciclista en maduración el perfil se
desplaza por crecimiento, de modo que un objetivo de VLa máx describe una hipótesis de
trabajo y no una asignación de especialidad. Esto es coherente con la decisión del
entrenador del 16 de septiembre de 2026: la etiqueta de fenotipo va fechada y ligada al
test, nunca como atributo fijo. La prohibición de especialización automática se mantiene: el
escenario no elegirá el perfil de prueba por el ciclista, lo elige el entrenador.

## Pruebas y aceptación

Fisiológicas:

- Casos numéricos del escenario con entradas conocidas y salidas fijadas.
- Subir la VLa máx desplaza FATmax y MLSS a menos vatios y reduce la oxidación de grasa en
  FATmax; bajarla los desplaza en sentido contrario.
- La curva actual del escenario coincide exactamente con la de `buildSubstrateProfile`
  sobre las mismas entradas, tras la separación entre guarda y proyección.
- Un objetivo dentro de la sensibilidad del modelo produce el aviso correspondiente.
- Un perfil real bloqueado bloquea el escenario con las mismas razones.

De datos y seguridad:

- Un valor objetivo nunca aparece en `observations` ni en `derived_results`.
- Un escenario guardado es inmutable y conserva las entradas reales usadas.
- Un ciclista no autorizado no puede leer ni escribir escenarios.
- El servidor recalcula el resultado y no acepta el enviado por el cliente.

De aplicación:

- El texto del título y de las etiquetas procede del cálculo: una prueba fija unas entradas
  y comprueba que la cifra del rótulo y la del anclaje son la misma.
- La vista de Mader se alimenta de las observaciones del ciclista activo y cambia con él.
- Accesibilidad con axe, teclado, móvil de 360 px y escala al 200 %.

Criterio de aceptación del bloque: con un ciclista real y sus observaciones reales, el
entrenador introduce una VLa máx objetivo, obtiene las dos curvas con sus anclajes, lee el
coste del cambio, guarda el escenario, recarga la aplicación y lo recupera íntegro con su
procedencia y sus limitaciones.

## Fuentes

- Mader A. Eine Theorie zur Berechnung der Dynamik und des Steady State von
  Phosphorylierungszustand und Stoffwechselaktivität der Muskelzelle (1984).
- Mader A, Heck H. A theory of the metabolic origin of anaerobic threshold (1986).
- Dunst AK, Hesse C, Ueberschär O. *European Journal of Applied Physiology* (2025).
  DOI: 10.1007/s00421-024-05663-4.
- Quittmann OJ et al. Maximal lactate accumulation rate: current evidence and future
  directions. *European Journal of Applied Physiology* (2025).
  DOI: 10.1007/s00421-025-06022-7.
- Sablain M et al. Evaluating maximal lactate accumulation rate and estimated MLSS in
  cycling. *European Journal of Applied Physiology* (2025).
  DOI: 10.1007/s00421-025-05751-z.
- Frayn KN. *Journal of Applied Physiology* (1983). DOI: 10.1152/jappl.1983.55.2.628.
- Jeukendrup AE, Wallis GA. *International Journal of Sports Medicine* (2005).
  DOI: 10.1055/s-2004-830512.
