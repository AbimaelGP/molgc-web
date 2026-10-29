# MolGC Web — Molecular Geometry Comparator

Página web del algoritmo **MolGC** para comparar geometrías moleculares optimizadas con distintos
programas y funcionales DFT, enlace por enlace, y calcular el **error absoluto medio (MAE)** de las
longitudes de enlace.
``

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

