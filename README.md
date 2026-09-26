# Marcador

Tabla de posiciones de una ronda de 48 horas con cuenta regresiva, para Daniel, Kevin y Anddy. El sitio es estático (GitHub Pages), pero los puntos se guardan de verdad en una **hoja de cálculo de Google** que abres como Excel.

Nadie puede sumarle puntos a otro: el servidor decide quién eres a partir de tu PIN, y tu PIN solo sirve para tu propio nombre.

## Cómo funciona

```
Navegador  ──JSONP──►  Apps Script  ──►  Hoja de cálculo
(estático) ◄────────   (servidor)   ◄──  (los datos)
```

- El navegador solo dibuja. No guarda los puntos.
- El Apps Script es el servidor: valida el PIN, decide a qué ronda pertenece el punto y escribe en la hoja.
- La hoja de cálculo es la base de datos, y a la vez la tabla que abres como Excel.

## Archivos

| Archivo | Para qué sirve |
|---|---|
| `index.html`, `styles.css`, `app.js` | El sitio |
| `config.js` | Dirección del script, nombres y PIN del admin |
| `apps-script/Code.gs` | El servidor. Se pega en Google, no se sube con los PIN reales |
| `tools/hash.html` | Genera el hash del PIN del admin |

## Puesta en marcha

### 1. Crea la hoja y el script

1. Entra a [sheets.new](https://sheets.new) y ponle nombre, por ejemplo `Marcador`.
2. En la hoja: **Extensiones > Apps Script**. Se abre el editor.
3. Borra lo que haya y pega todo el contenido de `apps-script/Code.gs`.
4. Cambia los tres PIN de `PEOPLE` por los vuestros, y la `ROUND` si quieres otras fechas.
5. Guarda (icono del disquete), elige la función `setup` en el desplegable y pulsa **Ejecutar**. Te pedirá autorizar tu propia cuenta: es normal, el script trabaja sobre tu hoja.

Si todo va bien, en la hoja aparecen dos pestañas: `puntos` (una fila por punto) y `tablero` (el resumen).

### 2. Publica el script

1. **Implementar > Nueva implementación**.
2. Tipo: **Aplicación web**.
3. **Ejecutar como: Yo**. **Quién tiene acceso: Cualquier persona**.
4. Implementar, autoriza, y copia la **URL de la aplicación web** (termina en `/exec`).

> La URL tiene que ser *accesible para cualquiera* solo en el sentido de que no pida login de Google. La escritura sigue necesitando un PIN válido, y el script decide quién eres.

### 3. Conecta el sitio

Pega la URL en `config.js`:

```js
apiUrl: "https://script.google.com/macros/s/AKfy.../exec",
```

Y ajusta los nombres en `participants` si hace falta.

### 4. Súbelo

Repo público en GitHub, sube los archivos, y **Settings > Pages > Source: Deploy from a branch**, rama `main`, carpeta `/ (root)`.

### Si cambias los PIN o las fechas

Editar `Code.gs` y guardar **no basta**. Hay que ir a **Implementar > Gestionar implementaciones**, pulsar el lápiz, y en **Versión** elegir **Nueva versión** y publicar. Si no, la URL sigue sirviendo el código viejo.

## Credenciales

| Quién | Cómo entra |
|---|---|
| Daniel, Kevin, Anddy | Su PIN, definido en `apps-script/Code.gs` |
| Admin (solo lectura) | PIN `0000` (en `config.js`) |

No hay contraseña general del sitio. Solo eliges quién eres y escribes tu PIN.

Los PIN de los tres participantes viven **solo en el script**. El navegador nunca los conoce: se los manda al servidor y el servidor responde sí o no. Por eso nadie puede sumarle puntos a otro.

Usa PINs de 6 caracteres o más. Hay un freno que bloquea 10 minutos tras 8 intentos fallidos, pero un PIN largo es la verdadera defensa.

## La tabla en Excel

En la hoja tienes dos pestañas:

- **`puntos`**: el registro crudo. Una fila por punto, con fecha, ronda y persona. Es la que crece.
- **`tablero`**: el resumen de la ronda en curso, con la meta y el total del grupo.

Sobre `puntos` puedes hacer tablas dinámicas, gráficos o lo que quieras, como con cualquier hoja de cálculo.

## Ajustar la ronda

La ronda se configura en `apps-script/Code.gs`, no en `config.js`, porque el servidor es el que manda:

```js
const ROUND = {
  start: "2026-09-26T00:00:00-05:00", // primera ronda, hora de Colombia
  durationHours: 48,                  // cuánto dura cada ronda
  recurrenceHours: 168,               // cada cuánto empieza una nueva (168 = semanal)
  goal: 5,                            // meta de puntos por persona
};
```

Con esto la primera ronda va del **sábado 26 de septiembre a las 00:00** al **lunes 28 a las 00:00**, y la siguiente empieza el sábado siguiente. El servidor rechaza puntos fuera de la ventana, y el botón se desactiva solo.

Recuerda: después de cambiar esto, publica una **nueva versión**.

## Qué queda protegido y qué no

**Protegido:**

- No puedes sumarle puntos a otra persona. El servidor recibe tu PIN, mira a quién pertenece y escribe ese nombre. No hay forma de pedir "suma para Kevin" con el PIN de Anddy: se rechaza.
- No puedes escribir puntos fuera de la ronda activa.
- Un PIN no se puede adivinar a la fuerza: 8 fallos y ese nombre queda bloqueado 10 minutos.

**No protegido, y conviene saberlo:**

- **Nadie impide que infles tus propios puntos.** Decidiste que fuera honor puro: das +1 y ya está. Si algún día quieres un tope, se agrega al script.
- **El marcador es público de lectura.** La URL del script queda en el sitio, y quien la tenga puede pedir la tabla. Solo son puntos.
- **El PIN viaja en la URL al entrar**, porque la lectura usa JSONP (Apps Script no permite leer respuestas con CORS). El envío va por HTTPS y solo pasa al iniciar sesión.
- **El navegador guarda tu PIN** en `localStorage` para no pedírtelo a cada rato. Quien tenga tu teléfono desbloqueado puede sumar como tú.
- **No subas `apps-script/Code.gs` al repositorio con los PIN reales.** El del repositorio es una plantilla con `PIN_DANIEL`, `PIN_KEVIN` y `PIN_ANDDY`; los de verdad se quedan en Google.

## Probar en tu máquina

```bash
python3 -m http.server 8000
```

Y entra a `http://localhost:8000`. Necesita `apiUrl` configurado para leer y sumar.

## Límites de Google

Para tres personas no vas a rozar ninguna cuota. El plan gratuito de Apps Script permite miles de ejecuciones al día, y una hoja de cálculo aguanta millones de celdas.
