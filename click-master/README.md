# 🖐️ CLICK MASTER

**Your hands. Your commands. One Click Master.**

Extensión de Google Chrome que convierte la cámara de tu computadora en un controlador de gestos. Mové el cursor, hacé click, abrí Spotify y más, usando solo las manos.

MVP funcional para hackathon (priorizado en P0).

---

## Qué problema resuelve

Controlar el navegador sin mouse ni teclado físico, usando gestos naturales frente a la cámara. Ideal para demos, accesibilidad experimental y experiencias futuristas tipo *Minority Report*.

---

## Stack

- JavaScript (ES modules)
- HTML5 + CSS3
- Chrome Extension Manifest V3
- MediaPipe Tasks Vision (Hand Landmarker)
- Chrome Tabs / Scripting / Downloads API

Todo el procesamiento de imagen se hace **localmente** en el navegador. No se envían imágenes ni datos biométricos a ningún servidor.

---

## Arquitectura

```
click-master/
├── manifest.json
├── package.json
├── README.md
├── popup/               # Popup de la extensión
├── dashboard/           # Pantalla principal (cámara + UI)
├── camera/              # Utilidades de tracking
├── gestures/            # Configuración de gestos
├── actions/             # Acciones de browser / mouse
├── content/             # Content scripts (Instagram adapter)
├── background/          # Service worker + Native Messaging bridge
├── native-host/         # Host Python para cursor global del SO
├── keyboard/            # (P2) Teclado virtual
└── assets/icons/
```

Separación clara:
1. Captura de cámara
2. Detección de landmarks (MediaPipe)
3. Reconocimiento de gestos + máquina de estados
4. Ejecución de acciones (vía mensajes al service worker)

---

## Instalación

1. Cloná o descargá este proyecto.
2. Abrí Chrome y andá a `chrome://extensions`.
3. Activá **Modo de desarrollador** (arriba a la derecha).
4. Clic en **Cargar extensión sin empaquetar**.
5. Seleccioná la carpeta `click-master`.
6. La extensión aparece con el ícono de mano.

---

## Cómo usarla

1. Hacé clic en el ícono de la extensión → **Abrir Dashboard**.
2. En el Dashboard, pulsá **▶ START**.
3. Permití el acceso a la cámara cuando Chrome lo pida.
4. Poné tu mano frente a la cámara (espejada).
5. Probá los gestos P0:

| Gesto              | Acción                  |
|--------------------|-------------------------|
| ☝️ Índice levantado | Mover cursor virtual   |
| 🤏 Pinch (pulgar+índice) | Click izquierdo   |
| 🤘 Rock (índice + meñique) | Abrir Spotify Web |
| ✊ Puño             | Click derecho (Mouse)  |
| 👍 Pulgar arriba    | Like (en Instagram)    |
| 🖐️ Palma abierta   | Pausar controles       |
| ▭ Rectángulo 2 manos | Screenshot          |

---

## Funcionalidades implementadas (MVP)

### P0 (listas)
- Extensión instalable (Manifest V3)
- Cámara en vivo (espejada)
- MediaPipe Hand Landmarker (1-2 manos)
- Landmarks dibujados en overlay
- Cursor virtual suavizado dentro del dashboard
- Click izquierdo (pinch con cooldown y estabilidad)
- Gesto 🤘 → abre `https://open.spotify.com/` en nueva pestaña
- UI futurista (modos, toasts, estados)

### P1 (implementadas a nivel básico)
- Screenshot de la pestaña visible (descarga PNG)
- Like en Instagram (content script + selectores accesibles)
- Zoom de pestaña (vía API, listo para conectar a gesto continuo)

### P2 (arquitectura preparada, no prioritario)
- Teclado virtual (Air Keyboard)
- Cambio de pestañas por gestos
- Control de cursor del sistema operativo (requiere Native Messaging)

---

## Limitaciones conocidas

- **Cursor global del SO**: implementado vía Native Messaging (ver sección más abajo). Sin el host instalado, solo funciona el cursor virtual del Dashboard.
- **MediaPipe desde CDN**: requiere conexión a internet la primera vez (wasm + modelo). Para offline, descargar los assets localmente.
- **Service Worker**: no ejecuta el loop de cámara (correcto según MV3). Todo el procesamiento vive en el documento del Dashboard.
- **Instagram Like**: depende de los `aria-label` actuales. Si Instagram cambia la UI, el adaptador puede fallar (mensaje informativo).
- **Falsos positivos**: los umbrales son conservadores. Ajustables en `gestures/gesture-config.js`.
- **Zoom continuo**: el gesto de pellizco inverso está detectado; la lógica de zoom progresivo se puede conectar fácilmente al `SET_ZOOM`.

---

## Seguridad y permisos

Permisos solicitados:
- `tabs`, `activeTab`, `scripting`, `storage`, `downloads`
- Host permissions limitados a Spotify, Instagram y el CDN de MediaPipe

La cámara **solo** se activa cuando el usuario pulsa START y se libera con STOP.

---

## Próximos pasos

1. Empaquetar el modelo MediaPipe localmente (sin CDN).
2. Native Messaging para cursor del sistema.
3. Air Keyboard completo.
4. Más adaptadores sociales (Twitter/X, YouTube, etc.).
5. Calibración de gestos por usuario.
6. Modo “siempre arriba” del Dashboard.

---

## Demo central de la hackathon

1. Abrir Dashboard → START.
2. Hacer el gesto **🤘 Rock**.
3. Se abre Spotify Web automáticamente.

Esa es la experiencia que tiene que funcionar perfecto.

---

Hecho con ❤️ para la hackathon.  
*Your hands. Your commands. One Click Master.*

---

## Native Messaging — Cursor global del sistema

Chrome **no permite** que una extensión mueva el cursor del sistema operativo por sí sola.  
Click Master usa **Native Messaging**: un pequeño programa nativo (Python) que recibe comandos de la extensión y mueve el mouse real.

### Requisitos del host

- Python 3.8+
- `pynput` (`pip install pynput`)

### Instalación del host (una sola vez)

1. Cargá la extensión en `chrome://extensions` y **copiá el ID** de Click Master (cadena de 32 caracteres).
2. Abrí una terminal en la carpeta `native-host/`:

```bash
cd click-master/native-host
pip install pynput
python install_host.py --extension-id TU_EXTENSION_ID
```

3. **Reiniciá Chrome por completo** (cerrá todas las ventanas).
4. Abrí el Dashboard de Click Master.  
   En la barra superior debería aparecer **Native ON**.

### Cómo funciona

```
Dashboard (MediaPipe)
    │  NATIVE_MOVE / NATIVE_CLICK
    ▼
Service Worker
    │  chrome.runtime.connectNative("com.clickmaster.host")
    ▼
click_master_host.py  (pynput)
    │
    ▼
Cursor del sistema operativo
```

- El movimiento se limita a ~30 Hz para no saturar.
- El eje X se invierte automáticamente porque la cámara está espejada.
- Si el host no está instalado, la extensión sigue funcionando solo con el cursor virtual del Dashboard.

### Desinstalación del host

Borrá el archivo de manifiesto del sistema:

| SO        | Ruta |
|-----------|------|
| Linux     | `~/.config/google-chrome/NativeMessagingHosts/com.clickmaster.host.json` |
| macOS     | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/com.clickmaster.host.json` |
| Windows   | `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\com.clickmaster.host.json` + clave de registro |

### Limitaciones de Native Messaging

- En macOS el host puede necesitar permisos de **Accesibilidad** (Preferencias del Sistema → Seguridad → Accesibilidad).
- En Linux funciona mejor bajo X11; en Wayland puede requerir configuración extra.
- El service worker de MV3 puede suspenderse; el host se reconecta al despertar.

