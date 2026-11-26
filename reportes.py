"""Generación del PDF de estadísticas de un usuario (reportlab).

Recibe el diccionario que devuelve `_estadisticas()` en app.py y produce los bytes
del PDF. No depende de Flask ni de la base de datos.
"""
from io import BytesIO
from xml.sax.saxutils import escape

from reportlab.graphics.charts.barcharts import VerticalBarChart
from reportlab.graphics.shapes import Drawing
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    KeepTogether,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

AZUL = colors.HexColor("#1976D2")
AZUL_CLARO = colors.HexColor("#E3F2FD")
GRIS = colors.HexColor("#607D8B")
GRIS_CLARO = colors.HexColor("#F5F7F8")

_base = getSampleStyleSheet()
ESTILO_TITULO = ParagraphStyle("t", parent=_base["Title"], fontSize=20, textColor=AZUL, alignment=0, spaceAfter=2)
ESTILO_SUB = ParagraphStyle("s", parent=_base["Normal"], fontSize=9, textColor=GRIS, spaceAfter=6)
ESTILO_H1 = ParagraphStyle("h1", parent=_base["Heading2"], fontSize=14, textColor=AZUL, spaceBefore=10, spaceAfter=4)
ESTILO_H2 = ParagraphStyle("h2", parent=_base["Heading3"], fontSize=11, textColor=GRIS, spaceBefore=8, spaceAfter=3)
ESTILO_VACIO = ParagraphStyle("v", parent=_base["Normal"], fontSize=9, textColor=GRIS, spaceAfter=6)
ESTILO_CELDA = ParagraphStyle("c", parent=_base["Normal"], fontSize=7.5, leading=9, alignment=1)
ESTILO_CELDA_IZQ = ParagraphStyle("ci", parent=ESTILO_CELDA, alignment=0)
ESTILO_CABECERA = ParagraphStyle("ch", parent=ESTILO_CELDA, textColor=colors.white, fontName="Helvetica-Bold")
ESTILO_KPI_VALOR = ParagraphStyle("kv", parent=_base["Normal"], fontSize=14, leading=16, fontName="Helvetica-Bold", textColor=AZUL, alignment=1)
ESTILO_KPI_ETIQ = ParagraphStyle("ke", parent=_base["Normal"], fontSize=7.5, leading=9, textColor=GRIS, alignment=1)


def _t(valor):
    """Texto seguro: sin etiquetas y solo con caracteres que la fuente estándar dibuja."""
    if valor is None or valor == "":
        return "—"
    texto = str(valor).encode("cp1252", "replace").decode("cp1252")
    return escape(texto)


def _fecha(iso):
    if not iso:
        return "Sin fecha"
    partes = str(iso).split("-")
    return "/".join(reversed(partes)) if len(partes) == 3 else str(iso)


def _dur(segundos):
    if segundos is None:
        return None
    s = int(segundos)
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def _tabla(columnas, filas, anchos=None):
    """columnas: [(titulo, clave|función, alineación_izq)]"""
    datos = [[Paragraph(_t(c[0]), ESTILO_CABECERA) for c in columnas]]
    for f in filas:
        fila = []
        for titulo, clave, *resto in columnas:
            izq = bool(resto and resto[0])
            valor = clave(f) if callable(clave) else f.get(clave)
            fila.append(Paragraph(_t(valor), ESTILO_CELDA_IZQ if izq else ESTILO_CELDA))
        datos.append(fila)
    tabla = Table(datos, colWidths=anchos, repeatRows=1)
    tabla.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), AZUL),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, GRIS_CLARO]),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.HexColor("#CFD8DC")),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 3),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ]
        )
    )
    return tabla


def _kpis(items, columnas=4, ancho_total=180 * mm):
    celdas = [
        [Paragraph(_t(valor), ESTILO_KPI_VALOR), Paragraph(_t(etiqueta), ESTILO_KPI_ETIQ)]
        for valor, etiqueta in items
    ]
    filas = []
    for i in range(0, len(celdas), columnas):
        fila = celdas[i : i + columnas]
        fila += [["", ""]] * (columnas - len(fila))
        filas.append(fila)
    # Cada tarjeta es una mini tabla de 2 filas (valor + etiqueta).
    ancho = ancho_total / columnas
    contenido = []
    for fila in filas:
        contenido.append(
            [
                Table([[c[0]], [c[1]]], colWidths=[ancho - 4 * mm]) if c[0] != "" else ""
                for c in fila
            ]
        )
    tabla = Table(contenido, colWidths=[ancho] * columnas)
    estilo = [
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
    ]
    for r, fila in enumerate(filas):
        for c, celda in enumerate(fila):
            if celda[0] != "":
                estilo += [
                    ("BACKGROUND", (c, r), (c, r), AZUL_CLARO),
                    ("BOX", (c, r), (c, r), 1.5, colors.white),
                ]
    tabla.setStyle(TableStyle(estilo))
    return tabla


def _grafico_horas(filas):
    if not filas:
        return None
    n = len(filas)
    ancho, alto = 180 * mm, 55 * mm
    dibujo = Drawing(ancho, alto)
    g = VerticalBarChart()
    g.x, g.y = 30, 22
    g.width, g.height = ancho - 45, alto - 34
    g.data = [[f["turnos"] for f in filas]]
    g.categoryAxis.categoryNames = [str(f["hora"]) for f in filas]
    g.categoryAxis.labels.fontName = "Helvetica"
    g.categoryAxis.labels.fontSize = 7
    g.categoryAxis.labels.angle = 0 if n <= 12 else 45
    g.categoryAxis.labels.dy = -2 if n <= 12 else -8
    g.valueAxis.valueMin = 0
    g.valueAxis.valueMax = max(f["turnos"] for f in filas) + 1
    g.valueAxis.labels.fontName = "Helvetica"
    g.valueAxis.labels.fontSize = 7
    g.valueAxis.visibleGrid = True
    g.valueAxis.gridStrokeColor = colors.HexColor("#CFD8DC")
    g.bars[0].fillColor = AZUL
    g.bars[0].strokeColor = None
    g.barLabelFormat = "%d"
    g.barLabels.nudge = 6
    g.barLabels.fontName = "Helvetica"
    g.barLabels.fontSize = 7
    g.groupSpacing = 4
    dibujo.add(g)
    return dibujo


def _kpis_bloque(b, extra=()):
    t = b["tiempos"]
    return list(extra) + [
        (b["generados"], "Turnos generados"),
        (b["atendidos"], "Turnos atendidos"),
        (b["limpiados"], "Turnos limpiados"),
        (b["cotizaciones"], "Cotizaciones"),
        (b["empleados"], "Empleados distintos"),
        (t["promedio_f"], "Tiempo promedio"),
        (t["minimo_f"], "Tiempo mínimo"),
        (t["maximo_f"], "Tiempo máximo"),
        (t["total_f"], "Tiempo total atendiendo"),
    ]


COLS_EMPLEADO = [
    ("Empleado", "empleado", True),
    ("Turnos", "turnos"),
    ("Cotiz.", "cotizaciones"),
    ("T. promedio", "promedio_f"),
    ("T. mínimo", "minimo_f"),
    ("T. máximo", "maximo_f"),
    ("T. total", "total_f"),
]


def generar_pdf_estadisticas(d, incluir_detalle=True):
    """Devuelve los bytes del PDF con las estadísticas `d` (salida de `_estadisticas`)."""
    buffer = BytesIO()
    usuario = d["usuario"]
    titulo_doc = f"Estadísticas de {usuario['nombre']}"

    def pie(canvas, doc):
        canvas.saveState()
        canvas.setFont("Helvetica", 7.5)
        canvas.setFillColor(GRIS)
        canvas.drawString(15 * mm, 9 * mm, _plano(f"{titulo_doc} · generado {d['generado']}"))
        canvas.drawRightString(A4[0] - 15 * mm, 9 * mm, f"Página {doc.page}")
        canvas.restoreState()

    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=15 * mm,
        rightMargin=15 * mm,
        topMargin=14 * mm,
        bottomMargin=16 * mm,
        title=_plano(titulo_doc),
        author="Turnero Web",
    )

    a, h = d["actual"], d["historico"]
    historia = []

    historia.append(Paragraph("Estadísticas del turnero", ESTILO_TITULO))
    historia.append(
        Paragraph(
            f"Usuario: <b>{_t(usuario['nombre'])}</b> ({_t(usuario['usuario'])}) · "
            f"Generado: {_t(d['generado'])}",
            ESTILO_SUB,
        )
    )

    # ---- Jornada actual ----
    historia.append(Paragraph("Jornada actual", ESTILO_H1))
    historia.append(
        Paragraph(
            f"Inicio: {_t(a['inicio'])} · Empleado: {_t(a['modo_empleado'])} · "
            f"Cotización: {_t(a['modo_cotizacion'])}",
            ESTILO_SUB,
        )
    )
    historia.append(
        _kpis(_kpis_bloque(a, [(a["espera"], "En espera ahora"), (a["atencion"], "En atención ahora")]))
    )

    historia.append(Paragraph("Por empleado (jornada actual)", ESTILO_H2))
    if a["por_empleado"]:
        historia.append(_tabla(COLS_EMPLEADO, a["por_empleado"]))
    else:
        historia.append(Paragraph("Sin datos todavía.", ESTILO_VACIO))

    if incluir_detalle:
        historia.append(Paragraph("Detalle de turnos atendidos (jornada actual)", ESTILO_H2))
        if a["detalle"]:
            historia.append(
                _tabla(
                    [
                        ("Turno", "turno"),
                        ("Empleado", "empleado", True),
                        ("Fecha", lambda r: _fecha(r.get("fecha"))),
                        ("Llamado", "hora_llamado"),
                        ("Fin", "hora_fin"),
                        ("Duración", lambda r: _dur(r.get("duracion_segundos"))),
                        ("Cotización", "cotizacion"),
                        ("Limpiado", lambda r: "Sí" if r.get("limpiado") else ""),
                    ],
                    a["detalle"],
                )
            )
        else:
            historia.append(Paragraph("Aún no se ha atendido ningún turno en esta jornada.", ESTILO_VACIO))

    # ---- Acumulado ----
    historia.append(Paragraph("Acumulado de todas las jornadas", ESTILO_H1))
    historia.append(
        Paragraph(
            f"Incluye la jornada actual y {h['sesiones_cerradas']} jornada(s) cerrada(s).",
            ESTILO_SUB,
        )
    )
    historia.append(_kpis(_kpis_bloque(h, [(h["sesiones_cerradas"], "Jornadas cerradas")])))

    historia.append(Paragraph("Por empleado (acumulado)", ESTILO_H2))
    if h["por_empleado"]:
        historia.append(_tabla(COLS_EMPLEADO, h["por_empleado"]))
    else:
        historia.append(Paragraph("Sin datos todavía.", ESTILO_VACIO))

    historia.append(Paragraph("Por día", ESTILO_H2))
    if h["por_dia"]:
        historia.append(
            _tabla(
                [
                    ("Fecha", "fecha"),
                    ("Atendidos", "turnos"),
                    ("Empleados", "empleados"),
                    ("Cotiz.", "cotizaciones"),
                    ("T. promedio", "promedio_f"),
                    ("T. mínimo", "minimo_f"),
                    ("T. máximo", "maximo_f"),
                    ("T. total", "total_f"),
                ],
                h["por_dia"],
            )
        )
    else:
        historia.append(Paragraph("Sin datos todavía.", ESTILO_VACIO))

    historia.append(Paragraph("Turnos atendidos por hora del día", ESTILO_H2))
    grafico = _grafico_horas(h["por_hora"])
    if grafico is not None:
        historia.append(KeepTogether([grafico]))
    else:
        historia.append(Paragraph("Sin datos todavía.", ESTILO_VACIO))

    historia.append(Paragraph("Jornadas cerradas", ESTILO_H2))
    if d["sesiones"]:
        historia.append(
            _tabla(
                [
                    ("ID", "id_sesion"),
                    ("Inicio", "fecha_inicio"),
                    ("Cierre", "fecha_cierre"),
                    ("Duración", "duracion"),
                    ("Gener.", "generados"),
                    ("Atend.", "atendidos"),
                    ("Limp.", "limpiados"),
                    ("Cotiz.", "cotizaciones"),
                    ("T. prom.", "promedio"),
                    ("T. máx.", "maximo"),
                ],
                d["sesiones"],
            )
        )
    else:
        historia.append(Paragraph("Todavía no hay jornadas cerradas.", ESTILO_VACIO))

    historia.append(Spacer(1, 4 * mm))
    doc.build(historia, onFirstPage=pie, onLaterPages=pie)
    return buffer.getvalue()


def _plano(texto):
    """Texto plano (sin escapar) compatible con la fuente estándar."""
    return str(texto).encode("cp1252", "replace").decode("cp1252")
