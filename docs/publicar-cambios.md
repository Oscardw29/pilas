# Cómo publicar los cambios (cada vez)

Guía corta para cuando ya hay cambios hechos y quieres que lleguen a la gente.
Sin tecnicismos: sigue los pasos en orden y marca cada uno.

> **El atajo:** en una sesión de Claude Code puedes escribir **«publica los cambios»**.
> Claude hace los pasos 1 y 4 por ti y te dice si te toca hacer el 3.

---

## Antes de nada: ¿qué es cada cosa?

| Palabra | Qué es, en simple |
| --- | --- |
| **PR** (pull request) | Un paquete de cambios esperando tu visto bueno en GitHub. |
| **Fusionar** (*merge*) | Darle el visto bueno: los cambios pasan a la versión oficial (`main`). |
| **Vercel** | Donde vive la **web** de ¡Pilas!. Se actualiza sola cuando fusionas. |
| **Supabase** | El **servidor**: cuentas, datos, la IA de la app. A veces hay que actualizarlo a mano. |
| **Etiqueta** (*tag*), p. ej. `v2.0.2` | El número de versión. Al crearla, GitHub fabrica los **instaladores** (Windows, Android, Linux). |

---

## Paso 1 · Fusionar el PR ✅ siempre

1. Abre GitHub → repositorio **Oscardw29/pilas** → pestaña **Pull requests**.
2. Entra en el PR de los cambios.
3. Abajo, si sale todo en verde ✔, pulsa **Merge pull request** → **Confirm merge**.

Listo: los cambios ya están en la versión oficial.

---

## Paso 2 · Comprobar la web ✅ siempre (solo mirar)

1. Entra en [vercel.com](https://vercel.com) → tu proyecto de ¡Pilas!.
2. En **Deployments**, el primero de la lista debe decir **Ready** (unos minutos después de fusionar).
3. Abre la web en el móvil o el ordenador y recarga. Ya tiene lo nuevo.

Si no aparece ningún despliegue nuevo, tu proyecto de Vercel no está conectado a GitHub: pídele a Claude que lo revise contigo.

---

## Paso 3 · Actualizar Supabase ⚠️ solo a veces

Solo hace falta si el PR cambió algo dentro de la carpeta **`supabase/`**. En la descripción del PR, Claude siempre lo avisa con **«Hay que volver a desplegar…»** o **«Hay que aplicar la migración…»**. Si no lo dice, sáltate este paso.

**a) Si cambió la función de IA (`supabase/functions/pilas-ai/index.ts`):**
1. Entra en [supabase.com](https://supabase.com) → proyecto **PilasAPP**.
2. Menú izquierdo → **Edge Functions** → **pilas-ai** → pestaña **Code**.
3. Borra todo el código que hay y pega el contenido nuevo de `supabase/functions/pilas-ai/index.ts`.
4. Pulsa **Deploy**.

**b) Si hay una migración nueva (`supabase/migrations/00XX_….sql`):**
1. En Supabase → **SQL Editor** → **New query**.
2. Pega el contenido del archivo nuevo → **Run**.

---

## Paso 4 · Instaladores nuevos 📦 opcional

Hazlo si quieres que la app de **Windows / Android / Linux** también tenga los cambios (la web ya los tiene desde el paso 2).
Hazlo **después** del paso 1.

1. Mira cuál fue la última versión: GitHub → **Releases** (a la derecha en la página del repositorio). Por ejemplo `v2.0.1`.
2. La nueva es ese número **+1 al final**: `v2.0.1` → `v2.0.2`.
3. Abre una terminal en la carpeta del proyecto y escribe estas tres líneas, una a una (cambia el número):
   ```bash
   git fetch origin
   git tag v2.0.2 origin/main
   git push origin v2.0.2
   ```
4. Espera (unos 20–40 min). En GitHub → **Actions** verás el progreso.
5. Cuando termine: GitHub → **Releases** → aparece un **borrador** (*Draft*) con la versión → **Edit** → **Publish release**.

Desde ese momento la página de descargas ofrece la versión nueva. Quien ya tenga la app instalada debe descargarla e instalarla otra vez.

---

## Resumen en una línea

**Fusionar PR → mirar que Vercel diga Ready → (si el PR lo pide) actualizar Supabase → (si quieres) etiqueta para instaladores.**

Para más detalle técnico: [guia-instaladores.md](guia-instaladores.md) y [supabase.md](supabase.md).
