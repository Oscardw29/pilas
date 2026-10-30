# Plan: perfiles, social, clasificaciones, tienda y panel del creador

> Estado: **F1–F9 programadas** (2026-10-29). Falta aplicar `supabase/migrations/0002_social.sql` en Supabase
> (ver docs/supabase.md, paso 7) y la prueba manual con dos cuentas de la F9.
> Fuentes: tu mensaje, [Reglas de XP y monedas](https://claude.ai/artifact/VbBsiP8dHq4rGL3arvqhph) y
> [Especificación de la app](https://claude.ai/artifact/RTnhhxyjbMzcJMJssEjwhy).
> Presupuesto: **0 USD** (Supabase Free, sin servicios de pago).

## Decisiones tomadas

| Tema | Decisión |
|---|---|
| Multiplicador 1.5× por 12 h | **Multiplica solo la XP.** Es una excepción consciente a la regla «las monedas nunca compran XP»: hay que actualizar el documento de reglas. Para que no rompa el ranking lleva límites (ver Fase 3) |
| Nombre público | **Alias único** (`@usuario`) en el ranking, los perfiles y las publicaciones. El nombre que usa el coach sigue siendo privado |
| Forma de trabajo | Primero este plan; se programa después de que lo revises |
| Formatos de cosméticos | **Solo WebP** (estático o animado), como pediste |
| Lista de racha | Permanente, sin reinicio semanal, ordenada por **racha actual**; se muestra también el récord |
| Tabla de hábitos visibles | Cumplido / no cumplido por día, y además los minutos o la cantidad |
| Quién ve las publicaciones | Todos, en el perfil público. La notificación llega solo a los amigos |
| Vetos | Temporales y permanentes |
| Límite de hábitos activos | Fijo para todos: **8**, el mismo número de hábitos que suman XP en las reglas |
| Ligas semanales | **Entran en esta versión**, con premio en monedas (F5b) |
| Podio semanal | El 1.º, al centro, más grande y con el nombre animado; el 2.º y el 3.º a los lados |
| Logros | Página nueva con todos los logros obtenibles; el perfil muestra 3 elegidos por la persona |
| Cosméticos | Marcos, banners y tarjetas (normales, animados o personalizados) se ven **en todos los sitios** donde aparece la persona |
| Ánimos | Botón en el perfil de otra persona que le envía una notificación de ánimo o felicitación |

---

## La decisión técnica de fondo

Hoy el servidor **solo guarda texto cifrado de extremo a extremo**. Ni tú ni Supabase podéis leer los datos de nadie. Eso no
cambia: hábitos, notas, chats y claves API siguen cifrados.

Pero un ranking, un perfil público o una publicación necesitan datos que **sí** sean legibles. La solución es una
**capa pública aparte**, con sus propias tablas, en la que cada dispositivo publica solo lo que es público:

| Privado (cifrado, como hoy) | Público (legible por todos los usuarios con sesión) |
|---|---|
| Hábitos, registros, sesiones, notas, objetivos, retos, chats del coach | Alias, foto, banner, marco, fecha de alta |
| Nombres de hábitos **no** marcados como visibles | Racha actual y récord, XP por día, XP total, nivel, % de cumplimiento |
| Claves API (nunca salen del dispositivo) | Hábitos marcados como visibles: nombre, icono y cumplimiento por día |
| | Publicaciones, reacciones, amistades, artículos comprados |

> ⚠️ **Privacidad:** al pasar a perfiles públicos, el registro debe avisar qué se publica. Si la app la usan personas en Colombia,
> aplica la Ley 1581 de 2012 de datos personales. Conviene confirmarlo con asesoría legal antes de abrirla al público.

### Qué se puede y qué no se puede garantizar contra trampas
Los hábitos son **autorreportados** y la XP se calcula en el dispositivo, así que nadie puede demostrar que alguien meditó de
verdad. Lo que sí garantiza el servidor:
- **Topes:** máximo 1070 XP al día (1605 con el multiplicador activo), 200 monedas al día y la racha sube como mucho 1 por día.
- **Fechas:** solo se acepta hoy y ayer (las reglas permiten marcar 1 día hacia atrás). El pasado queda congelado.
- **Monedas:** el saldo vive en el servidor. Las compras se cobran allí, así que no basta editar el dispositivo para tener
  monedas infinitas.
- **Rol de creador:** se guarda en el servidor y lo comprueban las políticas de la base de datos. No basta con ocultar botones:
  aunque alguien modifique la app, no puede vetar ni editar la tienda.

---

## Fases

```
F1 Ajustes y navegación ──┐
F2 Rendimiento ───────────┤   (sin servidor, en paralelo)
F3 Economía XP/monedas ───┘
          │
F4 Servidor: capa pública ─► F5 Perfil + clasificaciones + podio ─► F5b Ligas + logros ─► F6 Social + ánimos ─► F7 Tienda ─► F8 Panel del creador ─► F9 Verificación
```

### F1 · Ajustes y navegación (sin servidor) · ≈3–4 días
1. **Límite de hábitos fijo:** se quita el control. `MAX_ACTIVE_HABITS = 8` pasa a ser una constante de la app y deja de estar en
   los ajustes. Si alguien supera el límite, *Insights* y el coach lo analizan, como ya hacen.
2. **Menú de perfil:**
   - En escritorio, un bloque pequeño abajo del panel izquierdo con la foto, el alias y un botón ⚙. En móvil va en la cabecera, arriba a la derecha.
   - El botón abre un menú con **Mi perfil**, **Ajustes** y **Cerrar sesión**, esta última en rojo y con doble confirmación.
   - **Se quita «Ajustes» del panel izquierdo.**
3. **Página de perfil propia (`/perfil`):** el contenedor «Perfil de usuario» sale de Ajustes y pasa aquí. Hasta la F5, la foto
   se guarda solo en el dispositivo.
4. **Solo para la cuenta del creador:** Efectos de sonido, Notificaciones del sistema, Probar animaciones, Seguridad de las claves
   de API y Restablecer datos.
   - Las demás personas usan los valores por defecto: sonido y notificaciones activados.
   - ⚠️ Sin esos ajustes, nadie podrá silenciar los avisos. Te sugiero dejar al menos un interruptor «Notificaciones sí/no» para
     todos. Dime si lo quieres.
5. **Guardar configuración:**
   - Un botón flotante (*sticky*) aparece mientras el botón normal no está en pantalla.
   - Si hay cambios sin guardar y la persona intenta salir de Ajustes, sale un modal pequeño: «Tienes cambios sin guardar» con
     **Guardar**, **Salir sin guardar** y **Cancelar**.
   - Detalle técnico: el router actual (`BrowserRouter`) no puede bloquear la navegación. Hay que pasar a
     `createBrowserRouter`/`createHashRouter` (React Router 7) para usar `useBlocker`. También se avisa al cerrar la pestaña
     (`beforeunload`).

### F2 · Rendimiento y efectos en la `.exe` · ≈2–3 días

> ✅ **Hecha (2026-10-29).** Medido en la `.exe` (WebView2, pantalla de 144 Hz):
> - Confeti: antes estaba bloqueado por el CSP y no se dibujaba nunca; ahora se ve y se dibuja en un *worker*.
> - Súper racha: p95 13,9 → 7,3 ms. Las siguientes, sin fotogramas de más de 33 ms (antes 3).
> - Racha: el peor fotograma pasó de 42 a 14 ms.
> - Con la CPU 4× más lenta: 29 → 39 fps.
> - Cambios aplicados:
>   - Cola de celebraciones y tope de partículas vivas.
>   - Confeti preparado en un momento libre.
>   - Sin `backdrop-filter` en las celebraciones y sin `blur`, `brightness` ni grosor de borde animados.
>   - Pausa de lo que queda detrás de un overlay o diálogo, y de las llamas fuera de pantalla.
| Problema | Causa encontrada | Arreglo |
|---|---|---|
| Efectos que no salen en la `.exe` | `canvas-confetti` crea un *worker* desde un `blob:` y el CSP de Tauri solo permite `worker-src 'self'` | Añadir `blob:` a `worker-src` en Tauri y en la web. Se verifica en la `.exe` con las herramientas de depuración, como en la pantalla negra |
| Micro cortes y bajones de FPS | 24 usos de `blur`/`backdrop-filter`, 117 `@keyframes` y ráfagas de confeti de ~200 partículas a la vez | Animar solo `transform`/`opacity`; quitar `backdrop-filter` de capas grandes; **una celebración a la vez** (cola) con tope de partículas; pausar animaciones infinitas fuera de pantalla o con la ventana oculta; `will-change` solo mientras anima |
| Imágenes de Supabase bloqueadas (necesario para la F5) | `img-src` no incluye Supabase | Añadir el dominio de Supabase a `img-src` |

Se mide antes y después con el panel *Performance* en la `.exe`. Objetivo: 60 fps estables en las celebraciones de racha y recompensa.

### F3 · Economía nueva: XP y monedas (local primero) · ≈4–5 días

> ✅ **Hecha (2026-10-29).** Código en `src/lib/economyRules.ts` (reglas puras) y `src/lib/economy.ts` (saldo, XP, ritmo y compras).
> Las pruebas en `tests/economy.test.ts` reproducen los ejemplos del documento (116.5 / 318.1 / 132.8 / 192 XP) y los precios del protector.
>
> Decisiones donde el documento no era explícito:
> - «Primeras 24 h sin XP»: el hábito no da XP **el día en que se crea**.
> - Marcar más de 1 día atrás: se permite registrarlo, pero da 0 monedas y 0 XP.
> - Versión mínima de una acción directa: 40 % del chip y 40 % de los 24 XP. Un registro «parcial» (bajo el mínimo) da 0.
> - Los 8 hábitos que suman XP son los **primeros 8 marcados** del día.
> - Multiplicador:
>   - Espera de 24 h desde la activación.
>   - Tope de 1200 de base ese día, así que el máximo diario es 1590.
>   - Precio con la misma fórmula que el protector.
> - Ritmo ḡ: promedio de los 14 días anteriores a hoy, contando los días sin monedas.
> - Historial anterior a la actualización (`settings.economyStartDate`):
>   - Conserva sus monedas, sin tope, así que **el saldo de nadie cambia**.
>   - La XP sí se calcula para todo el historial.
Se implementan las [Reglas de XP y monedas](https://claude.ai/artifact/VbBsiP8dHq4rGL3arvqhph) en `src/lib/economy.ts`, con
pruebas de cada ejemplo resuelto del documento (116.5 XP, 318.1 XP, 132.8 XP, el abuso que se queda en 192 XP…).
- **Monedas** = los «puntos» actuales, con las nuevas reglas por tipo de hábito y un tope de 200 al día. **El saldo actual de cada
  persona se conserva.**
- **XP** = nueva y calculada por la app:
  - Acción directa: 24 XP.
  - Tiempo: 1,5 XP por minuto, hasta 90.
  - Cantidad: hasta 45, según el avance.
  - Solo suman 8 hábitos al día y hay un tope de 800 XP base.
  - Se multiplica por la racha (+1 % por día, hasta +30 %) y se suma el bono de día perfecto (+30).
- **El nivel** pasa a calcularse con la XP total. Hoy usa los puntos.
- **Reglas anti-trampa:**
  - Desmarcar un hábito resta lo ganado.
  - Un hábito nuevo no da XP en sus primeras 24 h.
  - Se puede marcar como mucho 1 día hacia atrás.
  - Las sesiones de tiempo duran entre 5 min y 3 h.
  - El protector de racha da 0 XP y 0 monedas ese día.
- **Protector de racha** con precio dinámico: 2 × el promedio de los últimos 14 días, entre 100 y 600. Máximo 1 guardado y 7 compras al mes.
- **Multiplicador 1.5× de XP durante 12 h** (recompensa fija):
  - Multiplica la XP de los hábitos completados en esas 12 h. El tope del día sube a 1605 solo en ese caso.
  - Precio dinámico, como el protector.
  - 24 h de espera entre usos y **máximo 4 al mes**, para que comprar no decida la liga.
  - No se acumula con otro multiplicador.
- **Premios propios:** al poner el precio se muestra «Este premio equivale a N días de tu ritmo actual», con los avisos suaves del documento.

### F4 · Servidor: capa pública (Supabase) · ≈5–7 días

> ✅ **Hecha (2026-10-29).** `supabase/migrations/0002_social.sql`, probada con `tests/social.sql.test.ts` (Postgres en memoria).
> Decisiones donde el plan no era explícito:
> - **Nada se publica sin perfil público.** Al crearlo, la persona acepta qué se publica y el servidor recibe una sola vez
>   el «punto de partida» (racha, récord, XP, saldo y hábitos cumplidos hasta anteayer), con tope por antigüedad de la
>   cuenta (+1 año por el historial anterior). Queda registrado y el creador lo ve en Moderación.
> - **Racha:** sube como mucho 1 por día transcurrido desde el último día publicado (así un día sin conexión no la deja
>   desfasada). Cuenta como vigente si se publicó en los últimos 2 días.
> - **Topes de XP:** 1070 al día y 1590 con multiplicador (la cifra de la F3; el 1605 de arriba era una estimación).
> - **Monedas:** el saldo que se ve sigue siendo el del dispositivo; el del servidor es el que cobra la tienda de cosméticos
>   y el multiplicador. Se mantienen iguales así: los gastos y extras del dispositivo (premios propios, protector, retos…)
>   se envían al servidor (extras con tope de 500 al día) y los premios de liga y logros, las compras y los ajustes del
>   creador vuelven al dispositivo como movimientos `srv-…`, sin duplicarse.
> - **Semana perfecta:** 7 días publicados y todos los programados cumplidos.
> - **Grupos de liga:** al cerrar la semana se forman por XP (nivel parecido); quien entra después ocupa el primer grupo
>   con sitio.
> - **Fotos:** el bucket `avatars` es de lectura pública (las URL llevan un id imposible de adivinar), como `catalog`.
> - Borrar el perfil público quita los hábitos visibles y las publicaciones y oculta las cifras, pero no las reinicia.
> - **Versiones de la economía:** rigen por días completos de Colombia (publicar a las 14:00 aplica desde las 00:00 de
>   ese día), igual en el dispositivo y en el servidor, que topa cada día con la versión de ese día.
> - Límites de solicitudes de amistad (20/día) y publicaciones (3/día) cuentan intentos, no filas: cancelar o borrar no
>   los reinicia.
Nueva migración `supabase/migrations/0002_social.sql`:

| Tabla / función | Para qué | Quién escribe |
|---|---|---|
| `app_admins` + `is_admin()` | Rol de creador. Tu cuenta se registra por correo **solo en el SQL**; la app nunca compara correos | Solo SQL |
| `profiles` | Alias único, foto, banner, marco, tarjeta equipada, «miembro desde», tarjetas visibles en el perfil | Cada usuario la suya |
| `daily_stats` | XP, monedas ganadas y % de cumplimiento por día; racha actual y récord | Solo por `publish_day()`, que aplica los topes |
| `public_habits` | Hábitos marcados como visibles: nombre, icono y cumplimiento o minutos por día | Cada usuario los suyos |
| `coin_ledger` | Movimientos de monedas; el saldo es su suma | Solo por funciones: `publish_day()` (ganar, con tope) y `purchase()` (gastar) |
| `catalog_items` | Banners, marcos y tarjetas de ranking (normales y animados) y recompensas: precio, estado `borrador`/`publicado` | Solo el creador |
| `inventory` | Artículos comprados | Solo `purchase()` |
| `economy_config` | Parámetros de XP y monedas, **versionados**: borrador → simulación → publicar con fecha → revertir | Solo el creador |
| `friendships` | Solicitudes con aceptación; límite de 20 al día | Las dos partes |
| `posts`, `post_reactions` | Publicaciones desde plantillas (máx. 3 al día, comentario de hasta 200 caracteres) y un conjunto fijo de reacciones | El autor / quien reacciona |
| `notifications` | Bandeja dentro de la app (publicaciones de amigos, advertencias, solicitudes) | Funciones y *triggers* |
| `reports`, `blocks` | Reportar y bloquear usuarios | Cualquier usuario |
| `moderation_actions`, `warnings`, `bans` | Borrar contenido, advertir, vetar (temporal o permanente), con registro de quién, a quién, cuándo y por qué | Solo el creador |
| Vistas `leaderboard_streak`, `leaderboard_xp_week`, `leaderboard_xp_total` | Clasificaciones paginadas | Solo lectura |
| `leagues`, `league_memberships`, `league_results` | Liga de cada persona por semana, posición final, ascenso o descenso y premio cobrado | Solo el cierre semanal (`close_week()`) |
| `achievement_defs`, `user_achievements` | Catálogo de logros (condición, icono, rareza, premio opcional) y logros conseguidos con su fecha | Catálogo: el creador. Conseguidos: solo `check_achievements()` |
| `cheers` | Ánimos y felicitaciones enviados (para el límite diario y el logro «Animador») | Solo `send_cheer()` |

- **Storage:**
  - Bucket `avatars`: cada usuario sube solo a su carpeta, WebP de hasta 1 MB.
  - Bucket `catalog`: solo sube el creador, WebP de hasta 2 MB y lectura pública.
  - El servidor rechaza cualquier formato que no sea WebP.
- **Cierre semanal automático:** `pg_cron` (incluido gratis en Supabase) ejecuta `close_week()` cada lunes a las 00:00 hora de Colombia
  (UTC−5). Ver F5b.
- **Vetos:** quien tiene un veto activo no puede escribir nada público, y la app le muestra una pantalla con el motivo y la fecha de fin.
- **Avisos en tiempo real:** Supabase Realtime sobre `notifications`. Las notificaciones del sistema siguen siendo locales y solo
  saltan con la app abierta.
- **Límites gratuitos a vigilar:**
  - 1 GB de archivos y unos 5 GB al mes de transferencia: los banners animados de 2 MB gastan rápido.
  - 200 conexiones de Realtime a la vez.
  - El proyecto se pausa tras una semana sin uso.

### F5 · Perfil propio, perfil público y clasificaciones · ≈5–6 días

> ✅ **Hecha (2026-10-29).** `/perfil` (tarjeta «Perfil público»), `/u/:alias`, `/clasificaciones` (Racha, XP de la semana y
> total, Mi liga) con el podio, y los componentes de identidad (`Avatar` con marco, `ProfileBanner`, `RankCard`).
> El alias no se rellena con el nombre del coach para no hacer público un dato privado.
- **`/perfil`:**
  - Subir foto (se recorta a cuadrado y se convierte a WebP en el dispositivo), elegir banner y marco entre los que tienes, y el alias.
  - Elegir qué tarjetas se muestran: racha, XP de la semana, «miembro desde» y hábitos visibles.
  - En cada hábito aparece un interruptor «Visible en mi perfil», **apagado por defecto**.
- **Perfil público (`/u/:alias`)**, que se abre al tocar a alguien en el ranking. Muestra:
  - Banner, marco, foto y alias.
  - Las tarjetas que la persona eligió: racha, XP de la semana en barras día a día con el total debajo, y miembro desde.
  - La tabla semana a semana de hábitos visibles, al estilo «Mi semana».
  - Sus publicaciones.
- **`/clasificaciones`:**
  - Pestañas **Racha** (permanente) y **XP**: semana actual y total, con el % de cumplimiento como desempate.
  - La fila de cada persona usa la **tarjeta de ranking** que haya comprado.
- **Podio semanal** (arriba de la pestaña XP de la semana):
  - Los 3 primeros de la semana en curso, con su foto (y su marco) y su alias.
  - **El 1.º va al centro**, ligeramente más grande (unos 1,15×), con el **nombre animado** (un brillo que recorre el texto) y una
    corona o halo suave. El **2.º va a la izquierda** y el **3.º a la derecha**, a menor altura, al estilo de un podio.
  - Las animaciones usan solo `transform` y `opacity` (sin `blur` ni sombras animadas), para no repetir los bajones de FPS de la F2,
    y se pausan si el podio sale de pantalla.
  - Al cerrarse la semana, el podio pasa a «Ganadores de la semana pasada» durante el lunes, y los tres reciben una notificación.
  - Tocar a cualquiera del podio abre su perfil.

### Componentes de identidad (se usan en toda la app)
Para que los marcos, banners y tarjetas **animados o personalizados se vean en todos los sitios** donde aparece la persona, toda la
app usa los mismos tres componentes:
- `<Avatar>`: foto + marco. Aparece en el menú de perfil, la cabecera móvil, el perfil propio y el público, las filas del ranking,
  el podio, las publicaciones, las notificaciones, la lista de amigos y la vista previa del panel del creador.
- `<ProfileBanner>`: banner en el perfil propio, el perfil público y la vista previa al publicar.
- `<RankCard>`: la tarjeta de la persona en el ranking y en las listas de liga.

Para que no pesen:
- En tamaños pequeños (menos de 40 px) se muestra un **fotograma fijo**. Se genera al subir el archivo, así que el WebP animado no
  se reproduce en cada fila.
- Lo animado solo se reproduce mientras está en pantalla.
- Cada archivo se descarga una vez y queda en la caché del dispositivo.

### F5b · Ligas semanales y logros · ≈5–6 días

> ✅ **Hecha (2026-10-29).** Pestaña «Mi liga» con zonas, premios y cuenta atrás; `/logros` con progreso y % de personas.
> El cierre semanal lo hace `close_week()` con pg_cron (lunes 05:00 UTC).
**Ligas semanales con premio en monedas**
- Cinco ligas: **Bronce → Plata → Oro → Platino → Diamante**. Todo el mundo empieza en Bronce.
- Cada semana (de lunes a domingo, hora de Colombia) compites con las personas de tu liga, ordenadas por la XP de la semana. Si
  hay empate, decide el % de cumplimiento.
  - Cuando haya muchos usuarios, la liga se divide en grupos de unas 30 personas con nivel parecido. Con pocos usuarios, cada
    liga es un solo grupo.
- **Cierre del lunes 00:00** (`close_week()`, automático):
  - **Suben** el 20 % de arriba y **bajan** el 20 % de abajo. Nadie baja de Bronce ni sube de Diamante.
  - Solo cuenta quien ganó XP esa semana: quien no ganó nada no ocupa puesto ni se lleva premio.
- **Premios en monedas** (valores iniciales, editables desde el panel del creador):

| Puesto en el grupo | Bronce | Plata | Oro | Platino | Diamante |
|---|---|---|---|---|---|
| 1.º | 150 | 200 | 260 | 330 | 400 |
| 2.º | 100 | 135 | 175 | 220 | 270 |
| 3.º | 70 | 95 | 120 | 155 | 190 |
| 4.º–10.º | 25 | 35 | 45 | 55 | 70 |

  - Los premios se ingresan en el servidor (`coin_ledger`) y **no cuentan para el tope diario** de 200 monedas, que es solo para
    las monedas que dan los hábitos.
  - Cada persona recibe una notificación con su puesto, su premio y si sube o baja.
- La página de clasificaciones gana la pestaña **Mi liga**: el grupo de la semana, con las zonas de ascenso (verde) y descenso
  (rojo) y la cuenta atrás hasta el cierre.

**Página de logros (`/logros`)**
- Lista de todos los logros que se pueden conseguir. Cada uno tiene icono, nombre, descripción, rareza y **barra de progreso**
  (por ejemplo «Racha de 30 días: 12/30»). Los conseguidos muestran la fecha y los bloqueados se ven en gris.
- Debajo de cada logro se indica qué % de usuarios lo tiene.
- Los otorga el servidor (`check_achievements()`) a partir de los datos públicos: rachas, XP, monedas, puestos y ligas. Así no se
  pueden conseguir editando el dispositivo. Cada logro nuevo envía una notificación y lanza una celebración, de una en una (F2).
- Un logro puede dar un **premio opcional en monedas**, que decides tú desde el panel.

Logros iniciales (inventados; los editas desde el panel del creador):

| Logro | Condición | Rareza |
|---|---|---|
| 🔥 Chispa | Racha de 3 días | Común |
| 🔥 Semana encendida | Racha de 7 días | Común |
| 🔥 Diez de diez | Racha de 10 días | Común |
| 🔥 Un mes imparable | Racha de 30 días | Rara |
| 🔥 Dos meses de fuego | Racha de 60 días | Rara |
| 🔥 Centenario | Racha de 100 días | Épica |
| 🔥 Un año entero | Racha de 365 días | Legendaria |
| ⚡ Primeros mil | 1 000 XP en total | Común |
| ⚡ Diez mil | 10 000 XP en total | Rara |
| ⚡ Leyenda de la constancia | 50 000 XP en total | Épica |
| 🪙 Primer gasto | Gastar 100 monedas | Común |
| 🪙 Buen cliente | Gastar 1 000 monedas | Rara |
| 🥇 Campeón de la semana | Quedar 1.º en el ranking semanal | Épica |
| 🥈 Subcampeón | Quedar 2.º en el ranking semanal | Rara |
| 🥉 En el podio | Quedar 3.º en el ranking semanal | Rara |
| 🏆 Tricampeón | Quedar 1.º en tres semanas distintas | Legendaria |
| 🛡️ Ascenso | Subir de liga por primera vez | Común |
| 💎 Diamante | Llegar a la liga Diamante | Épica |
| ✅ Semana perfecta | Cumplir todos los hábitos programados de una semana | Rara |
| ✅ Cinco semanas perfectas | Cinco semanas perfectas, no necesariamente seguidas | Épica |
| 📈 Cien hábitos | 100 hábitos cumplidos | Común |
| 🤝 Buena compañía | Tener 5 amigos | Común |
| 📣 Primera publicación | Publicar por primera vez | Común |
| 💬 Animador | Enviar ánimos 10 veces | Común |
| 🎨 Con estilo | Comprar el primer cosmético | Común |

**Tarjeta de logros en el perfil**
- Una tarjeta más del perfil (como la de racha o la de XP de la semana) con **3 logros elegidos por la persona** entre los que tiene.
- Se eligen en `/perfil` y se pueden cambiar cuando quieras. Tocar un logro muestra su descripción y la fecha en que se consiguió.

### F6 · Social: amigos, publicaciones, reacciones, notificaciones · ≈5–6 días

> ✅ **Hecha (2026-10-29).** `/amigos` (búsqueda, solicitudes, bloqueos y publicaciones de amigos), `/notificaciones`
> (contador en el menú de perfil y avisos en tiempo real), publicaciones desde plantillas que rellena el servidor,
> reacciones, reportes y ánimos o felicitaciones desde el perfil.
- **Amigos:** enviar, aceptar o rechazar solicitudes, y eliminar o bloquear.
- **Modal de publicación:**
  - Lista de **plantillas** que solo aparecen si se cumple la condición. Ejemplos:
    - «🔥 Llegué a {N} días de racha».
    - «✅ Completé {hábito} {N} días seguidos».
    - «🏆 Semana perfecta».
    - «⚡ Gané {X} XP esta semana».
  - Vista previa y comentario propio opcional.
  - Los datos se rellenan solos y no se pueden editar. Un hábito oculto solo se puede usar si se marca como visible.
- **Reacciones:** 🔥 💪 👏, que no dan XP ni monedas.
- **Notificaciones:** cada publicación avisa a los amigos. La bandeja va en el menú de perfil, con un contador.
- **Menú ⋯** en cada publicación: borrar (autor o creador) y reportar.
- **Enviar ánimos o felicitaciones** desde el perfil de otra persona:
  - Botón **«Enviar ánimos»**. Si la persona consiguió algo en los últimos 3 días (un logro, el podio, subir de liga, una racha
    redonda), el botón cambia a **«Felicitar»**.
  - Le llega una notificación con un texto al azar, entre variantes como:
    - «**@usuario** te envía ánimos para que sigas con toda 💪»
    - «**@usuario** cree en ti: ¡no sueltes la racha! 🔥»
    - «**@usuario** te manda energía para el día de hoy ⚡»
    - «**@usuario** dice: ¡vas muy bien, sigue así! 👏»
    - «**@usuario** te felicita por tu logro: ¡te lo ganaste! 🏆» (felicitación)
    - «**@usuario** celebra tu racha de {N} días contigo 🎉» (felicitación)
  - Límites del servidor (`send_cheer()`): uno por persona y día, máximo 20 al día en total. No se pueden enviar a quien te
    bloqueó. No dan XP ni monedas; solo cuentan para el logro «Animador».

### F7 · Tienda de cosméticos · ≈4–5 días

> ✅ **Hecha (2026-10-29).** Sección «Personalización» en `/recompensas`. Las compras y el multiplicador los cobra el
> servidor con el saldo verificado; el protector sigue en el dispositivo (su gasto se envía al servidor).
- La página de recompensas suma una sección **Personalización**: banners, marcos y tarjetas de ranking, normales y animados.
  Los compras con monedas (por `purchase()` en el servidor), los equipas y se ven en tu perfil y en el ranking.
- **Recompensas fijas:** el protector de racha y el multiplicador 1.5× de XP.
- Los WebP animados solo se reproducen mientras están en pantalla. En el ranking, solo las filas visibles.

### F8 · Panel del creador (solo tu cuenta) · ≈6–8 días

> ✅ **Hecha (2026-10-29).** `/creador` (aparece en el menú de perfil si `is_admin()`): catálogo con vista previa e
> «Importar muestras» (12 WebP generados en el dispositivo, como borradores), economía versionada con simulación,
> ligas y logros, moderación con cola de reportes y registro, y ajustes de prueba.
Página `/creador`, visible solo si `is_admin()` responde que sí:
- **Catálogo:** un modal de creación por tipo (banner, marco, tarjeta de ranking, recompensa).
  - Se sube el WebP, se pone nombre, precio y rareza, y se elige entre borrador y publicado.
  - **A la derecha**, una vista previa que simula un perfil (o una fila del ranking) con el artículo puesto.
  - También se puede editar, eliminar y reordenar.
- **Muestras por defecto:** banners, marcos y tarjetas, normales y animados.
  - Se generan como archivos WebP del proyecto y el botón «Importar muestras» los sube como **borradores**.
  - **Nada queda público** hasta que tú lo publiques.
- **Economía:** se editan los parámetros de XP y monedas (topes, valores por tipo, multiplicador de racha, bono, precios dinámicos)
  con una **simulación** que recalcula los ejemplos del documento antes de publicar, y con historial para revertir.
  También se puede ver y ajustar el saldo de monedas o la XP de una persona; cada ajuste queda registrado.
- **Ligas y logros:**
  - Editar la tabla de premios de las ligas y el % que sube o baja.
  - Crear, editar o retirar logros: condición, icono, rareza y premio.
  - Forzar el cierre de una semana (solo en pruebas).
- **Moderación:**
  - En cualquier perfil: borrar foto o banner, advertir, vetar (con días o permanente) y levantar el veto.
  - En publicaciones: borrar desde el ⋯.
  - Lista de reportes pendientes y registro de acciones.
- **Ajustes de prueba:** los contenedores que se ocultan en la F1 se siguen viendo aquí.

### F9 · Verificación · ≈3 días

> ✅ **Automática hecha (2026-10-29):** `tests/social.sql.test.ts` (permisos, topes, compras, multiplicador, cierre
> semanal, logros, ánimos, vetos, economía versionada), `tests/social.client.test.ts` y `tests/creatorEconomy.test.ts`.
> ⏳ **Pendiente:** aplicar la migración en Supabase, la prueba manual con dos cuentas y medir los fps en la `.exe`.
- **Pruebas automáticas:**
  - La economía, contra los ejemplos del documento.
  - Las políticas RLS: un usuario normal **no** puede escribir en el catálogo, vetar, cambiar su saldo, subir algo que no sea WebP ni publicar más XP del tope.
  - Las compras: sin saldo no se puede comprar, y el multiplicador respeta la espera de 24 h y el máximo de 4 al mes.
  - El cierre semanal: ascensos y descensos correctos, premios cobrados una sola vez aunque el cierre se ejecute dos veces.
  - Los logros: se otorgan una sola vez y un usuario no puede darse logros a sí mismo.
  - Los ánimos: se respetan los límites diarios y los bloqueos.
- **Prueba manual con dos cuentas:** amistad, publicación, notificación, reacción, ranking, compra, equipar, moderación y veto.
- Medir los fps en la `.exe` (F2) y revisar que los perfiles públicos nunca muestran hábitos ocultos.

**Total estimado: 7–9 semanas a tiempo parcial.** F1, F2 y F3 pueden ir en paralelo en sesiones separadas: no se tocan entre sí y
no necesitan el servidor.

---

## Riesgos y cosas que debes saber

| Riesgo | Mitigación |
|---|---|
| Alguien edita su dispositivo para subir en el ranking | Topes y fechas en el servidor; lo autorreportado no se puede verificar del todo. Reportes y moderación para casos evidentes |
| El multiplicador de XP da ventaja a quien compra | Máx. 4 al mes, 24 h de espera, tope del día 1605 |
| Se acaba la transferencia gratuita por los banners animados | Máximo 2 MB por archivo, reproducir solo en pantalla, caché en el dispositivo |
| Acoso desde el ranking | Alias, solicitudes de amistad con aceptación, bloquear y reportar |
| Moderar depende solo de ti | Cola de reportes y registro de acciones |
| Datos personales públicos | Aviso en el registro, hábitos ocultos por defecto, alias y opción de eliminar la cuenta |
| Los premios de liga inflan la economía | El cierre semanal mide la razón monedas ganadas / gastadas (documento de reglas) y la ves en el panel; los premios se ajustan desde allí |
| Ánimos usados como spam | Uno por persona y día, 20 al día, y bloquear corta los envíos |

## Lo que necesito de ti antes de empezar
1. **Revisar este plan** y decirme qué cambiarías.
2. **Notificaciones para todos:** ¿dejo un interruptor mínimo de «Notificaciones sí/no» en Ajustes? Recomendado.
3. **Premios de las ligas:** ¿te sirven los valores de la tabla de la F5b como punto de partida?
4. Cuando lo apruebes, empiezo por F1, F2 y F3 (sin servidor). La F4 necesitará que pegues un SQL nuevo en Supabase.

---

## Ajustes del 30 de octubre de 2026 (después de F4–F9)

Cambios pedidos tras probar la capa pública. En el servidor van en `supabase/migrations/0003_perfiles_ligas.sql`
(se aplica después de 0002; ver docs/supabase.md).

- **Todo perfil es público siempre.** Se crea solo al entrar, con el nombre, el alias (opcional) y la foto de la
  bienvenida. Ya no hay tarjeta «Perfil público» ni opción de eliminarlo (sí la de eliminar la cuenta). La bienvenida
  explica qué es público y qué sigue cifrado; quien ya usaba la app recibe un aviso la primera vez.
- **Alias opcional y sin «@».** Sin alias se muestra el nombre (`display_name`). Nombre, género y alias se editan en
  Ajustes › Datos personales. `/u/:alias` acepta también el id.
- **Fotos por defecto:** 5 ilustraciones (`src/lib/defaultAvatars.ts`, `default:N` en el perfil), una al azar en la
  bienvenida. Recorte en círculo (foto) o rectángulo (banners y tarjetas del creador) cuando la imagen no mide lo pedido.
- **Perfil:** «Editar perfil» con vista previa en vivo; fuera de edición se ve como lo ven los demás. Biografía (160),
  color del banner por defecto (8), «me gusta» en la esquina del banner, «Racha más alta» y semanas recorribles
  (`profile_week`; los hábitos visibles, últimas 8 semanas).
- **Ligas:** suben los 5 primeros, los 5 siguientes se quedan y el resto baja (líneas verde y roja). Solo en el grupo:
  sin ascenso ni descenso y 25 monedas de participación. La racha es una tarjeta fija a la derecha en escritorio.
- **Publicaciones:** se pueden editar (etiqueta «(editado)»); el feed de amigos ya no incluye las propias.
- **Datos de demostración:** no se publican nunca. Quitarlos, empezar de cero o importar una copia reinicia el progreso
  público (`reset_my_progress`, idempotente y con topes para que no sirva para inflar cifras).
- **Logros:** animación propia que solo sale al pulsar su notificación; el creador puede marcarse y quitarse logros y
  editar varios a la vez. Ninguna animación a pantalla completa se solapa y los avisos esperan detrás.
- **Economía:** XP y monedas siempre enteras. Se quitó el sistema de energía y el icono de sincronizado.
- **Coach:** sin voz configurada no suena nada (ya no hay voz del navegador). Frases locales ampliadas y catálogo de
  frases grabables (`scripts/generate-coach-voice.mjs`, docs/coach-voz.md).
- **Modo claro** por defecto (Ajustes › Apariencia).
