# Plan: perfiles, social, clasificaciones, tienda y panel del creador

> Estado: **propuesta para revisar** (2026-10-29). No se ha tocado código.
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
F4 Servidor: capa pública ─► F5 Perfil + clasificaciones ─► F6 Social ─► F7 Tienda ─► F8 Panel del creador ─► F9 Verificación
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
| Problema | Causa encontrada | Arreglo |
|---|---|---|
| Efectos que no salen en la `.exe` | `canvas-confetti` crea un *worker* desde un `blob:` y el CSP de Tauri solo permite `worker-src 'self'` | Añadir `blob:` a `worker-src` en Tauri y en la web. Se verifica en la `.exe` con las herramientas de depuración, como en la pantalla negra |
| Micro cortes y bajones de FPS | 24 usos de `blur`/`backdrop-filter`, 117 `@keyframes` y ráfagas de confeti de ~200 partículas a la vez | Animar solo `transform`/`opacity`; quitar `backdrop-filter` de capas grandes; **una celebración a la vez** (cola) con tope de partículas; pausar animaciones infinitas fuera de pantalla o con la ventana oculta; `will-change` solo mientras anima |
| Imágenes de Supabase bloqueadas (necesario para la F5) | `img-src` no incluye Supabase | Añadir el dominio de Supabase a `img-src` |

Se mide antes y después con el panel *Performance* en la `.exe`. Objetivo: 60 fps estables en las celebraciones de racha y recompensa.

### F3 · Economía nueva: XP y monedas (local primero) · ≈4–5 días
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

- **Storage:**
  - Bucket `avatars`: cada usuario sube solo a su carpeta, WebP de hasta 1 MB.
  - Bucket `catalog`: solo sube el creador, WebP de hasta 2 MB y lectura pública.
  - El servidor rechaza cualquier formato que no sea WebP.
- **Vetos:** quien tiene un veto activo no puede escribir nada público, y la app le muestra una pantalla con el motivo y la fecha de fin.
- **Avisos en tiempo real:** Supabase Realtime sobre `notifications`. Las notificaciones del sistema siguen siendo locales y solo
  saltan con la app abierta.
- **Límites gratuitos a vigilar:**
  - 1 GB de archivos y unos 5 GB al mes de transferencia: los banners animados de 2 MB gastan rápido.
  - 200 conexiones de Realtime a la vez.
  - El proyecto se pausa tras una semana sin uso.

### F5 · Perfil propio, perfil público y clasificaciones · ≈5–6 días
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
  - Las ligas semanales (Bronce→Diamante, con ascensos y descensos) quedan como mejora opcional al final.

### F6 · Social: amigos, publicaciones, reacciones, notificaciones · ≈5–6 días
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

### F7 · Tienda de cosméticos · ≈4–5 días
- La página de recompensas suma una sección **Personalización**: banners, marcos y tarjetas de ranking, normales y animados.
  Los compras con monedas (por `purchase()` en el servidor), los equipas y se ven en tu perfil y en el ranking.
- **Recompensas fijas:** el protector de racha y el multiplicador 1.5× de XP.
- Los WebP animados solo se reproducen mientras están en pantalla. En el ranking, solo las filas visibles.

### F8 · Panel del creador (solo tu cuenta) · ≈6–8 días
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
- **Moderación:**
  - En cualquier perfil: borrar foto o banner, advertir, vetar (con días o permanente) y levantar el veto.
  - En publicaciones: borrar desde el ⋯.
  - Lista de reportes pendientes y registro de acciones.
- **Ajustes de prueba:** los contenedores que se ocultan en la F1 se siguen viendo aquí.

### F9 · Verificación · ≈3 días
- **Pruebas automáticas:**
  - La economía, contra los ejemplos del documento.
  - Las políticas RLS: un usuario normal **no** puede escribir en el catálogo, vetar, cambiar su saldo, subir algo que no sea WebP ni publicar más XP del tope.
  - Las compras: sin saldo no se puede comprar, y el multiplicador respeta la espera de 24 h y el máximo de 4 al mes.
- **Prueba manual con dos cuentas:** amistad, publicación, notificación, reacción, ranking, compra, equipar, moderación y veto.
- Medir los fps en la `.exe` (F2) y revisar que los perfiles públicos nunca muestran hábitos ocultos.

**Total estimado: 6–8 semanas a tiempo parcial.** F1, F2 y F3 pueden ir en paralelo en sesiones separadas: no se tocan entre sí y
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

## Lo que necesito de ti antes de empezar
1. **Revisar este plan** y decirme qué cambiarías.
2. **Notificaciones para todos:** ¿dejo un interruptor mínimo de «Notificaciones sí/no» en Ajustes? Recomendado.
3. **Ligas semanales** (Bronce→Diamante): ¿entran en esta versión o después?
4. Cuando lo apruebes, empiezo por F1, F2 y F3 (sin servidor). La F4 necesitará que pegues un SQL nuevo en Supabase.
