Sistema de puntos nuevo MAEs
============================

Este documento explica como quedo el nuevo sistema de puntos del leaderboard.
La idea principal es que los puntos representen mejor el trabajo real de los
MAEs, principalmente las asesorias que dan, y no tanto horas acumuladas o reglas
viejas que ya no estaban dando resultados correctos.

Puntos importantes:

- Ninguna accion puede dejar a un MAE con puntos negativos.
- Si se corrige algo y eso baja puntos, el minimo siempre sera 0.
- Los estudiantes son quienes registran las asesorias que recibieron.
- Los puntos se otorgan al MAE que el estudiante selecciona como asesor.
- El sistema nuevo aplica hacia adelante.
- Las asesorias marcadas como prueba no cuentan para puntos, perfil,
  evaluaciones, estadisticas ni leaderboard.

Formula general:

    puntos = asesorias + asistencia + bonus de rating


1. Asesorias individuales
-------------------------
Esta es la parte principal del sistema.

Cuando un estudiante registra una asesoria, la pagina revisa que MAE fue
seleccionado como asesor y le suma los puntos a ese MAE.

Reglas:

- Primera asesoria de ese estudiante con ese MAE: +10 puntos.
- Asesoria recurrente del mismo estudiante con ese MAE: +5 puntos.
- Si el mismo estudiante registra otra asesoria con el mismo MAE en menos de
  3 horas, la segunda asesoria vale puntos medios:
  - Si normalmente valia 10, ahora vale 5.
  - Si normalmente valia 5, ahora vale 2.5.

La primera asesoria se calcula por relacion MAE-estudiante. Es decir, si un
estudiante toma asesoria por primera vez con un MAE, ese MAE recibe los puntos
de primera vez. Si despues ese mismo estudiante toma asesoria por primera vez
con otro MAE, ese otro MAE tambien puede recibir los puntos de primera vez.

Esto se hizo asi porque queremos incentivar que los MAEs atiendan a mas alumnos,
pero sin dejar de contar las asesorias recurrentes cuando un estudiante vuelve
con el mismo MAE.

Campos que se guardan en cada asesoria:

- pointsAwarded: puntos que se dieron por esa asesoria.
- pointsReason: razon del calculo.
- pointsSubjectId: materia de la asesoria.
- pointsAwardedAt: fecha en que se dieron los puntos.

Ejemplos de pointsReason:

- first_time_student
- recurrent_student
- first_time_under_3_hours
- recurrent_under_3_hours


2. Asesorias grupales
---------------------
Las asesorias grupales dan +20 puntos por cada MAE asignado.

Reglas:

- Cada MAE asignado recibe 20 puntos.
- Los puntos no se dividen entre todos los MAEs.
- Solo cuentan los MAEs que esten asignados a la asesoria grupal.
- Los puntos se dan una sola vez por evento.
- Si despues se cambia la asistencia de alumnos, no se duplican los puntos.

La idea es que las asesorias grupales tambien tengan peso en el leaderboard,
porque hay MAEs que participan mas en grupales que en asesorias individuales.

Campos que se guardan en el anuncio de la asesoria grupal:

- pointsAwarded: true cuando ya se dieron los puntos.
- pointsAwardedAt: fecha en que se dieron.
- pointsAwardedTo: lista de MAEs que recibieron puntos.


3. Asistencia y horario
-----------------------
La asistencia al horario suma puntos, pero las faltas no restan.

Valores:

- A = asistencia completa = +3 puntos.
- R = retraso = +1 punto.
- J = falta justificada = +0 puntos.
- F = falta = +0 puntos.

Si una asistencia se cambia despues, la pagina aplica la diferencia entre el
valor anterior y el nuevo.

Ejemplos:

- Sin registro a A: suma 3 puntos.
- A a R: baja 2 puntos, porque antes valia 3 y ahora vale 1.
- R a A: suma 2 puntos.
- A a F: baja 3 puntos, pero el total del MAE nunca baja de 0.
- F a J: no cambia puntos.

Tambien se quitaron reglas anteriores que ya no correspondian al sistema nuevo:

- Ya no se dan puntos extra al coordi por pasar asistencia.
- Ya no se usan puntos para "jackpot".
- Una falta ya no quita puntos.


4. Bonus por rating
-------------------
El rating funciona como un bonus del semestre.

Regla:

    bonus = promedio de ratings del semestre * 10

Limites:

- Maximo: 50 puntos.
- Sin evaluaciones: 0 puntos.
- Con evaluaciones, el minimo del bonus es 20 puntos.

Ejemplos:

- Promedio 5.0 = +50 puntos.
- Promedio 4.0 = +40 puntos.
- Promedio 3.0 = +30 puntos.
- Promedio 2.0 o menor = +20 puntos.
- Sin ratings = +0 puntos.

Este bonus no se vuelve a sumar completo cada vez que entra una evaluacion. La
pagina guarda ratingBonusPoints en el usuario y, cuando cambia el promedio, solo
aplica la diferencia.

Ejemplo:

- Bonus anterior: 30.
- Bonus nuevo: 40.
- Diferencia aplicada al leaderboard: +10.


5. Minimo de puntos
-------------------
La funcion central de puntos siempre aplica esta regla:

    puntos_finales = max(0, puntos_actuales + cambio)

Esto evita que un MAE quede con puntos negativos aunque una correccion de
asistencia o de rating baje su puntaje.


6. Boton para reiniciar leaderboard
-----------------------------------
En la pestaña de funciones de admin se agrego el boton:

    Reiniciar puntos del leaderboard

Este boton solo reinicia:

- points = 0
- ratingBonusPoints = 0

No reinicia:

- horas
- monedas
- materias
- horarios
- asesorias
- asistencias
- evaluaciones
- badges

La idea es poder empezar el nuevo sistema desde cero sin borrar el historial ni
afectar otras partes de la pagina.

Roles a los que aplica:

- admin
- coordi
- mae
- subjectCoordi
- publi
- tec


7. Donde esta en el codigo
--------------------------
Las reglas principales estan en:

    src/utils/PointsUtils.js

Se usan en:

- src/firebase/db/asesorias.js
  - Asesorias individuales.
  - Bonus de rating.
- src/firebase/db/annoucement.js
  - Asesorias grupales.
- src/views/Coordi.vue
  - Asistencia y correcciones.
- src/firebase/db/users.js
  - updatePoints.
  - Reset del leaderboard.


8. Reglas anteriores que ya no se deben usar
--------------------------------------------
Con este sistema ya no se deberian usar reglas anteriores como:

- -150 por duplicado.
- +60 por asesoria normal.
- +15 por materia MAE.
- +100 por tener horario.
- -500 por no tener horario.
- +50 dividido entre MAEs de una grupal.
- Puntos negativos por faltas.
- Puntos por guardar horario o materias.

Si aparece alguna de estas reglas en otro flujo, probablemente es codigo viejo
que se quedo pendiente de quitar.
