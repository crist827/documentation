# Taller de Prompts

Aplicación web de una sola página para mejorar prompts de IA. No necesita instalación ni
compilación: abre `index.html` en el navegador.

## Qué hace

1. **Diagnóstico local** (al instante, sin enviar datos a ningún servidor): puntúa el prompt de
   0 a 100 según ocho criterios y explica qué falta en cada uno.

   | Criterio               | Peso |
   | ---------------------- | ---: |
   | Tarea clara            |   20 |
   | Contexto y propósito   |   15 |
   | Formato de salida      |   15 |
   | Rol o perspectiva      |   10 |
   | Audiencia              |   10 |
   | Extensión              |   10 |
   | Ejemplos o referencias |   10 |
   | Tono y restricciones   |   10 |

   Resta puntos por palabras vagas («algo», «cosas», «interesante», «que quede bien»…) y por
   prompts muy cortos, y avisa cuando un prompt largo no separa los datos pegados con etiquetas.

2. **Plantilla estructurada** (sin IA): reorganiza el prompt en secciones (rol, contexto, tarea,
   audiencia, formato, tono y límites) y añade marcadores `[entre corchetes]` solo para lo que
   falta.

3. **Reescritura con Claude**: envía el prompt a Claude con instrucciones de ingeniería de prompts
   y muestra en streaming el prompt mejorado, la lista de cambios y preguntas para afinarlo. La
   columna lateral compara la puntuación antes y después.

## Cómo conectar con Claude

- **Abierta como archivo o desde un servidor propio**: despliega «Configurar clave de API de
  Anthropic», pega una clave de [console.anthropic.com](https://console.anthropic.com) y elige
  el modelo (Claude Opus 5 por defecto, Claude Sonnet 5 o Claude Haiku 4.5). La página carga el
  SDK oficial `@anthropic-ai/sdk` desde jsDelivr y llama a la API directamente desde el
  navegador. La clave solo se guarda si marcas «Recordar la clave en este navegador».
- **Publicada como artifact en claude.ai**: usa la cuenta de Claude de quien la abre (con su
  permiso) y no pide clave.

Con Claude Opus 5 la petición activa `fallbacks: "default"`: si el modelo rechaza la petición, la
API la reintenta con el modelo de respaldo recomendado.

## Uso rápido

1. Escribe o pega tu prompt. El borrador se guarda en el navegador.
2. Elige el tipo de tarea y el estilo (conciso o detallado).
3. Revisa el diagnóstico y pulsa **Mejorar con Claude** o mira la pestaña **Plantilla**.
4. Completa los marcadores `[entre corchetes]`, pulsa **Copiar** o **Usar como borrador** para
   seguir iterando.
