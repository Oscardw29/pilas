# Voz del coach: frases fijas

<!-- Archivo generado por `node scripts/generate-coach-voice.mjs --docs`: no lo edites a mano; edita src/data/coachPhrases.json -->

Texto exacto de cada frase fija del coach, por voz, para grabarla con TTS. Las usan el motor de respuestas local
(`src/lib/coachLocal.ts`) y los textos por defecto del chat. Cuando una línea de un mensaje coincide con una de estas
frases y existe su audio en `public/coach-voice/`, la app la reproduce aunque no haya clave de TTS configurada.

## Cómo generar los audios

1. Consigue una clave de Gemini (Google AI Studio). No la guardes en el repositorio: pásala solo por variable de entorno.
2. Prueba en seco (valida el catálogo y lista lo que falta): `node scripts/generate-coach-voice.mjs --dry-run`
3. Genera:
   - PowerShell: `$env:GEMINI_API_KEY="tu-clave"; node scripts/generate-coach-voice.mjs`
   - bash: `GEMINI_API_KEY=tu-clave node scripts/generate-coach-voice.mjs`
4. Con ffmpeg en el PATH los audios salen en mp3 (unas 10 veces más ligeros que wav). Sin ffmpeg el script pide
   `--format wav` a propósito, porque los audios viajan con la web, la APK y la .exe.
5. Se puede interrumpir y relanzar: solo graba lo que falta o cambió. Con la cuota gratuita, usa `--limit` o
   `--voice pilo` / `--voice pila` y repite otro día.
6. Si cambias el texto de una frase, su audio viejo deja de usarse solo; vuelve a lanzar el script para regrabarla
   (y `--docs` para actualizar este documento). `--prune` borra los audios de frases que ya no existen.

## Cómo los usa la app

- El script escribe `public/coach-voice/manifest.json` con el archivo y el texto exacto de cada frase grabada.
- `src/lib/coachVoice.ts` lee el manifiesto y, al leer un mensaje, busca cada línea entre las frases grabadas
  (sin distinguir mayúsculas, puntuación, negritas ni viñetas).
- Sin clave de TTS suenan solo esas líneas; el resto del mensaje se queda en texto. Si no hay ninguna frase
  grabada ni voz configurada, el coach no suena y el botón del altavoz avisa de dónde configurar la voz.
- Con Gemini como voz también se usan los audios (misma voz, ahorran cuota). Con Fish Audio, ElevenLabs u OpenAI
  se lee todo con esa voz para no mezclar dos voces en un mensaje.

## Voz

- Modelos de Gemini TTS (en orden): `gemini-2.5-flash-preview-tts`, `gemini-2.5-flash-tts`
- Pilo: voz `Puck` → `public/coach-voice/pilo/<id>.mp3` (o .wav)
- Pila: voz `Zephyr` → `public/coach-voice/pila/<id>.mp3` (o .wav)
- Indicación de estilo (va delante de cada frase): «Lee en español latino, con voz cálida y enérgica de entrenador personal que anima sin exagerar»
- Formato que devuelve la API: PCM de 16 bits, mono, 24000 Hz (el script lo recorta y lo guarda como mp3 o wav).

## Pilo (entrenador)

| id | texto |
| --- | --- |
| `bienvenida.pagina` | ¡Hola! Soy Pilo, tu entrenador de hábitos. Veo tus objetivos, tu constancia de los últimos 30 días y los motivos por los que a veces se cae un hábito. ¿En qué te ayudo hoy? |
| `bienvenida.flotante` | ¡Hola! Soy Pilo. Pregúntame lo que quieras sobre tus hábitos, rachas u objetivos. Esta conversación es la misma que ves en mi página. |
| `ajustes.prueba_voz` | ¡Hola! Soy Pilo, tu entrenador. Así sonaré cuando te lea mis consejos. ¡Vamos con todo hoy! |
| `saludo.apertura.1` | ¡Hola! Qué bueno verte por aquí. |
| `saludo.apertura.2` | ¡Hey! Aquí estoy, con ganas de ayudarte. |
| `saludo.apertura.3` | ¡Buenas! Me alegra que pases a saludar. |
| `saludo.apertura.4` | ¡Hola, hola! Vamos a ver cómo va tu día. |
| `saludo.manana.1` | ¡Buenos días! Empezar el día con intención ya es una victoria. |
| `saludo.manana.2` | ¡Buenos días! La mañana es perfecta para avanzar en lo importante. |
| `saludo.tarde.1` | ¡Buenas tardes! Todavía queda día para avanzar. |
| `saludo.tarde.2` | ¡Buenas tardes! Buen momento para revisar cómo vas. |
| `saludo.noche.1` | ¡Buenas noches! Buen momento para cerrar el día con calma. |
| `saludo.noche.2` | ¡Buenas noches! Veamos qué te queda y cómo terminar bien el día. |
| `saludo.pregunta.1` | ¿Qué quieres que revisemos? |
| `saludo.pregunta.2` | ¿Te ayudo a decidir qué hacer ahora? |
| `saludo.pregunta.3` | ¿Por dónde empezamos hoy? |
| `despedida.normal.1` | ¡Nos vemos! Recuerda: un paso pequeño hoy vale más que un plan perfecto mañana. |
| `despedida.normal.2` | ¡Hasta luego! Aquí estaré cuando me necesites. |
| `despedida.normal.3` | ¡Chao! Que tengas un gran día y cuida tu racha. |
| `despedida.normal.4` | ¡Cuídate! Mañana seguimos sumando. |
| `despedida.noche.1` | ¡Que descanses! Dormir bien también es parte del plan. |
| `despedida.noche.2` | ¡Buenas noches! Mañana es otra oportunidad para seguir construyendo. |
| `gracias.respuesta.1` | ¡Con gusto! Para eso estoy. |
| `gracias.respuesta.2` | ¡De nada! Me encanta verte avanzar. |
| `gracias.respuesta.3` | ¡A ti por confiar en mí! Sigamos así. |
| `gracias.respuesta.4` | ¡Cuando quieras! Pregúntame lo que necesites. |
| `ayuda.intro` | Soy Pilo, tu entrenador de hábitos. Esto es lo que puedo hacer por ti: |
| `ayuda.item.ahora` | Decirte qué hábito conviene hacer ahora mismo y organizar tu día. |
| `ayuda.item.racha` | Ayudarte a cuidar tu racha y a volver después de un mal día. |
| `ayuda.item.analisis` | Analizar tu constancia, tus obstáculos y tu progreso con tus datos reales. |
| `ayuda.item.consejos` | Darte ideas para dormir mejor, estudiar, hacer ejercicio o manejar el estrés. |
| `ayuda.item.app` | Explicarte cómo funciona la app: hábitos, temporizador, tienda, ligas, logros y comunidad. |
| `ayuda.item.acciones` | Proponerte cambios, como crear un hábito, que solo se aplican si los aceptas. |
| `ayuda.cierre` | Pregúntame con tus palabras, por ejemplo: qué hago ahora, cómo salvo mi racha o cómo funciona la tienda. |
| `ahora.apertura.1` | Vamos a lo concreto: esto es lo que haría ahora mismo. |
| `ahora.apertura.2` | Te propongo un siguiente paso claro, sin vueltas. |
| `ahora.apertura.3` | El mejor momento para avanzar es este. Te digo por dónde ir. |
| `ahora.todo_hecho.1` | ¡Hoy ya cumpliste todo lo programado! Disfruta el descanso, te lo ganaste. |
| `ahora.todo_hecho.2` | Día completo. Lo que hagas de más es un extra, no una obligación. |
| `ahora.sin_programar.1` | Hoy no tienes hábitos programados. Es un buen día para descansar o adelantar algo pequeño. |
| `ahora.sin_habitos.1` | Todavía no tienes hábitos activos. Empecemos por uno pequeño: créalo en Mi semana con el botón Nuevo hábito. |
| `ahora.cierre.1` | Si vas con poco tiempo, haz la versión mínima: también cuenta para tu racha. |
| `ahora.cierre.2` | Abre el temporizador y dale cinco minutos. Empezar es lo más difícil. |
| `ahora.cierre.3` | Uno a la vez. Cuando termines, vuelve y vemos el siguiente. |
| `organizar.apertura.1` | Organicemos tu día por bloques, sin llenarlo de más. |
| `organizar.apertura.2` | Aquí tienes un plan sencillo para hoy, según el horario de tus hábitos. |
| `organizar.apertura.3` | Un día bien organizado no es un día lleno: es un día con prioridades claras. |
| `organizar.cierre.1` | Empieza por lo más importante cuando tengas la mente fresca y deja lo fácil para el final. |
| `organizar.cierre.2` | Deja espacio entre bloques. Si algo se complica, recurre a la versión mínima. |
| `organizar.cierre.3` | Ancla cada hábito a algo que ya haces, como el café de la mañana o la cena. |
| `racha.apertura.1` | Hablemos de tu racha, que es tu mejor aliada. |
| `racha.apertura.2` | Tu racha cuenta una historia de constancia. Veamos cómo va. |
| `racha.apertura.3` | Lo importante de una racha no es que sea perfecta, sino que no se corte dos días seguidos. |
| `racha.cero.1` | Hoy puede ser el día uno de una nueva racha. Basta con completar un solo hábito para encenderla. |
| `racha.cero.2` | Las rachas se construyen de a un día. Completa un hábito hoy y ya estás en marcha. |
| `racha.riesgo.1` | Ojo: hoy todavía no completas ningún hábito. Con uno solo, aunque sea en su versión mínima, tu racha sigue viva. |
| `racha.riesgo.2` | Tu racha te está esperando. Completa un hábito antes de que termine el día y queda a salvo. |
| `racha.segura.1` | Hoy ya sumaste tu día de racha. ¡Muy bien! |
| `racha.segura.2` | Racha a salvo por hoy. Si completas todo lo programado, la conviertes en súper racha. |
| `racha.cierre.1` | Si sabes que un día será imposible, el protector de racha de la tienda la cuida por ese día. |
| `racha.cierre.2` | Para la súper racha, completa todos los hábitos programados del día. |
| `racha.cierre.3` | La regla de oro: nunca fallar dos días seguidos. |
| `recaida.apertura.1` | Un mal día no borra todo lo que ya construiste. |
| `recaida.apertura.2` | Tranquilidad. Fallar es parte del proceso, no el final. |
| `recaida.apertura.3` | Gracias por contármelo. Lo importante ahora es cómo vuelves, no por qué fallaste. |
| `recaida.apertura.4` | Respira. Nadie es constante el cien por ciento del tiempo, y no hace falta serlo. |
| `recaida.cierre.1` | Tu siguiente paso: elige un solo hábito y haz hoy su versión mínima. Eso ya es volver. |
| `recaida.cierre.2` | La meta no es hacerlo perfecto, es no fallar dos días seguidos. Hoy es una nueva oportunidad. |
| `recaida.cierre.3` | Si un hábito te está costando demasiado, hagámoslo más pequeño. Ajustar no es rendirse. |
| `motivacion.apertura.1` | Las ganas van y vienen. Lo que te sostiene es el sistema, y ese ya lo tienes. |
| `motivacion.apertura.2` | No esperes a tener motivación: empieza en pequeño y la motivación llega sola. |
| `motivacion.apertura.3` | Hoy no tienes que hacerlo todo, solo dar un paso. |
| `motivacion.apertura.4` | Cada vez que cumples un hábito, votas por la persona que quieres ser. |
| `motivacion.cierre.1` | Elige el hábito más fácil de tu lista y hazlo ahora. El impulso hará el resto. |
| `motivacion.cierre.2` | Pon el temporizador en cinco minutos y empieza. Si después quieres parar, puedes. |
| `motivacion.cierre.3` | Piensa en cómo te vas a sentir esta noche si cumples hoy. Ve por esa sensación. |
| `minimo.apertura.1` | Para eso existe la versión mínima: hacer poco cuenta mucho más que no hacer nada. |
| `minimo.apertura.2` | Poco tiempo no significa cero avance. La versión mínima mantiene viva tu constancia. |
| `minimo.apertura.3` | La versión mínima es tu red de seguridad: pequeña, rápida y cuenta para la racha. |
| `minimo.cierre.1` | Al registrar el hábito, márcalo como mínimo: suma parte de las monedas y protege tu racha. |
| `minimo.cierre.2` | Si un mínimo todavía te parece grande, hazlo aún más pequeño. Que sea imposible fallar. |
| `procrastinacion.apertura.1` | Postergar casi nunca es pereza: suele pasar cuando la tarea se ve demasiado grande. |
| `procrastinacion.apertura.2` | El truco contra la procrastinación es bajar la barrera de entrada. |
| `procrastinacion.apertura.3` | No necesitas ganas para empezar, necesitas un primer paso ridículamente pequeño. |
| `procrastinacion.cierre.1` | Prueba la regla de los dos minutos: comprométete solo a empezar. Casi siempre vas a seguir. |
| `procrastinacion.cierre.2` | Abre el temporizador, elige el hábito y dale a iniciar. Lo demás viene solo. |
| `procrastinacion.cierre.3` | Aleja el celular un rato y quédate con una sola tarea a la vez. |
| `estres.apertura.1` | Cuando todo pesa, menos es más. Vamos a quitarte carga, no a sumarte. |
| `estres.apertura.2` | Primero lo primero: respira hondo tres veces. Ahora veamos qué es realmente importante hoy. |
| `estres.apertura.3` | El estrés avisa que hay demasiado sobre la mesa. Hagamos espacio. |
| `estres.cierre.1` | Hoy quédate con tu hábito más importante en su versión mínima. El resto puede esperar. |
| `estres.cierre.2` | Una caminata corta o unos minutos de respiración también cuentan como cuidarte. |
| `estres.cierre.3` | Si la semana viene pesada, pausar un hábito es una decisión inteligente, no un fracaso. |
| `cansancio.apertura.1` | Si hoy vas sin fuerzas, no pasa nada: ajustemos el plan a cómo estás. |
| `cansancio.apertura.2` | El cansancio es información, no un fracaso. Escuchémoslo. |
| `cansancio.apertura.3` | Hoy toca cuidarte. Avanzar despacio sigue siendo avanzar. |
| `cansancio.cierre.1` | Haz solo las versiones mínimas de tus hábitos prioritarios y deja el resto para mañana. |
| `cansancio.cierre.2` | Y si puedes, duerme un poco más esta noche. El descanso también es entrenamiento. |
| `sueno.apertura.1` | Dormir bien es la base de todos tus demás hábitos. |
| `sueno.apertura.2` | El sueño es tu superpoder silencioso. Vamos a cuidarlo. |
| `sueno.apertura.3` | Sin buen descanso, la fuerza de voluntad se agota rápido. |
| `sueno.consejo.1` | Intenta acostarte y despertarte a la misma hora, incluso el fin de semana. |
| `sueno.consejo.2` | Deja las pantallas media hora antes de dormir; leer o estirarte suave funciona mejor. |
| `sueno.consejo.3` | Evita la cafeína por la tarde y mantén tu cuarto oscuro y fresco. |
| `sueno.cierre.1` | Si quieres, crea un hábito de rutina nocturna con una versión mínima de cinco minutos. |
| `estudio.apertura.1` | Estudiar con constancia rinde más que estudiar mucho de golpe. |
| `estudio.apertura.2` | Para aprender mejor, los bloques cortos y frecuentes le ganan a las maratones. |
| `estudio.apertura.3` | El foco se entrena como un músculo. Vamos por partes. |
| `estudio.consejo.1` | Usa el temporizador: veinticinco minutos de foco y cinco de descanso. |
| `estudio.consejo.2` | Al terminar, explica en voz alta lo que aprendiste. Si puedes explicarlo, lo entendiste. |
| `estudio.consejo.3` | Repasa un poco cada día en lugar de todo la noche anterior. |
| `estudio.sin_habito.1` | No veo un hábito de estudio entre los tuyos. Si quieres, crea uno con una versión mínima de diez minutos. |
| `ejercicio.apertura.1` | Moverte es de los mejores hábitos que puedes tener, y no tiene que ser perfecto. |
| `ejercicio.apertura.2` | El mejor entrenamiento es el que sí haces. Vamos a ponértelo fácil. |
| `ejercicio.apertura.3` | Tu cuerpo agradece más la constancia que la intensidad. |
| `ejercicio.consejo.1` | Deja lista la ropa de deporte desde la noche anterior. Menos fricción, más constancia. |
| `ejercicio.consejo.2` | En días pesados, diez minutos de movimiento cuentan. Esa es tu versión mínima. |
| `ejercicio.consejo.3` | Agenda tu entrenamiento como una cita contigo y no la canceles a la ligera. |
| `ejercicio.sin_habito.1` | Todavía no veo un hábito de ejercicio entre los tuyos. Si quieres empezar, crea uno con una versión mínima de diez minutos. |
| `objetivos.apertura.1` | Revisemos tus objetivos con calma. |
| `objetivos.apertura.2` | Un buen objetivo se nota en lo que haces cada día. Veamos los tuyos. |
| `objetivos.sin_objetivos.1` | Aún no tienes objetivos activos. Crea uno en la sección Objetivos y conéctale los hábitos que te acercan a él. |
| `objetivos.cierre.1` | Más hábitos no significan más avance: cada hábito debe empujar claramente un objetivo. |
| `objetivos.cierre.2` | Si sientes saturación, pausa los objetivos de prioridad baja y concéntrate en el principal. |
| `progreso.apertura.1` | Hice cuentas con tus datos. Esto es lo que veo: |
| `progreso.apertura.2` | Aquí va tu resumen, con números reales. |
| `progreso.apertura.3` | Veamos cómo vas, sin adornos. |
| `progreso.sin_datos.1` | Aún no hay datos suficientes para un buen resumen. Registra tus hábitos unos días y te mostraré patrones. |
| `progreso.cierre.1` | Lo que se mide se mejora. Sigue registrando y cada semana podré decirte más. |
| `progreso.cierre.2` | Celebra lo que salió bien antes de corregir lo que falta. |
| `progreso.cierre.3` | Si un hábito se queda atrás, no lo castigues: hazlo más pequeño o cámbialo de horario. |
| `dificil.apertura.1` | Cuando un hábito cuesta, casi siempre es por su tamaño, su momento del día o la fricción para empezar. |
| `dificil.apertura.2` | Busquemos por qué ese hábito se resiste. |
| `dificil.cierre.1` | Prueba bajarle la meta durante dos semanas o moverlo a otro momento del día. |
| `dificil.cierre.2` | Puedes armar un experimento en el Laboratorio de hábitos para comparar dos horarios y quedarte con el que funcione. |
| `hallazgo.apertura.1` | Te cuento lo que más me llamó la atención de tus datos. |
| `hallazgo.apertura.2` | Encontré algo interesante en tus registros. |
| `hallazgo.apertura.3` | Tengo una observación que te puede servir. |
| `hallazgo.cierre.1` | Aprovecha ese patrón: pon tu hábito más difícil en tu mejor momento del día. |
| `hallazgo.cierre.2` | Los datos no juzgan, solo muestran. Úsalos para ajustar, no para culparte. |
| `primer.apertura.1` | ¡Qué bueno que empieces! El secreto es empezar tan pequeño que sea imposible fallar. |
| `primer.apertura.2` | Para tu primer hábito, elige algo que te importe y que puedas hacer en dos minutos. |
| `primer.idea.leer` | Leer una página antes de dormir. |
| `primer.idea.agua` | Tomar un vaso de agua al despertar. |
| `primer.idea.caminar` | Caminar cinco minutos después de comer. |
| `primer.idea.respirar` | Respirar profundo un minuto antes de empezar a trabajar o estudiar. |
| `primer.cierre.1` | Créalo en Mi semana con el botón Nuevo hábito y ponle una versión mínima. Cuando lo tengas, te ayudo a sostenerlo. |
| `primer.cierre.2` | Dime cuál te gusta, por ejemplo: crea un hábito de leer diez minutos, y te lo dejo listo para aceptar. |
| `xp.apertura.1` | Así van tus números: |
| `xp.apertura.2` | Te cuento cómo vas en experiencia y monedas. |
| `xp.explica.1` | La experiencia nunca se gasta: mide tu progreso y sube tu nivel. Las monedas, en cambio, se gastan en la tienda. |
| `xp.explica.2` | Ganas experiencia y monedas al completar hábitos. Los días perfectos y las rachas largas dan un extra. |
| `app.habitos.1` | Para crear un hábito ve a Mi semana y toca Nuevo hábito. Elige si es de tiempo, de acción o de cantidad, sus días y su versión mínima. |
| `app.habitos.2` | Puedes tener hasta ocho hábitos activos a la vez. Para editar, pausar o archivar uno, ábrelo desde Mi semana. |
| `app.registrar.1` | Para registrar un hábito, márcalo en Inicio o en Mi semana como completo o como mínimo. Los de tiempo también se registran con el temporizador. |
| `app.temporizador.1` | En Temporizador eliges un hábito y le das a iniciar. Al terminar, la sesión se guarda y suma minutos, experiencia y monedas. |
| `app.temporizador.2` | Puedes pausar la sesión cuando lo necesites; solo cuenta el tiempo activo. |
| `app.tienda.1` | En la Tienda de recompensas gastas tus monedas: crea tus propios premios o compra el protector de racha y el multiplicador de experiencia. |
| `app.tienda.2` | El protector de racha cuida tu racha un día que no puedas cumplir, y el multiplicador te da más experiencia durante unas horas. |
| `app.ligas.1` | En Clasificaciones, en la pestaña Mi liga, compites cada semana con personas de tu nivel. Empiezas en Bronce y puedes subir hasta Diamante. |
| `app.ligas.2` | Para entrar a las ligas necesitas un perfil público con alias. Tus hábitos siguen siendo privados, salvo los que elijas mostrar. |
| `app.logros.1` | En Logros ves las insignias que vas desbloqueando con tus rachas, tu constancia y tu actividad. |
| `app.comunidad.1` | En Amigos puedes buscar personas por su alias, enviarles ánimos y publicar tus logros. |
| `app.comunidad.2` | Para usar la comunidad elige un alias en tu perfil. Tú decides qué hábitos se ven en tu perfil público. |
| `app.perfil.1` | Tu perfil está en el menú de tu avatar, arriba. Ahí cambias tu nombre, tu foto o avatar y lo que muestras en tu perfil público. |
| `app.tema.1` | La app usa el modo claro por defecto. Si prefieres el modo oscuro, puedes cambiarlo en Ajustes. |
| `app.voz.1` | Puedo leerte mis respuestas en voz alta. Para eso configura una voz en Ajustes, en Voz neuronal y dictado, con tu clave de Fish Audio, ElevenLabs u OpenAI, o con una clave de Gemini. |
| `app.voz.2` | Si prefieres no oírme, toca el botón del altavoz y me silencio con un fundido suave. |
| `app.experimentos.1` | En el Laboratorio de hábitos pruebas un cambio durante unos días, por ejemplo dos horarios distintos, y comparas cuál funciona mejor. |
| `app.mapa.1` | En el Mapa de hábitos conectas tus hábitos entre sí y con tus objetivos, para ver cuál facilita a cuál. |
| `app.revision.1` | La Revisión semanal resume tu semana hábito por hábito y te ayuda a planificar la siguiente. |
| `app.retos.1` | En Retos 30 días te propones algo durante un mes y ves tu avance día a día. |
| `app.insights.1` | En Insights encuentras patrones de tu comportamiento, tus principales obstáculos y recomendaciones para decidir qué ajustar. |
| `app.calendario.1` | En Calendario ves tu historial día por día, y en Mi semana marcas los hábitos de la semana en curso. |
| `app.objetivos.1` | En Objetivos defines metas y les conectas los hábitos que te acercan a ellas. El progreso se calcula solo. |
| `app.general.1` | Puedo explicarte cualquier sección. Pregúntame por hábitos, temporizador, tienda, ligas, logros, amigos, perfil o el modo claro. |
| `accion.aceptada.1` | ¡Listo! Ya quedó aplicado. Sigamos. |
| `accion.aceptada.2` | ¡Hecho! Me encanta cuando pasamos de la idea a la acción. |
| `accion.aceptada.3` | Aplicado. Ahora a sostenerlo día a día. |
| `accion.rechazada.1` | Entendido, no lo aplico. Si quieres, buscamos otra opción. |
| `accion.rechazada.2` | Sin problema, lo dejamos como estaba. |
| `accion.propuesta.1` | Te dejé la propuesta lista. Revísala en la tarjeta y acéptala si te convence. |
| `accion.propuesta.2` | Aquí la tienes. Nada cambia hasta que la aceptes en la tarjeta. |
| `accion.limite.1` | Ya tienes ocho hábitos activos, que es el máximo. Antes de crear otro, pausa o archiva uno. |
| `general.apertura.1` | Te doy mi lectura con base en tus datos. |
| `general.apertura.2` | Esto es lo que veo en tus números. |
| `general.apertura.3` | Vamos con un panorama rápido de cómo vas. |
| `general.cierre.1` | Antes de crear hábitos nuevos, blinda los que ya tienes con sus versiones mínimas. |
| `general.cierre.2` | No se trata de hacerlo perfecto cada día, sino de no fallar dos días seguidos. |
| `general.cierre.3` | Si me cuentas qué te preocupa, te respondo con más precisión: racha, tiempo, motivación, estudio o ejercicio. |

## Pila (entrenadora)

| id | texto |
| --- | --- |
| `bienvenida.pagina` | ¡Hola! Soy Pila, tu entrenadora de hábitos. Veo tus objetivos, tu constancia de los últimos 30 días y los motivos por los que a veces se cae un hábito. ¿En qué te ayudo hoy? |
| `bienvenida.flotante` | ¡Hola! Soy Pila. Pregúntame lo que quieras sobre tus hábitos, rachas u objetivos. Esta conversación es la misma que ves en mi página. |
| `ajustes.prueba_voz` | ¡Hola! Soy Pila, tu entrenadora. Así sonaré cuando te lea mis consejos. ¡Vamos con todo hoy! |
| `saludo.apertura.1` | ¡Hola! Qué bueno verte por aquí. |
| `saludo.apertura.2` | ¡Hey! Aquí estoy, con ganas de ayudarte. |
| `saludo.apertura.3` | ¡Buenas! Me alegra que pases a saludar. |
| `saludo.apertura.4` | ¡Hola, hola! Vamos a ver cómo va tu día. |
| `saludo.manana.1` | ¡Buenos días! Empezar el día con intención ya es una victoria. |
| `saludo.manana.2` | ¡Buenos días! La mañana es perfecta para avanzar en lo importante. |
| `saludo.tarde.1` | ¡Buenas tardes! Todavía queda día para avanzar. |
| `saludo.tarde.2` | ¡Buenas tardes! Buen momento para revisar cómo vas. |
| `saludo.noche.1` | ¡Buenas noches! Buen momento para cerrar el día con calma. |
| `saludo.noche.2` | ¡Buenas noches! Veamos qué te queda y cómo terminar bien el día. |
| `saludo.pregunta.1` | ¿Qué quieres que revisemos? |
| `saludo.pregunta.2` | ¿Te ayudo a decidir qué hacer ahora? |
| `saludo.pregunta.3` | ¿Por dónde empezamos hoy? |
| `despedida.normal.1` | ¡Nos vemos! Recuerda: un paso pequeño hoy vale más que un plan perfecto mañana. |
| `despedida.normal.2` | ¡Hasta luego! Aquí estaré cuando me necesites. |
| `despedida.normal.3` | ¡Chao! Que tengas un gran día y cuida tu racha. |
| `despedida.normal.4` | ¡Cuídate! Mañana seguimos sumando. |
| `despedida.noche.1` | ¡Que descanses! Dormir bien también es parte del plan. |
| `despedida.noche.2` | ¡Buenas noches! Mañana es otra oportunidad para seguir construyendo. |
| `gracias.respuesta.1` | ¡Con gusto! Para eso estoy. |
| `gracias.respuesta.2` | ¡De nada! Me encanta verte avanzar. |
| `gracias.respuesta.3` | ¡A ti por confiar en mí! Sigamos así. |
| `gracias.respuesta.4` | ¡Cuando quieras! Pregúntame lo que necesites. |
| `ayuda.intro` | Soy Pila, tu entrenadora de hábitos. Esto es lo que puedo hacer por ti: |
| `ayuda.item.ahora` | Decirte qué hábito conviene hacer ahora mismo y organizar tu día. |
| `ayuda.item.racha` | Ayudarte a cuidar tu racha y a volver después de un mal día. |
| `ayuda.item.analisis` | Analizar tu constancia, tus obstáculos y tu progreso con tus datos reales. |
| `ayuda.item.consejos` | Darte ideas para dormir mejor, estudiar, hacer ejercicio o manejar el estrés. |
| `ayuda.item.app` | Explicarte cómo funciona la app: hábitos, temporizador, tienda, ligas, logros y comunidad. |
| `ayuda.item.acciones` | Proponerte cambios, como crear un hábito, que solo se aplican si los aceptas. |
| `ayuda.cierre` | Pregúntame con tus palabras, por ejemplo: qué hago ahora, cómo salvo mi racha o cómo funciona la tienda. |
| `ahora.apertura.1` | Vamos a lo concreto: esto es lo que haría ahora mismo. |
| `ahora.apertura.2` | Te propongo un siguiente paso claro, sin vueltas. |
| `ahora.apertura.3` | El mejor momento para avanzar es este. Te digo por dónde ir. |
| `ahora.todo_hecho.1` | ¡Hoy ya cumpliste todo lo programado! Disfruta el descanso, te lo ganaste. |
| `ahora.todo_hecho.2` | Día completo. Lo que hagas de más es un extra, no una obligación. |
| `ahora.sin_programar.1` | Hoy no tienes hábitos programados. Es un buen día para descansar o adelantar algo pequeño. |
| `ahora.sin_habitos.1` | Todavía no tienes hábitos activos. Empecemos por uno pequeño: créalo en Mi semana con el botón Nuevo hábito. |
| `ahora.cierre.1` | Si vas con poco tiempo, haz la versión mínima: también cuenta para tu racha. |
| `ahora.cierre.2` | Abre el temporizador y dale cinco minutos. Empezar es lo más difícil. |
| `ahora.cierre.3` | Uno a la vez. Cuando termines, vuelve y vemos el siguiente. |
| `organizar.apertura.1` | Organicemos tu día por bloques, sin llenarlo de más. |
| `organizar.apertura.2` | Aquí tienes un plan sencillo para hoy, según el horario de tus hábitos. |
| `organizar.apertura.3` | Un día bien organizado no es un día lleno: es un día con prioridades claras. |
| `organizar.cierre.1` | Empieza por lo más importante cuando tengas la mente fresca y deja lo fácil para el final. |
| `organizar.cierre.2` | Deja espacio entre bloques. Si algo se complica, recurre a la versión mínima. |
| `organizar.cierre.3` | Ancla cada hábito a algo que ya haces, como el café de la mañana o la cena. |
| `racha.apertura.1` | Hablemos de tu racha, que es tu mejor aliada. |
| `racha.apertura.2` | Tu racha cuenta una historia de constancia. Veamos cómo va. |
| `racha.apertura.3` | Lo importante de una racha no es que sea perfecta, sino que no se corte dos días seguidos. |
| `racha.cero.1` | Hoy puede ser el día uno de una nueva racha. Basta con completar un solo hábito para encenderla. |
| `racha.cero.2` | Las rachas se construyen de a un día. Completa un hábito hoy y ya estás en marcha. |
| `racha.riesgo.1` | Ojo: hoy todavía no completas ningún hábito. Con uno solo, aunque sea en su versión mínima, tu racha sigue viva. |
| `racha.riesgo.2` | Tu racha te está esperando. Completa un hábito antes de que termine el día y queda a salvo. |
| `racha.segura.1` | Hoy ya sumaste tu día de racha. ¡Muy bien! |
| `racha.segura.2` | Racha a salvo por hoy. Si completas todo lo programado, la conviertes en súper racha. |
| `racha.cierre.1` | Si sabes que un día será imposible, el protector de racha de la tienda la cuida por ese día. |
| `racha.cierre.2` | Para la súper racha, completa todos los hábitos programados del día. |
| `racha.cierre.3` | La regla de oro: nunca fallar dos días seguidos. |
| `recaida.apertura.1` | Un mal día no borra todo lo que ya construiste. |
| `recaida.apertura.2` | Tranquilidad. Fallar es parte del proceso, no el final. |
| `recaida.apertura.3` | Gracias por contármelo. Lo importante ahora es cómo vuelves, no por qué fallaste. |
| `recaida.apertura.4` | Respira. Nadie es constante el cien por ciento del tiempo, y no hace falta serlo. |
| `recaida.cierre.1` | Tu siguiente paso: elige un solo hábito y haz hoy su versión mínima. Eso ya es volver. |
| `recaida.cierre.2` | La meta no es hacerlo perfecto, es no fallar dos días seguidos. Hoy es una nueva oportunidad. |
| `recaida.cierre.3` | Si un hábito te está costando demasiado, hagámoslo más pequeño. Ajustar no es rendirse. |
| `motivacion.apertura.1` | Las ganas van y vienen. Lo que te sostiene es el sistema, y ese ya lo tienes. |
| `motivacion.apertura.2` | No esperes a tener motivación: empieza en pequeño y la motivación llega sola. |
| `motivacion.apertura.3` | Hoy no tienes que hacerlo todo, solo dar un paso. |
| `motivacion.apertura.4` | Cada vez que cumples un hábito, votas por la persona que quieres ser. |
| `motivacion.cierre.1` | Elige el hábito más fácil de tu lista y hazlo ahora. El impulso hará el resto. |
| `motivacion.cierre.2` | Pon el temporizador en cinco minutos y empieza. Si después quieres parar, puedes. |
| `motivacion.cierre.3` | Piensa en cómo te vas a sentir esta noche si cumples hoy. Ve por esa sensación. |
| `minimo.apertura.1` | Para eso existe la versión mínima: hacer poco cuenta mucho más que no hacer nada. |
| `minimo.apertura.2` | Poco tiempo no significa cero avance. La versión mínima mantiene viva tu constancia. |
| `minimo.apertura.3` | La versión mínima es tu red de seguridad: pequeña, rápida y cuenta para la racha. |
| `minimo.cierre.1` | Al registrar el hábito, márcalo como mínimo: suma parte de las monedas y protege tu racha. |
| `minimo.cierre.2` | Si un mínimo todavía te parece grande, hazlo aún más pequeño. Que sea imposible fallar. |
| `procrastinacion.apertura.1` | Postergar casi nunca es pereza: suele pasar cuando la tarea se ve demasiado grande. |
| `procrastinacion.apertura.2` | El truco contra la procrastinación es bajar la barrera de entrada. |
| `procrastinacion.apertura.3` | No necesitas ganas para empezar, necesitas un primer paso ridículamente pequeño. |
| `procrastinacion.cierre.1` | Prueba la regla de los dos minutos: comprométete solo a empezar. Casi siempre vas a seguir. |
| `procrastinacion.cierre.2` | Abre el temporizador, elige el hábito y dale a iniciar. Lo demás viene solo. |
| `procrastinacion.cierre.3` | Aleja el celular un rato y quédate con una sola tarea a la vez. |
| `estres.apertura.1` | Cuando todo pesa, menos es más. Vamos a quitarte carga, no a sumarte. |
| `estres.apertura.2` | Primero lo primero: respira hondo tres veces. Ahora veamos qué es realmente importante hoy. |
| `estres.apertura.3` | El estrés avisa que hay demasiado sobre la mesa. Hagamos espacio. |
| `estres.cierre.1` | Hoy quédate con tu hábito más importante en su versión mínima. El resto puede esperar. |
| `estres.cierre.2` | Una caminata corta o unos minutos de respiración también cuentan como cuidarte. |
| `estres.cierre.3` | Si la semana viene pesada, pausar un hábito es una decisión inteligente, no un fracaso. |
| `cansancio.apertura.1` | Si hoy vas sin fuerzas, no pasa nada: ajustemos el plan a cómo estás. |
| `cansancio.apertura.2` | El cansancio es información, no un fracaso. Escuchémoslo. |
| `cansancio.apertura.3` | Hoy toca cuidarte. Avanzar despacio sigue siendo avanzar. |
| `cansancio.cierre.1` | Haz solo las versiones mínimas de tus hábitos prioritarios y deja el resto para mañana. |
| `cansancio.cierre.2` | Y si puedes, duerme un poco más esta noche. El descanso también es entrenamiento. |
| `sueno.apertura.1` | Dormir bien es la base de todos tus demás hábitos. |
| `sueno.apertura.2` | El sueño es tu superpoder silencioso. Vamos a cuidarlo. |
| `sueno.apertura.3` | Sin buen descanso, la fuerza de voluntad se agota rápido. |
| `sueno.consejo.1` | Intenta acostarte y despertarte a la misma hora, incluso el fin de semana. |
| `sueno.consejo.2` | Deja las pantallas media hora antes de dormir; leer o estirarte suave funciona mejor. |
| `sueno.consejo.3` | Evita la cafeína por la tarde y mantén tu cuarto oscuro y fresco. |
| `sueno.cierre.1` | Si quieres, crea un hábito de rutina nocturna con una versión mínima de cinco minutos. |
| `estudio.apertura.1` | Estudiar con constancia rinde más que estudiar mucho de golpe. |
| `estudio.apertura.2` | Para aprender mejor, los bloques cortos y frecuentes le ganan a las maratones. |
| `estudio.apertura.3` | El foco se entrena como un músculo. Vamos por partes. |
| `estudio.consejo.1` | Usa el temporizador: veinticinco minutos de foco y cinco de descanso. |
| `estudio.consejo.2` | Al terminar, explica en voz alta lo que aprendiste. Si puedes explicarlo, lo entendiste. |
| `estudio.consejo.3` | Repasa un poco cada día en lugar de todo la noche anterior. |
| `estudio.sin_habito.1` | No veo un hábito de estudio entre los tuyos. Si quieres, crea uno con una versión mínima de diez minutos. |
| `ejercicio.apertura.1` | Moverte es de los mejores hábitos que puedes tener, y no tiene que ser perfecto. |
| `ejercicio.apertura.2` | El mejor entrenamiento es el que sí haces. Vamos a ponértelo fácil. |
| `ejercicio.apertura.3` | Tu cuerpo agradece más la constancia que la intensidad. |
| `ejercicio.consejo.1` | Deja lista la ropa de deporte desde la noche anterior. Menos fricción, más constancia. |
| `ejercicio.consejo.2` | En días pesados, diez minutos de movimiento cuentan. Esa es tu versión mínima. |
| `ejercicio.consejo.3` | Agenda tu entrenamiento como una cita contigo y no la canceles a la ligera. |
| `ejercicio.sin_habito.1` | Todavía no veo un hábito de ejercicio entre los tuyos. Si quieres empezar, crea uno con una versión mínima de diez minutos. |
| `objetivos.apertura.1` | Revisemos tus objetivos con calma. |
| `objetivos.apertura.2` | Un buen objetivo se nota en lo que haces cada día. Veamos los tuyos. |
| `objetivos.sin_objetivos.1` | Aún no tienes objetivos activos. Crea uno en la sección Objetivos y conéctale los hábitos que te acercan a él. |
| `objetivos.cierre.1` | Más hábitos no significan más avance: cada hábito debe empujar claramente un objetivo. |
| `objetivos.cierre.2` | Si sientes saturación, pausa los objetivos de prioridad baja y concéntrate en el principal. |
| `progreso.apertura.1` | Hice cuentas con tus datos. Esto es lo que veo: |
| `progreso.apertura.2` | Aquí va tu resumen, con números reales. |
| `progreso.apertura.3` | Veamos cómo vas, sin adornos. |
| `progreso.sin_datos.1` | Aún no hay datos suficientes para un buen resumen. Registra tus hábitos unos días y te mostraré patrones. |
| `progreso.cierre.1` | Lo que se mide se mejora. Sigue registrando y cada semana podré decirte más. |
| `progreso.cierre.2` | Celebra lo que salió bien antes de corregir lo que falta. |
| `progreso.cierre.3` | Si un hábito se queda atrás, no lo castigues: hazlo más pequeño o cámbialo de horario. |
| `dificil.apertura.1` | Cuando un hábito cuesta, casi siempre es por su tamaño, su momento del día o la fricción para empezar. |
| `dificil.apertura.2` | Busquemos por qué ese hábito se resiste. |
| `dificil.cierre.1` | Prueba bajarle la meta durante dos semanas o moverlo a otro momento del día. |
| `dificil.cierre.2` | Puedes armar un experimento en el Laboratorio de hábitos para comparar dos horarios y quedarte con el que funcione. |
| `hallazgo.apertura.1` | Te cuento lo que más me llamó la atención de tus datos. |
| `hallazgo.apertura.2` | Encontré algo interesante en tus registros. |
| `hallazgo.apertura.3` | Tengo una observación que te puede servir. |
| `hallazgo.cierre.1` | Aprovecha ese patrón: pon tu hábito más difícil en tu mejor momento del día. |
| `hallazgo.cierre.2` | Los datos no juzgan, solo muestran. Úsalos para ajustar, no para culparte. |
| `primer.apertura.1` | ¡Qué bueno que empieces! El secreto es empezar tan pequeño que sea imposible fallar. |
| `primer.apertura.2` | Para tu primer hábito, elige algo que te importe y que puedas hacer en dos minutos. |
| `primer.idea.leer` | Leer una página antes de dormir. |
| `primer.idea.agua` | Tomar un vaso de agua al despertar. |
| `primer.idea.caminar` | Caminar cinco minutos después de comer. |
| `primer.idea.respirar` | Respirar profundo un minuto antes de empezar a trabajar o estudiar. |
| `primer.cierre.1` | Créalo en Mi semana con el botón Nuevo hábito y ponle una versión mínima. Cuando lo tengas, te ayudo a sostenerlo. |
| `primer.cierre.2` | Dime cuál te gusta, por ejemplo: crea un hábito de leer diez minutos, y te lo dejo listo para aceptar. |
| `xp.apertura.1` | Así van tus números: |
| `xp.apertura.2` | Te cuento cómo vas en experiencia y monedas. |
| `xp.explica.1` | La experiencia nunca se gasta: mide tu progreso y sube tu nivel. Las monedas, en cambio, se gastan en la tienda. |
| `xp.explica.2` | Ganas experiencia y monedas al completar hábitos. Los días perfectos y las rachas largas dan un extra. |
| `app.habitos.1` | Para crear un hábito ve a Mi semana y toca Nuevo hábito. Elige si es de tiempo, de acción o de cantidad, sus días y su versión mínima. |
| `app.habitos.2` | Puedes tener hasta ocho hábitos activos a la vez. Para editar, pausar o archivar uno, ábrelo desde Mi semana. |
| `app.registrar.1` | Para registrar un hábito, márcalo en Inicio o en Mi semana como completo o como mínimo. Los de tiempo también se registran con el temporizador. |
| `app.temporizador.1` | En Temporizador eliges un hábito y le das a iniciar. Al terminar, la sesión se guarda y suma minutos, experiencia y monedas. |
| `app.temporizador.2` | Puedes pausar la sesión cuando lo necesites; solo cuenta el tiempo activo. |
| `app.tienda.1` | En la Tienda de recompensas gastas tus monedas: crea tus propios premios o compra el protector de racha y el multiplicador de experiencia. |
| `app.tienda.2` | El protector de racha cuida tu racha un día que no puedas cumplir, y el multiplicador te da más experiencia durante unas horas. |
| `app.ligas.1` | En Clasificaciones, en la pestaña Mi liga, compites cada semana con personas de tu nivel. Empiezas en Bronce y puedes subir hasta Diamante. |
| `app.ligas.2` | Para entrar a las ligas necesitas un perfil público con alias. Tus hábitos siguen siendo privados, salvo los que elijas mostrar. |
| `app.logros.1` | En Logros ves las insignias que vas desbloqueando con tus rachas, tu constancia y tu actividad. |
| `app.comunidad.1` | En Amigos puedes buscar personas por su alias, enviarles ánimos y publicar tus logros. |
| `app.comunidad.2` | Para usar la comunidad elige un alias en tu perfil. Tú decides qué hábitos se ven en tu perfil público. |
| `app.perfil.1` | Tu perfil está en el menú de tu avatar, arriba. Ahí cambias tu nombre, tu foto o avatar y lo que muestras en tu perfil público. |
| `app.tema.1` | La app usa el modo claro por defecto. Si prefieres el modo oscuro, puedes cambiarlo en Ajustes. |
| `app.voz.1` | Puedo leerte mis respuestas en voz alta. Para eso configura una voz en Ajustes, en Voz neuronal y dictado, con tu clave de Fish Audio, ElevenLabs u OpenAI, o con una clave de Gemini. |
| `app.voz.2` | Si prefieres no oírme, toca el botón del altavoz y me silencio con un fundido suave. |
| `app.experimentos.1` | En el Laboratorio de hábitos pruebas un cambio durante unos días, por ejemplo dos horarios distintos, y comparas cuál funciona mejor. |
| `app.mapa.1` | En el Mapa de hábitos conectas tus hábitos entre sí y con tus objetivos, para ver cuál facilita a cuál. |
| `app.revision.1` | La Revisión semanal resume tu semana hábito por hábito y te ayuda a planificar la siguiente. |
| `app.retos.1` | En Retos 30 días te propones algo durante un mes y ves tu avance día a día. |
| `app.insights.1` | En Insights encuentras patrones de tu comportamiento, tus principales obstáculos y recomendaciones para decidir qué ajustar. |
| `app.calendario.1` | En Calendario ves tu historial día por día, y en Mi semana marcas los hábitos de la semana en curso. |
| `app.objetivos.1` | En Objetivos defines metas y les conectas los hábitos que te acercan a ellas. El progreso se calcula solo. |
| `app.general.1` | Puedo explicarte cualquier sección. Pregúntame por hábitos, temporizador, tienda, ligas, logros, amigos, perfil o el modo claro. |
| `accion.aceptada.1` | ¡Listo! Ya quedó aplicado. Sigamos. |
| `accion.aceptada.2` | ¡Hecho! Me encanta cuando pasamos de la idea a la acción. |
| `accion.aceptada.3` | Aplicado. Ahora a sostenerlo día a día. |
| `accion.rechazada.1` | Entendido, no lo aplico. Si quieres, buscamos otra opción. |
| `accion.rechazada.2` | Sin problema, lo dejamos como estaba. |
| `accion.propuesta.1` | Te dejé la propuesta lista. Revísala en la tarjeta y acéptala si te convence. |
| `accion.propuesta.2` | Aquí la tienes. Nada cambia hasta que la aceptes en la tarjeta. |
| `accion.limite.1` | Ya tienes ocho hábitos activos, que es el máximo. Antes de crear otro, pausa o archiva uno. |
| `general.apertura.1` | Te doy mi lectura con base en tus datos. |
| `general.apertura.2` | Esto es lo que veo en tus números. |
| `general.apertura.3` | Vamos con un panorama rápido de cómo vas. |
| `general.cierre.1` | Antes de crear hábitos nuevos, blinda los que ya tienes con sus versiones mínimas. |
| `general.cierre.2` | No se trata de hacerlo perfecto cada día, sino de no fallar dos días seguidos. |
| `general.cierre.3` | Si me cuentas qué te preocupa, te respondo con más precisión: racha, tiempo, motivación, estudio o ejercicio. |

Total: 190 frases por voz (4 cambian entre Pilo y Pila).
