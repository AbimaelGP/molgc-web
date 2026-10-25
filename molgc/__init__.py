"""MolGC — Molecular Geometry Comparator (versión web)."""
from .parsers import Geometry, ParseError, read_geometry, read_geometry_file  # noqa: F401
from .analysis import Options, compare_geometries, run_study, topsis_uw  # noqa: F401

__version__ = "2.0.0"
