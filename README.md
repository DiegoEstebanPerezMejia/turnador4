# Turnero Web (multiusuario)

Sistema de turnos hecho con **Flask**, base de datos **Neon (PostgreSQL)** y listo para **Render**.

- **Inicio de sesión** con usuario y contraseña.
- **Cada usuario tiene su propio turnero** (turnos, ajustes, jornadas e historial independientes). Varios usuarios pueden estar conectados al mismo tiempo sin mezclarse.
- **Ventana de administración** dentro de la página: crear usuarios, asignarles contraseña, dar o quitar acceso, cambiar rol, restablecer claves e inicializar el turnero de cualquiera.
- **Ventana de estadísticas** por usuario, con el detalle de su jornada actual y el acumulado histórico. Los administradores pueden ver las de todos.
- **Mensajes en pantalla**: el administrador escribe avisos que cada usuario ve al iniciar sesión (o al instante si ya está conectado) hasta que los confirma.
- **Impresión de tickets** configurable para impresoras térmicas de 80 mm (p. ej. ZKTeco 8012) o 58 mm: al generar cada turno nuevo y/o al llamar el turno siguiente.
- **Descarga de estadísticas en PDF** desde la ventana de estadísticas de cada sesión.
- **Claves de la sesión** (administrador y sub-administrador de cada turnero): las acciones delicadas dentro del turnero piden usuario y contraseña, como en la aplicación original.

## Estructura

```
turnero-web/
├── app.py              # Flask: login, API, administración, estadísticas
├── models.py           # Tablas (SQLAlchemy)
├── reportes.py         # Generación del PDF de estadísticas (reportlab)
├── templates/index.html
├── static/css/style.css
├── static/js/app.js
├── requirements.txt
├── render.yaml         # Blueprint de Render
├── .env.example
└── .gitignore
```

> Las carpetas deben llamarse exactamente `templates` y `static`. Si falta `templates/index.html`, Render responde con `TemplateNotFound`.

## Variables de entorno

| Variable | Descripción |
|---|---|
| `DATABASE_URL` | Cadena de conexión de Neon. Vacía = SQLite local |
| `SECRET_KEY` | Firma las cookies de sesión. En Render se genera sola (`render.yaml`) |
| `ADMIN_USER` | Usuario del primer administrador (por defecto `admin`) |
| `ADMIN_PASSWORD` | Contraseña del primer administrador. Si falta, se crea con `admin123` y **se obliga a cambiarla** al entrar |
| `APP_TIMEZONE` | Zona horaria de fechas y horas (por defecto `America/Mexico_City`) |
| `SESSION_HOURS` | Duración de la sesión, se renueva con el uso (por defecto 12) |
| `COOKIE_SECURE` | `0` para pruebas por http local con `DATABASE_URL` definida |

`ADMIN_USER` y `ADMIN_PASSWORD` solo se usan cuando la base **no tiene usuarios**. Después, todo se gestiona desde la página.

## Despliegue (resumen)

1. **Neon**: crea el proyecto y copia la cadena con *Connection pooling* (`...-pooler...?sslmode=require`).
2. **GitHub**: sube la carpeta con `git init`, `git add .`, `git commit`, `git push`.
3. **Render**: *New → Blueprint*, elige el repositorio y rellena `DATABASE_URL` y `ADMIN_PASSWORD`.
   - Manual: Build `pip install -r requirements.txt`, Start `gunicorn app:app --workers 1 --threads 4 --timeout 60 --bind 0.0.0.0:$PORT`, y las variables de la tabla (con `SECRET_KEY` = una cadena larga aleatoria).

### Si ya tenías la versión anterior desplegada

Al arrancar, la app **migra sola** tu base de Neon sin borrar nada:
- Las cuentas antiguas pasan a ser usuarios: `admin` (administrador) y `sub_admin` (usuario normal), con las mismas contraseñas.
- Los turnos, ajustes e historial que ya existían quedan asignados al usuario `admin`.
- Los usuarios se escriben en minúsculas al iniciar sesión.
- Añade la variable `SECRET_KEY` en Render (si usas Blueprint, se crea sola).

## Uso

### Iniciar sesión
Entra con tu usuario y contraseña. Si el administrador te asignó una clave temporal, la página te pedirá cambiarla antes de continuar. La sesión dura 12 horas y se renueva mientras la uses. Puedes tener sesiones abiertas desde varios equipos a la vez.

### Administrador (botón 👥 Usuarios)
- **➕ Nuevo usuario**: usuario, nombre, contraseña inicial, si es administrador y si debe cambiar la clave al entrar. Su turnero se crea vacío.
- **⛔ Quitar acceso / ✅ Dar acceso**: quitar el acceso cierra su sesión al instante; sus datos se conservan y se pueden reactivar.
- **Hacer admin / Quitar admin**: un administrador puede gestionar usuarios.
- **🔑 Clave**: restablece la contraseña de otro usuario y cierra sus sesiones abiertas.
- **📊 Estadísticas**: abre las estadísticas de ese usuario.
- **🔐 Claves sesión**: borra las claves de administrador/sub-administrador del turnero de ese usuario (por si las olvidó); tendrá que crearlas de nuevo.
- **♻️ Inicializar**: cierra la jornada del usuario (queda en su historial) y deja su turnero en blanco.
- No puedes quitarte el acceso, cambiar tu propio rol ni restablecer tu propia clave desde ahí (usa **🔑 Mi clave**). Así siempre queda al menos un administrador activo.
- No hay botón de borrar usuarios a propósito: así se conservan sus estadísticas. Quitarles el acceso los deja inutilizables.

### Mensajes en pantalla (botón 📢 Mensajes, solo administradores)
- **➕ Nuevo mensaje**: escribe el texto (máx. 500 caracteres) y elige **todos los usuarios** o solo algunos.
- Cada usuario ve el mensaje en una ventana al iniciar sesión (o en cuanto llega, si ya estaba conectado, sin interrumpir lo que esté haciendo) y debe pulsar **«Entendido»**. Si no lo confirma, vuelve a aparecer en su próximo inicio de sesión.
- La tabla muestra a quién va dirigido, cuándo se envió y cuántos lo han confirmado (`3 de 5`). **🗑️ Retirar** deja de mostrarlo a quienes aún no lo confirmaron.
- Los mensajes no aparecen en el Modo Pantalla (para no tapar un monitor sin nadie que pulse el botón).

### Claves de la sesión: administrador y sub-administrador
Dentro de su turnero, cada usuario tiene **dos cuentas propias** que autorizan las acciones delicadas, igual que en la aplicación original. **No son la contraseña de acceso**: son otro par de usuario y contraseña, distinto para cada turnero.

| Acción | Quién la autoriza |
|---|---|
| Cambiar el modo de empleado (obligatorio / opcional) | Solo administrador de la sesión |
| Cambiar el modo de cotización (ON / OFF) | Solo administrador de la sesión |
| 🔑 Cambiar Clave (de administrador o de sub-administrador) | Solo administrador de la sesión |
| 🔄 Reiniciar Turnos | Administrador o sub-administrador |
| 🏁 Cerrar Jornada | Administrador o sub-administrador |

- **Primera vez**: al usar una de esas acciones, la página pide crear las dos cuentas (usuario y contraseña de cada una). Para confirmar que eres tú, pide antes tu contraseña de acceso, y las claves nuevas deben ser distintas de ella y entre sí. No hay claves por defecto.
- **Si las olvidas**: un administrador del sistema puede restablecerlas desde **👥 Usuarios → 🔐 Claves sesión** y se crean de nuevo.
- Bloqueo temporal tras 5 intentos fallidos de estas claves.
- Cada usuario cambia **su contraseña de acceso** con **🔑 Contraseña de acceso** (barra superior); no confundir con **🔑 Cambiar Clave** (claves de la sesión).

### Mi turnero
Igual que antes: paneles de **espera** y **atención**, empleado obligatorio u opcional, cotización de 6 dígitos, regla de paridad al limpiar y reiniciar, historial y **🖥️ Modo Pantalla** (`/?modo=pantalla`, muestra el turnero del usuario que tiene la sesión abierta).

Los **⚙️ Controles de mi turnero** (parte inferior) son un panel desplegable: pulsa su título para ocultarlos o mostrarlos; la página recuerda cómo lo dejaste.

Los modos de empleado y cotización, **Reiniciar Turnos** y **Cerrar Jornada** piden las claves de la sesión (ver arriba).

**🏁 Cerrar Jornada** guarda el resumen en tu historial y empieza una jornada nueva con el contador en 0. Para salir de tu cuenta usa **🚪 Salir**.

### 🖨️ Impresión de tickets
Botón **🖨️ Impresión** (controles del turnero). Cada sesión guarda su propia configuración:
- **Cuándo imprimir**: al generar un turno nuevo (➕ Nuevo Turno, ticket para el cliente) y/o al llamar el turno siguiente (Siguiente ▶, ticket del turno llamado). Ambas opciones vienen desactivadas.
- **Papel**: 80 mm (zona útil 72 mm) o 58 mm (48 mm). El número del turno se reduce solo si no cabe.
- **Contenido**: encabezado, subtítulo y pie de texto libre, tamaño del número (mediano, grande, enorme), número de copias (1 a 3), y casillas para mostrar fecha y hora, cuántos turnos hay delante, el empleado que atiende y el nombre de la sesión.
- **🖨️ Imprimir prueba** imprime un ticket de cada tipo con los valores que tengas en pantalla, sin guardarlos.
- **🖨️ Reimprimir** (o `Alt+P`) vuelve a imprimir el último turno en espera o el que está en atención.

**Cómo funciona**: la página imprime desde el navegador, así que sirve cualquier impresora instalada en *esa* computadora. El servidor en Render no puede alcanzar una impresora USB local.

**Preparar la ZKTeco 8012 (80 mm)**
1. Instala el controlador de la impresora en el equipo donde está conectada: el de la ZKTeco, o uno genérico de impresora de recibos de 80 mm. El controlador «Generic / Text Only» no sirve, porque solo imprime texto plano y no el diseño del ticket.
2. En las preferencias del controlador, elige papel de **80 mm de rollo** (por ejemplo «80mm x Receipt» o «Roll Paper 80 mm») y activa el corte automático al final de cada documento.
3. En el diálogo de impresión del navegador: destino = la ZKTeco, **Márgenes: Ninguno**, **Escala: 100 %**, y desactiva **Encabezados y pies de página**.
4. Pulsa **🖨️ Impresión → Imprimir prueba** y ajusta ancho y tamaño hasta que el ticket quede bien centrado.

**Imprimir sin ventana de confirmación (Chrome / Edge)**: por seguridad el navegador siempre pregunta, salvo que lo abras en modo de impresión directa. Pon la ZKTeco como impresora **predeterminada** de Windows y crea un acceso directo al navegador con el parámetro `--kiosk-printing`, por ejemplo:

```
"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://TU-APP.onrender.com
```
Ciérralo por completo antes de abrirlo con ese acceso directo. Así, cada turno imprime al instante sin diálogo.

**Impresión automática sin ventana (recomendada): USB directa**. En **🖨️ Impresión** elige *Método = USB directa ESC/POS*, pulsa **🔌 Vincular impresora USB**, selecciona la ZKTeco y guarda. Desde ese momento cada turno sale solo, con corte, sin diálogo. Requisitos: Chrome o Edge, página en https (Render ya lo es) y en Windows que la impresora use el controlador **WinUSB** (con la herramienta gratuita Zadig: *Options → List all devices →* tu impresora *→ WinUSB → Replace Driver*); con eso deja de aparecer como impresora normal de Windows, así que el método *Navegador* ya no funcionará en ese equipo. En Linux/ChromeOS/macOS normalmente funciona sin cambiar nada. Si la impresión USB falla, el sistema vuelve automáticamente al método del navegador. La ZKTeco 8012 también se puede conectar por red/serie, pero la vinculación directa solo cubre USB.

**Limitaciones**: el navegador no envía comandos propios de la impresora (como el corte), así que el corte depende del controlador. Si necesitas impresión directa por USB/red con comandos ESC/POS, haría falta un pequeño programa intermedio en la computadora del mostrador; no está incluido.

### 📊 Mis estadísticas
- **Jornada actual**: turnos generados, atendidos, limpiados, cotizaciones, empleados distintos, tiempos promedio, mínimo, máximo y total, tabla por empleado y detalle turno por turno.
- **Acumulado**: lo mismo sobre todas tus jornadas, más desglose por empleado, por día, por hora del día y la lista de jornadas cerradas.
- **📄 Descargar PDF**: genera un informe en A4 con todo lo anterior (tarjetas de totales, tablas, detalle turno por turno y gráfica por hora). Cada usuario descarga el suyo; un administrador puede descargar el de cualquier usuario desde 👥 Usuarios → 📊 Estadísticas.

### Atajos de teclado
Los navegadores reservan `Ctrl+N`, `Ctrl+L`, etc., así que se usan combinaciones con **Alt**:

| Atajo | Acción |
|---|---|
| `Alt+N` | Nuevo turno |
| `Alt+S` | Siguiente |
| `Alt+A` o `Retroceso` | Devolver turno a espera |
| `Alt+L` | Limpiar espera |
| `Alt+K` | Limpiar atención |
| `Alt+C` | Registrar cotización |
| `Alt+P` | Reimprimir ticket |

## Uso local
```bash
python -m venv .venv
source .venv/bin/activate        # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env             # opcional
python app.py                    # http://localhost:5000
```
Sin `.env`, entra con `admin` / `admin123` y la página te pedirá cambiar la clave.

## Seguridad
- Contraseñas guardadas con hash; cookie de sesión firmada, `HttpOnly`, `SameSite=Lax` y `Secure` en producción.
- Cada petición revalida al usuario: desactivarlo o cambiarle la clave cierra sus sesiones al momento.
- Un usuario solo puede ver y modificar sus propios turnos; las rutas de administración exigen rol de administrador.
- Bloqueo temporal tras 5 intentos fallidos de inicio de sesión desde la misma IP (y otro, independiente, para las claves de la sesión).
- Las claves de la sesión se guardan con hash, igual que las contraseñas de acceso.
- Las escrituras de la API solo se aceptan desde el propio JavaScript de la página (protección extra contra CSRF).

## Notas del plan gratuito
- Render gratis duerme el servicio tras un rato sin visitas; la primera carga puede tardar ~1 minuto.
- Neon suspende la base sin uso y se reactiva sola. Si ves un error de conexión por `channel_binding`, quita ese parámetro de la cadena.
