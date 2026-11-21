# Minibar · Hotel Tilo

Los de limpieza avisan desde el celular qué falta en cada minibar; room service recibe el aviso, repone, y un tablero mide cuánto tardan y cuánto se consume. Administración carga personal, habitaciones y productos.

**App funcionando:** PEGAR_ACÁ_EL_LINK  _(la primera visita puede tardar 1 minuto)_

## Probarla (usuarios de ejemplo)
| Perfil | Nombre | Código |
|---|---|---|
| Administración | Administración | 0000 |
| Limpieza | Ana / Rosa / Marta | 1111 / 2222 / 3333 |
| Room service | Luis / Sofía | 9001 / 9002 |

Recorrido: en una ventana entrá como **Ana**, abrí la 204, sumá 2 aguas y tocá "Avisar". En otra ventana entrá como **Luis**: aparece el aviso con sonido. Tocá "Ya repuse" y mirá el **Tablero**. Con **Administración** podés agregar personas, habitaciones y productos.

## Cómo está armado
    server.js        arranca todo
    src/db.js        tablas de la base de datos y datos de ejemplo
    src/api.js       las rutas del servidor y los permisos de cada rol
    src/pin.js       guarda los códigos de forma segura (no en texto)
    public/          la pantalla: index.html, styles.css, app.js

## Correrla en tu computadora
    npm install
    npm start        # http://localhost:3000, con base temporal (se borra al reiniciar)

Para usar una base real, copiar `.env.example` a `.env` y pegar la dirección de PostgreSQL en `DATABASE_URL`
(o definir `DATABASE_URL` como variable de entorno).

## Con Docker
    docker build -t minibar-tilo .
    docker run -p 3000:3000 -e DATABASE_URL="..." minibar-tilo

## Publicarla
1. Base de datos: crear un proyecto gratis en supabase.com y copiar la dirección de conexión (Connect > Session pooler).
2. Código: subir esta carpeta a un repositorio público de GitHub.
3. Servidor: en render.com crear un Web Service desde ese repositorio (usa el Dockerfile) y agregar la variable `DATABASE_URL`.
Las tablas y los datos de ejemplo se crean solos la primera vez.
