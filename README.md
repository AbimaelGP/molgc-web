# MolGC Web — Molecular Geometry Comparator

Página web del algoritmo **MolGC** para comparar geometrías moleculares optimizadas con distintos
programas y funcionales DFT, enlace por enlace, y calcular el **error absoluto medio (MAE)** de las
longitudes de enlace.

**Todo se ejecuta en el navegador**: es una página estática, sin servidor. Se publica gratis en GitHub
Pages, nunca "se duerme" y los archivos de los usuarios no salen de su computadora.

> Camarillo-Cisneros J., Ramírez-Alonso G., Arzate-Quintana C., Varela-Rodríguez H., Guzmán-Pando A.
> *MolGC: molecular geometry comparator algorithm for bond length mean absolute error computation on molecules.*
> Molecular Diversity (2024). https://doi.org/10.1007/s11030-024-10945-2

## Qué hace

| Modo | Entrada | Salida |
|---|---|---|
| **Molécula vs molécula** | 2 archivos en cualquier formato (p. ej. dos `.xyz` de funcionales distintos) | MAE, MAPE, error máximo, RMSD, tabla enlace por enlace, superposición 3D coloreada por error, Excel/CSV/XYZ |
| **Varios funcionales** | N geometrías de la misma molécula; se elige la referencia | MAE y RMSD por funcional, mapa de errores por enlace, MAE por tipo de enlace, Excel con el formato de la Tabla 2 del artículo |
| **Estudio completo** | ZIP con `Familia/Molécula/Software/Funcional/archivo` (igual que el MolGC de escritorio) | MAE por molécula y por familia, promedio global y ranking **UW-TOPSIS**, Excel |

Formatos (detección automática por contenido): **Gaussian** `.log`, **CASTEP** `.castep`,
**FHI-aims** `.out` y `geometry.in`, **XYZ** (estándar, multi-cuadro o sólo `El x y z`).

## Publicar en GitHub Pages (gratis)

1. Crea un repositorio **público** vacío en https://github.com/new (por ejemplo `molgc`).
2. Sube esta carpeta. Desde una terminal, dentro de `molgc-web`:
   ```bash
   git init
   git add .
   git commit -m "MolGC Web"
   git branch -M main
   git remote add origin https://github.com/TU_USUARIO/molgc.git
   git push -u origin main
   ```
   (Si prefieres no usar la terminal: instala GitHub Desktop, «Add existing repository» y «Publish».)
3. En GitHub: **Settings → Pages → Build and deployment → Source: Deploy from a branch**,
   **Branch: `main`** y carpeta **`/docs`** → **Save**.
4. En 1–2 minutos la página queda en `https://TU_USUARIO.github.io/molgc/`.
   Cada `git push` la actualiza sola.

Dominio propio (opcional): en la misma pantalla de Pages, campo *Custom domain* (p. ej. `molgc.uach.mx`,
pidiendo a TI un registro CNAME hacia `TU_USUARIO.github.io`).

**Alternativa:** Hugging Face → *New Space* → SDK **Static** → sube el **contenido** de la carpeta `docs/`.

## Probar en tu computadora

La página necesita servirse por HTTP (no abriendo el archivo con doble clic):

```bash
cd docs
python -m http.server 8000
```

y abre http://localhost:8000.

## Estructura

```
docs/                    ← la página web (lo que publica GitHub Pages)
  index.html, styles.css, app.js, i18n.js
  engine/molgc.js        motor MolGC en JavaScript (lectores, orientación 4x4, ICP+Kabsch,
                         enlaces, descriptores S_uv y SD_uv, etiquetado, MAE, TOPSIS)
  engine/worker.js       ejecuta el motor en segundo plano (Web Worker)
  engine/xlsx.js         genera los Excel
  vendor/                Plotly, 3Dmol.js y fflate (incluidos, sin depender de CDN)
  data/demo/             conjunto de antibióticos del artículo y ejemplos .xyz
molgc/                   implementación de referencia en Python (+ línea de comandos)
tests/                   pruebas: reproducción del MolGC original y equivalencia Python ↔ JavaScript
tools/                   scripts de validación
```

## Validación

* **Contra el MolGC original:** con «Sólo tabla MolGC» + emparejamiento «MolGC», los MAE y RMSD coinciden
  con el código original en las 13 moléculas (diferencia < 10⁻⁶ Å).
* **JavaScript ↔ Python:** el motor del navegador da resultados idénticos a la implementación Python en
  234 comparaciones (mismas longitudes, etiquetas, emparejamientos, MAE y RMSD).

```bash
pip install -r requirements.txt
pytest -q                     # incluye la prueba JS ↔ Python si tienes Node.js
```

Si modificas el algoritmo, cambia **ambas** implementaciones (`molgc/*.py` y `docs/engine/molgc.js`),
regenera la referencia con `python tools/dump_reference.py docs/data/demo/Molecules tests/data/python_reference.json`
y corre `pytest`.

Línea de comandos (Python):

```bash
python -m molgc referencia.log evaluada.castep otra.xyz --xlsx resultados.xlsx
```

## Cambios respecto al código original

* Comparación directa de dos geometrías y de N geometrías arbitrarias (ya no es obligatoria la estructura
  de carpetas), incluido `.xyz` estándar para comparar funcional contra funcional.
* Para pares de elementos que no están en la tabla de MolGC (S, P, Br, I, metales…) se usan radios
  covalentes (Cordero 2008), configurable.
* Modo de emparejamiento por correspondencia atómica (húngaro + Kabsch respetando la conectividad), que
  tolera enlaces faltantes o sobrantes, y verificación de calidad del etiquetado en cada resultado.
* RMSD con correspondencia atómica explícita, MAPE, error máximo y MAE por tipo de enlace.
* CASTEP: se usa la red real completa (también celdas no ortorrómbicas) y se reconstruyen moléculas
  partidas por la frontera periódica.
* El original reportaba como «Percentage» el MAE × 100 (en Å). Aquí el MAE se reporta en Å y el
  porcentaje es el error relativo real (MAPE).

## Licencia

Agrega la licencia que elija el grupo de investigación (p. ej. MIT o GPL-3.0). Plotly.js (MIT),
3Dmol.js (BSD-3) y fflate (MIT) se distribuyen en `docs/vendor/` con sus licencias.
