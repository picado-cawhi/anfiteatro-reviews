# ⚠️ Este repo ya no es la plataforma de reseñas — es sólo un redirect

El Centro de Reseñas del Anfiteatro vive en
**[`anfiteatrodevillacr/anfiteatro-reviews`](https://github.com/anfiteatrodevillacr/anfiteatro-reviews)**
y se sirve en **https://anfiteatro-reviews-rho.vercel.app**.

Este repo alimenta el proyecto de Vercel que sirve
`anfiteatro-reviews-eight.vercel.app`, un deployment de la era de la cuenta Cawhi
que quedó congelado en junio de 2026 sirviendo una versión vieja: hablaba con un
backend de Google Apps Script que está caído desde el 26-jun-2026. Quien entraba
por ahí llenaba la encuesta, veía la pantalla de gracias, y **no se guardaba nada**.

## Por qué es un redirect y no se borró el proyecto

Borrar el proyecto de Vercel libera el hostname y `-eight` deja de resolver. Todo
QR o link que apunte ahí pasaría de "guarda mal" a "no abre nada" — y eso sí
obliga a reimprimir códigos y a que el personal los cambie mesa por mesa.

Con el redirect, cualquiera que llegue a una URL vieja termina en la plataforma
buena, **conservando la ruta y los parámetros** (`?mesero=Ana` sigue atribuyendo a
Ana). Es 307 temporal a propósito: si algún día se pone un dominio propio, cambiar
el destino es una línea y no hay que pelear con redirects permanentes cacheados.

## No edites el HTML de este repo

Los `.html` que quedan son históricos. El redirect corre **antes** que el sistema
de archivos, así que ya no se sirven. Cualquier cambio real va en el repo bueno.
