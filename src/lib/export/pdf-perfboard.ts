// ============================================================
// PDF Export — Bestückungsseite (top) + Lötseite (bottom)
// ============================================================
//
// Renders the perfboard layout as a two-page or two-section PDF:
//  • Top half: Component side (Bestückungsseite)
//    – Components as boxes with names
//    – Component pins as larger dots
//    – Single pins / pin rows as ⌀ (circle with slash)
//  • Bottom half: Solder side (Lötseite) — mirrored
//    – X where a leg goes through a hole
//    – Lines where solder connections run
//
// The full Eurocard size (64×39 = 160mm×100mm) is always shown.
// If the board is smaller it is placed in the top-left corner.

import { jsPDF } from 'jspdf';
import type {
  PerfboardDocument,
  PerfboardComponent,
  ComponentDefinition,
  GridPosition,
  FootprintPad,
} from '@/types';
import { getBuiltInComponents, getAdjustedFootprint } from '@/lib/component-library';
import { GRID_SPACING_MM, BOARD_SIZE_PRESETS } from '@/constants';

// ---- Helpers ----

/** Eurocard dimensions in holes */
const EUROCARD = BOARD_SIZE_PRESETS.find((p) => p.name.startsWith('Eurocard'))!;
const EUROCARD_COLS = EUROCARD.width; // 64
const EUROCARD_ROWS = EUROCARD.height; // 39

/** Rotate a pad offset by 0/90/180/270 degrees */
function rotatePad(pad: GridPosition, rotation: number): GridPosition {
  const r = ((rotation % 360) + 360) % 360;
  switch (r) {
    case 0:
      return { col: pad.col, row: pad.row };
    case 90:
      return { col: -pad.row, row: pad.col };
    case 180:
      return { col: -pad.col, row: -pad.row };
    case 270:
      return { col: pad.row, row: -pad.col };
    default:
      return pad;
  }
}

// ---- Compute component bounding box in grid coords (after rotation) ----

interface ComponentLayoutInfo {
  comp: PerfboardComponent;
  def: ComponentDefinition;
  pads: { pad: FootprintPad; abs: GridPosition }[];
  bodyMin: GridPosition;
  bodyMax: GridPosition;
}

function computeComponentLayout(
  comp: PerfboardComponent,
  def: ComponentDefinition,
): ComponentLayoutInfo {
  const { pads: adjustedPads, spanHoles } = getAdjustedFootprint(def, comp.properties?.holeSpan);

  const absPads = adjustedPads.map((pad) => {
    const rotated = rotatePad(pad.gridPosition, comp.rotation);
    return {
      pad,
      abs: {
        col: comp.gridPosition.col + rotated.col,
        row: comp.gridPosition.row + rotated.row,
      },
    };
  });

  // Body bounding box from pads
  const cols = absPads.map((p) => p.abs.col);
  const rows = absPads.map((p) => p.abs.row);
  let cMin = Math.min(...cols),
    cMax = Math.max(...cols);
  let rMin = Math.min(...rows),
    rMax = Math.max(...rows);

  // Expand to match spanHoles
  const rAngle = ((comp.rotation % 360) + 360) % 360;
  let spanC = spanHoles.col,
    spanR = spanHoles.row;
  if (rAngle === 90 || rAngle === 270) {
    const t = spanC;
    spanC = spanR;
    spanR = t;
  }
  const padC = cMax - cMin + 1;
  const padR = rMax - rMin + 1;
  const eC = spanC - padC;
  const eR = spanR - padR;
  if (eC > 0) {
    cMin -= eC / 2;
    cMax += eC / 2;
  }
  if (eR > 0) {
    rMin -= eR / 2;
    rMax += eR / 2;
  }

  return {
    comp,
    def,
    pads: absPads,
    bodyMin: { col: cMin, row: rMin },
    bodyMax: { col: cMax, row: rMax },
  };
}

// ---- Main Export Function ----

export function exportPerfboardPDF(
  perfboard: PerfboardDocument,
  projectName: string,
  customComponents: ComponentDefinition[] = [],
): { blobUrl: string; filename: string; blob: Blob } {
  const allLib = [...getBuiltInComponents(), ...customComponents];

  const dateStr = new Date().toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });

  // Always render full Eurocard grid
  const euroCols = EUROCARD_COLS;
  const euroRows = EUROCARD_ROWS;

  // Board dimensions in mm (hole-to-hole)
  const boardWidthMM = (euroCols - 1) * GRID_SPACING_MM;
  const boardHeightMM = (euroRows - 1) * GRID_SPACING_MM;

  // PDF layout: A4 portrait
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const pageW = doc.internal.pageSize.getWidth();  // ~210mm
  const pageH = doc.internal.pageSize.getHeight(); // ~297mm

  const marginX = 12;
  const marginY = 10;
  const labelGutter = 5; // space for hole number labels
  const boardPad = 2;    // padding between board outline and grid holes
  const sectionLabelH = 5; // height for "Bestückungsseite" / "Lötseite" labels
  const sectionGap = 3;    // gap between sections

  // ============================================================
  // DIN EN ISO 7200 — Title Block (Schriftfeld)
  // ============================================================
  const tbTop = marginY;
  const tbH = drawTitleBlock(doc, marginX, tbTop, pageW - 2 * marginX, projectName, perfboard, dateStr);
  const contentTop = tbTop + tbH + 3;

  // ============================================================
  // Footer
  // ============================================================
  const footerH = 7;
  const contentBottom = pageH - marginY - footerH;

  // Available height for both board sections + labels + gap
  const availContentH = contentBottom - contentTop;
  const availBoardH = (availContentH - 2 * sectionLabelH - sectionGap) / 2;

  // Total area the board needs including padding + label gutter
  const totalBoardW = boardWidthMM + 2 * boardPad;
  const totalBoardH = boardHeightMM + 2 * boardPad;

  // Available drawing width (minus label gutter on both sides for centering)
  const drawAreaW = pageW - 2 * marginX - labelGutter;

  // Scale to fit one board section
  const scaleX = drawAreaW / totalBoardW;
  const scaleY = availBoardH / (totalBoardH + labelGutter);
  const scale = Math.min(scaleX, scaleY);

  const drawW = totalBoardW * scale;
  const drawH = totalBoardH * scale;
  const boardPadScaled = boardPad * scale;

  // Resolve component definitions
  const layouts: ComponentLayoutInfo[] = [];
  for (const comp of perfboard.components) {
    const def = allLib.find((d) => d.id === comp.libraryId);
    if (!def) continue;
    layouts.push(computeComponentLayout(comp, def));
  }

  // ============================================================
  // Section 1: Bestückungsseite
  // ============================================================
  let curY = contentTop;

  // Section label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(26, 106, 171); // #1a6aab
  doc.text('BESTUECKUNGSSEITE (BAUTEILSEITE)', marginX, curY + 3.5);
  doc.setDrawColor(26, 106, 171);
  doc.setLineWidth(0.4);
  doc.line(marginX, curY + sectionLabelH, pageW - marginX, curY + sectionLabelH);
  curY += sectionLabelH;

  // Board origin for section 1
  const labelGutterScaled = labelGutter;
  const sec1BoardX = marginX + labelGutterScaled + (drawAreaW - drawW) / 2;
  const sec1BoardY = curY + labelGutterScaled;
  const sec1HoleX = sec1BoardX + boardPadScaled;
  const sec1HoleY = sec1BoardY + boardPadScaled;

  drawBoard(doc, false, sec1BoardX, sec1BoardY, sec1HoleX, sec1HoleY, drawW, drawH, boardPadScaled, scale, euroCols, euroRows, perfboard);
  drawBestueckungsseite(doc, layouts, sec1HoleX, sec1HoleY, scale, euroCols, perfboard);

  curY = sec1BoardY + drawH + labelGutterScaled * 0.3;

  // ============================================================
  // Section 2: Lötseite
  // ============================================================
  curY += sectionGap;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(26, 106, 171);
  doc.text('LOETSEITE (UNTERSEITE - GESPIEGELT)', marginX, curY + 3.5);
  doc.setDrawColor(26, 106, 171);
  doc.setLineWidth(0.4);
  doc.line(marginX, curY + sectionLabelH, pageW - marginX, curY + sectionLabelH);
  curY += sectionLabelH;

  const sec2BoardX = marginX + labelGutterScaled + (drawAreaW - drawW) / 2;
  const sec2BoardY = curY + labelGutterScaled;
  const sec2HoleX = sec2BoardX + boardPadScaled;
  const sec2HoleY = sec2BoardY + boardPadScaled;

  drawBoard(doc, true, sec2BoardX, sec2BoardY, sec2HoleX, sec2HoleY, drawW, drawH, boardPadScaled, scale, euroCols, euroRows, perfboard);
  drawLoetseite(doc, layouts, perfboard, sec2HoleX, sec2HoleY, scale, euroCols);

  // ============================================================
  // Legend & Footer
  // ============================================================
  const footerY = pageH - marginY - footerH;

  // Legend
  const legY = footerY + 2;
  let legX = marginX;
  const legR = 0.8; // symbol radius
  const legGap = 1.5; // gap after symbol before text
  const legItemGap = 6; // gap between legend items

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(100, 100, 100);

  // Item 1: filled dot = Bauteil-Pin
  doc.setFillColor(50, 50, 50);
  doc.setDrawColor(50, 50, 50);
  doc.circle(legX + legR, legY - 0.5, legR, 'F');
  legX += legR * 2 + legGap;
  doc.text('Bauteil-Pin', legX, legY);
  legX += doc.getTextWidth('Bauteil-Pin') + legItemGap;

  // Item 2: circle with slash = Einzelpin / Stiftleiste
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([], 0);
  doc.setDrawColor(50, 50, 50);
  doc.circle(legX + legR, legY - 0.5, legR, 'S');
  const d2 = legR * 0.707;
  doc.line(legX + legR - d2, legY - 0.5 + d2, legX + legR + d2, legY - 0.5 - d2);
  legX += legR * 2 + legGap;
  doc.text('Einzelpin / Stiftleiste', legX, legY);
  legX += doc.getTextWidth('Einzelpin / Stiftleiste') + legItemGap;

  // Item 3: X = Beinchen-Durchstieg (Loetseite)
  doc.setLineWidth(0.2);
  const xc = legX + legR;
  const yc = legY - 0.5;
  doc.line(xc - legR, yc - legR, xc + legR, yc + legR);
  doc.line(xc - legR, yc + legR, xc + legR, yc - legR);
  legX += legR * 2 + legGap;
  doc.text('Beinchen-Durchstieg (Loetseite)', legX, legY);
  legX += doc.getTextWidth('Beinchen-Durchstieg (Loetseite)') + legItemGap;

  // Item 4: line = Verbindung
  doc.setLineWidth(0.3);
  doc.line(legX, legY - 0.5, legX + legR * 3, legY - 0.5);
  legX += legR * 3 + legGap;
  doc.text('Verbindung / Loetzinn', legX, legY);

  // Footer line
  doc.setDrawColor(180, 180, 180);
  doc.setLineWidth(0.3);
  doc.line(marginX, footerY + 3.5, pageW - marginX, footerY + 3.5);

  doc.setFontSize(5.5);
  doc.setTextColor(140, 140, 140);
  doc.text(`Bestueckungsplan - ${projectName}`, marginX, footerY + 6);
  doc.text(`Board: ${perfboard.width}x${perfboard.height} (${perfboard.boardType}) | Eurocard: ${euroCols}x${euroRows}`, pageW / 2, footerY + 6, { align: 'center' });
  doc.text(`Erstellt mit LochCAD - ${dateStr}`, pageW - marginX, footerY + 6, { align: 'right' });

  // Return blob URL + filename for preview; caller decides when to download
  const blob = doc.output('blob');
  const blobUrl = URL.createObjectURL(blob);
  const filename = `${projectName.replace(/[^a-zA-Z0-9_-]/g, '_')}_Bestueckungsplan.pdf`;
  return { blobUrl, filename, blob };
}

// ============================================================
// DIN-style Title Block
// ============================================================
function drawTitleBlock(
  doc: jsPDF,
  x: number,
  y: number,
  w: number,
  projectName: string,
  perfboard: PerfboardDocument,
  dateStr: string,
): number {
  const rowH = 5.5;
  const rows = 3;
  const h = rows * rowH;
  const col1 = w * 0.14; // label width
  const col2 = w * 0.30; // value width
  const col3 = w * 0.14;
  const col4 = w * 0.20;
  const colLogo = w - col1 - col2 - col3 - col4;

  // Outer border
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.6);
  doc.rect(x, y, w, h);

  // Inner grid lines
  doc.setLineWidth(0.25);
  // Horizontal
  for (let i = 1; i < rows; i++) {
    doc.line(x, y + i * rowH, x + col1 + col2 + col3 + col4, y + i * rowH);
  }
  doc.line(x, y + rowH, x + w, y + rowH); // full line after row 1

  // Vertical dividers
  const vLines = [col1, col1 + col2, col1 + col2 + col3, col1 + col2 + col3 + col4];
  for (const vx of vLines) {
    doc.line(x + vx, y, x + vx, y + h);
  }

  // ---- Row 1: Project & Logo ----
  // Label
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('PROJEKT', x + 1.5, y + 3.5);
  // Project name
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(0, 0, 0);
  doc.text(projectName, x + col1 + 2, y + 4);
  // Logo cell (spans all 3 rows)
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11);
  doc.setTextColor(26, 106, 171);
  const logoCX = x + col1 + col2 + col3 + col4 + colLogo / 2;
  doc.text('LochCAD', logoCX, y + h / 2 - 1, { align: 'center' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(5.5);
  doc.setTextColor(120, 120, 120);
  doc.text('EDA - Bestueckungsplan', logoCX, y + h / 2 + 2.5, { align: 'center' });

  // ---- Row 2: Dokumenttyp & Board ----
  const r2y = y + rowH;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('DOKUMENTTYP', x + 1.5, r2y + 3.5);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text('Bestueckungsplan', x + col1 + 2, r2y + 3.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('BOARD', x + col1 + col2 + 1.5, r2y + 3.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(`${perfboard.width}x${perfboard.height} (${perfboard.boardType})`, x + col1 + col2 + col3 + 2, r2y + 3.8);

  // ---- Row 3: Author & Date ----
  const r3y = y + 2 * rowH;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('ERSTELLT VON', x + 1.5, r3y + 3.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text('-', x + col1 + 2, r3y + 3.8);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(6);
  doc.setTextColor(80, 80, 80);
  doc.text('DATUM', x + col1 + col2 + 1.5, r3y + 3.5);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(dateStr, x + col1 + col2 + col3 + 2, r3y + 3.8);

  return h;
}

// ============================================================
// Draw grid, board outline & hole numbers
// ============================================================
function drawBoard(
  doc: jsPDF,
  mirror: boolean,
  boardOriginX: number,
  boardOriginY: number,
  holeOriginX: number,
  holeOriginY: number,
  drawW: number,
  drawH: number,
  boardPadScaled: number,
  scale: number,
  euroCols: number,
  euroRows: number,
  perfboard: PerfboardDocument,
) {
  const actualCols = perfboard.width;
  const actualRows = perfboard.height;
  const actualW = (actualCols - 1) * GRID_SPACING_MM * scale + 2 * boardPadScaled;
  const actualH = (actualRows - 1) * GRID_SPACING_MM * scale + 2 * boardPadScaled;

  // Full Eurocard outline (light gray dashed)
  doc.setDrawColor(190, 190, 190);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([1.5, 0.8], 0);
  doc.rect(boardOriginX, boardOriginY, drawW, drawH);

  // Actual board outline (solid)
  doc.setDrawColor(60, 60, 60);
  doc.setLineWidth(0.35);
  doc.setLineDashPattern([], 0);
  if (mirror) {
    const boardStartX = boardOriginX + drawW - actualW;
    doc.rect(boardStartX, boardOriginY, actualW, actualH);
  } else {
    doc.rect(boardOriginX, boardOriginY, actualW, actualH);
  }

  // Helper
  function gridToDraw(col: number, row: number): { x: number; y: number } {
    const xp = mirror
      ? holeOriginX + (euroCols - 1 - col) * GRID_SPACING_MM * scale
      : holeOriginX + col * GRID_SPACING_MM * scale;
    const yp = holeOriginY + row * GRID_SPACING_MM * scale;
    return { x: xp, y: yp };
  }

  // Draw grid holes
  const holeR = Math.max(0.2, 0.25 * scale);
  doc.setDrawColor(175, 175, 175);
  doc.setLineWidth(0.1);
  for (let r = 0; r < actualRows; r++) {
    for (let c = 0; c < actualCols; c++) {
      const p = gridToDraw(c, r);
      doc.circle(p.x, p.y, holeR, 'S');
    }
  }

  // ---- Hole number labels every 5 holes ----
  const numFS = Math.max(3.5, Math.min(5, GRID_SPACING_MM * scale * 1.3));
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(numFS);
  doc.setTextColor(130, 130, 130);

  // Column numbers along the top
  for (let c = 0; c < actualCols; c++) {
    if ((c + 1) % 5 !== 0 && c !== 0) continue;
    const p = gridToDraw(c, 0);
    doc.text(String(c + 1), p.x, boardOriginY - boardPadScaled + 0.3, { align: 'center' });
  }

  // Row numbers along the left
  for (let r = 0; r < actualRows; r++) {
    if ((r + 1) % 5 !== 0 && r !== 0) continue;
    const p = mirror ? gridToDraw(actualCols - 1, r) : gridToDraw(0, r);
    const labelX = p.x - boardPadScaled - 0.8;
    doc.text(String(r + 1), labelX, p.y + numFS * 0.15, { align: 'right' });
  }
}

// ============================================================
// Bestückungsseite rendering
// ============================================================
function drawBestueckungsseite(
  doc: jsPDF,
  layouts: ComponentLayoutInfo[],
  holeOriginX: number,
  holeOriginY: number,
  scale: number,
  euroCols: number,
  perfboard: PerfboardDocument,
) {
  function gridToDraw(col: number, row: number): { x: number; y: number } {
    return {
      x: holeOriginX + col * GRID_SPACING_MM * scale,
      y: holeOriginY + row * GRID_SPACING_MM * scale,
    };
  }

  for (const layout of layouts) {
    const { comp, def, pads } = layout;

    // Body rectangle
    if (pads.length > 1) {
      const minP = gridToDraw(layout.bodyMin.col, layout.bodyMin.row);
      const maxP = gridToDraw(layout.bodyMax.col, layout.bodyMax.row);
      const pad = 0.5 * scale;
      const bx = Math.min(minP.x, maxP.x) - pad;
      const by = Math.min(minP.y, maxP.y) - pad;
      const bw = Math.abs(maxP.x - minP.x) + 2 * pad;
      const bh = Math.abs(maxP.y - minP.y) + 2 * pad;

      doc.setDrawColor(50, 50, 50);
      doc.setLineWidth(0.2);
      doc.setLineDashPattern([], 0);
      doc.rect(bx, by, bw, bh, 'S');

      // Reference centered
      const refFS = Math.max(3, Math.min(5, bw * 0.45));
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(refFS);
      doc.setTextColor(20, 20, 20);
      const textX = bx + bw / 2;
      const textY = by + bh / 2;
      doc.text(comp.reference, textX, textY + refFS * 0.15, { align: 'center' });
    }

    // Pads
    for (const p of pads) {
      const pos = gridToDraw(p.abs.col, p.abs.row);
      if (pads.length === 1) {
        drawPinSymbol(doc, pos.x, pos.y, 0.75 * scale);
        doc.setFont('helvetica', 'bold');
        doc.setFontSize(3.5);
        doc.setTextColor(30, 30, 30);
        doc.text(comp.reference, pos.x, pos.y - 1.2 * scale, { align: 'center' });
      } else {
        const dotR = 0.45 * scale;
        doc.setDrawColor(50, 50, 50);
        doc.setFillColor(50, 50, 50);
        doc.circle(pos.x, pos.y, dotR, 'F');
      }
    }

    // Connector / pin header — ⌀ overlay
    if (pads.length > 1 && isConnectorOrPinHeader(def)) {
      for (const p of pads) {
        const pos = gridToDraw(p.abs.col, p.abs.row);
        drawPinSymbol(doc, pos.x, pos.y, 0.6 * scale);
      }
    }
  }
}

// ============================================================
// Lötseite rendering
// ============================================================
function drawLoetseite(
  doc: jsPDF,
  layouts: ComponentLayoutInfo[],
  perfboard: PerfboardDocument,
  holeOriginX: number,
  holeOriginY: number,
  scale: number,
  euroCols: number,
) {
  function gridToDraw(col: number, row: number): { x: number; y: number } {
    return {
      x: holeOriginX + (euroCols - 1 - col) * GRID_SPACING_MM * scale,
      y: holeOriginY + row * GRID_SPACING_MM * scale,
    };
  }

  // X marks at pin positions
  for (const layout of layouts) {
    for (const p of layout.pads) {
      const pos = gridToDraw(p.abs.col, p.abs.row);
      drawXMark(doc, pos.x, pos.y, 0.45 * scale);
    }
  }

  // Connections
  for (const conn of perfboard.connections) {
    const points: GridPosition[] = [conn.from, ...(conn.waypoints || []), conn.to];

    if (conn.type === 'wire_bridge') {
      doc.setDrawColor(160, 160, 160);
      doc.setLineWidth(0.12);
      doc.setLineDashPattern([0.8, 0.4], 0);
    } else if (conn.type === 'solder_bridge') {
      doc.setDrawColor(40, 40, 40);
      doc.setLineWidth(0.4);
      doc.setLineDashPattern([], 0);
    } else {
      doc.setDrawColor(40, 40, 40);
      doc.setLineWidth(0.3);
      doc.setLineDashPattern([], 0);
    }

    for (let i = 0; i < points.length - 1; i++) {
      const from = gridToDraw(points[i].col, points[i].row);
      const to = gridToDraw(points[i + 1].col, points[i + 1].row);
      doc.line(from.x, from.y, to.x, to.y);
    }

    if (conn.type === 'wire' || conn.type === 'solder_bridge') {
      doc.setFillColor(40, 40, 40);
      const fromP = gridToDraw(conn.from.col, conn.from.row);
      const toP = gridToDraw(conn.to.col, conn.to.row);
      const dotR = 0.35 * scale;
      doc.circle(fromP.x, fromP.y, dotR, 'F');
      doc.circle(toP.x, toP.y, dotR, 'F');
    }
  }
}

// ============================================================
// Symbol helpers
// ============================================================

/** Draw ⌀ symbol — circle with diagonal slash */
function drawPinSymbol(doc: jsPDF, cx: number, cy: number, r: number) {
  doc.setDrawColor(40, 40, 40);
  doc.setLineWidth(0.15);
  doc.setLineDashPattern([], 0);
  doc.circle(cx, cy, r, 'S');
  const d = r * 0.707;
  doc.line(cx - d, cy + d, cx + d, cy - d);
}

/** Draw X mark at position */
function drawXMark(doc: jsPDF, cx: number, cy: number, r: number) {
  doc.setDrawColor(50, 50, 50);
  doc.setLineWidth(0.2);
  doc.setLineDashPattern([], 0);
  doc.line(cx - r, cy - r, cx + r, cy + r);
  doc.line(cx - r, cy + r, cx + r, cy - r);
}

/** Check if component is a connector / pin header */
function isConnectorOrPinHeader(def: ComponentDefinition): boolean {
  const cat = def.category?.toLowerCase() || '';
  const name = def.name?.toLowerCase() || '';
  return (
    cat === 'connectors' ||
    name.includes('pin header') ||
    name.includes('stiftleist') ||
    name.includes('buchsenleist') ||
    name.includes('connector') ||
    name.includes('terminal')
  );
}
