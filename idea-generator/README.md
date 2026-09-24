# Ideario de bolsillo

App para el móvil que funciona como generador de ideas: anotas tus ideas, se acumulan en una base
de datos y, cuando tienes suficientes, un botón **Generar ideas** te propone ideas nuevas hechas a
partir de las tuyas. Guardas las que te gusten y quedan en tu ideario junto a las tuyas.

Es una aplicación web instalable (PWA): se añade a la pantalla de inicio del iPhone o del Android,
se abre como cualquier otra app y funciona sin conexión.

## Cómo funciona

1. **Anota.** Escribe una idea en la ficha «Nueva idea» y pulsa *Guardar idea* (o Intro). Las
   `#etiquetas` que escribas se guardan aparte para agrupar ideas. Con *Añadir detalle* puedes
   explicar un poco más.
2. **Acumula.** Cada idea recibe un número de ficha (Nº 001, Nº 002…). Con **5 ideas** se enciende
   el generador; mientras tanto, la pestaña *Generar* muestra cuántas faltan.
3. **Genera.** En *Generar*, el botón **Generar ideas** abre el apartado **Propuestas** con 6 ideas
   nuevas. Cada una dice cómo surgió (Fusión, Otro público, Tema recurrente…) y de qué fichas sale.
4. **Guarda las que elijas.** *Guardar* pasa la propuesta a tu ideario como idea **Elegida**, con su
   número de ficha; *Descartar* la quita; *Generar otras* trae una tanda nueva sin repetir.

En *Ideas* puedes filtrar entre **Todas**, **Mías**, **Elegidas** y **Favoritas**, buscar, marcar
favoritas con la estrella y tocar una ficha para editarla o borrarla (con opción de deshacer).

## Dos formas de generar

| Modo | Cómo trabaja | Qué necesita |
| --- | --- | --- |
| **Sin conexión** | Combina tus ideas en el propio móvil con técnicas de creatividad: fusión de dos ideas, «¿y si…?», otro público, otro formato, otra escala, otro propósito, un reto, darle la vuelta, mezclar tres ideas y desarrollar los temas que más repites. | Nada. Funciona siempre, también sin internet. |
| **Con IA** | Claude lee tu ideario (favoritas y recientes primero) y propone ideas concretas en tu mismo idioma, indicando en qué fichas se inspira. | En claude.ai, tu cuenta de Claude (pide permiso la primera vez). En la app instalada, una clave de API de Anthropic en *Ajustes*. |

Con clave de API la app usa el SDK oficial de Anthropic (`@anthropic-ai/sdk`, empaquetado en
`js/vendor/`) con el modelo `claude-opus-5`, salida JSON estructurada y el respaldo automático de la
API (`fallbacks: "default"`) por si el modelo declina una petición. La clave se guarda solo en el
dispositivo y las ideas solo se envían a la API cuando generas con IA.

## Dónde se guardan tus ideas

- **App instalada:** en el propio dispositivo (IndexedDB). Desde *Ajustes → Exportar copia de
  seguridad* descargas un `.json` que puedes volver a *Importar* en otro móvil.
- **En claude.ai:** en una base de datos privada de tu cuenta: solo tú ves tus ideas, desde
  cualquier dispositivo en el que abras el enlace.

## Instalarla en el móvil

La app es una carpeta de archivos estáticos. Para instalarla hace falta servirla por HTTPS:

1. Publica la carpeta `idea-generator/` en cualquier alojamiento estático con HTTPS (por ejemplo
   GitHub Pages, Netlify o Cloudflare Pages).
2. Abre la dirección en el móvil.
3. **iPhone (Safari):** Compartir → «Añadir a pantalla de inicio».
   **Android (Chrome):** menú ⋮ → «Instalar aplicación» (o el botón *Instalar Ideario* de *Ajustes*).

Para probarla en el ordenador: `npm run serve` y abre <http://localhost:8080>.

## Desarrollo

No necesita compilación: HTML, CSS y módulos JavaScript servidos tal cual.

| Archivo | Contenido |
| --- | --- |
| `index.html`, `css/styles.css` | Interfaz (tema claro y oscuro). |
| `js/main.js` | Arranque: elige almacenamiento e IA según dónde se abra. |
| `js/app.js` | Estado, pintado y eventos de la interfaz. |
| `js/store.js` | Almacenamiento (IndexedDB, base de datos de claude.ai, memoria) y copias de seguridad. |
| `js/generator.js`, `js/text.js` | Generador sin conexión y análisis de texto en español. |
| `js/ai.js` | Prompt, lectura de la respuesta y llamadas a Claude. |
| `sw.js`, `manifest.webmanifest`, `icons/` | Instalación y funcionamiento sin conexión. |

Comandos (Node 20 o superior):

```sh
npm test                    # pruebas unitarias (node --test)
npm run test:e2e            # recorrido completo en Chromium; necesita Playwright y antes build:artifact
npm run build:artifact      # genera dist/ideario.html, la versión de una sola página para claude.ai
npm run vendor:sdk          # vuelve a empaquetar el SDK de Anthropic en js/vendor/
npm run icons               # regenera los PNG desde icons/icon.svg (necesita Playwright)
```

Al cambiar archivos de la app, sube `VERSION` en `sw.js` para que los móviles descarten la versión
guardada en caché.
