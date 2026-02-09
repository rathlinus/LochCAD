// ============================================================
// Symbol Renderer — Draws component symbols on Konva canvas
// ============================================================

import React, { useMemo } from 'react';
import { Group, Rect, Line, Circle, Arc, Text, Ellipse } from 'react-konva';
import type { ComponentSymbol, SymbolGraphic, PinDefinition, Point } from '@/types';
import { COLORS, PIN_TYPE_COLORS, SCHEMATIC_GRID } from '@/constants';

/** Compute the bounding box of a symbol from its graphics and pins */
function getSymbolBounds(symbol: ComponentSymbol): { x: number; y: number; width: number; height: number } {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const expand = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  // Include pin connection points and body-side endpoints
  for (const pin of symbol.pins) {
    expand(pin.position.x, pin.position.y);
    const angle = (pin.direction * Math.PI) / 180;
    expand(
      pin.position.x + Math.cos(angle) * pin.length,
      pin.position.y + Math.sin(angle) * pin.length,
    );
  }
  // Include graphics extents
  for (const g of symbol.graphics) {
    switch (g.type) {
      case 'line':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'rectangle':
        expand(g.start.x, g.start.y);
        expand(g.end.x, g.end.y);
        break;
      case 'circle':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
      case 'arc':
        expand(g.center.x - g.radius, g.center.y - g.radius);
        expand(g.center.x + g.radius, g.center.y + g.radius);
        break;
      case 'polyline':
        for (const p of g.points) expand(p.x, p.y);
        break;
    }
  }
  // Fallback if empty
  if (minX > maxX) { minX = -45; maxX = 45; minY = -45; maxY = 45; }
  const pad = 5;
  return { x: minX - pad, y: minY - pad, width: maxX - minX + 2 * pad, height: maxY - minY + 2 * pad };
}

interface SymbolRendererProps {
  symbol: ComponentSymbol;
  x: number;
  y: number;
  rotation?: number;
  mirror?: boolean;
  reference?: string;
  value?: string;
  isSelected?: boolean;
  isHovered?: boolean;
  isDimmed?: boolean;
  onClick?: (e: any) => void;
  onDblClick?: () => void;
  onDragStart?: () => void;
  onDragMove?: () => void;
  onDragEnd?: (x: number, y: number) => boolean | void;
  draggable?: boolean;
  showPinNames?: boolean;
  showPinNumbers?: boolean;
}

export const SymbolRenderer: React.FC<SymbolRendererProps> = React.memo(({
  symbol,
  x,
  y,
  rotation = 0,
  mirror = false,
  reference,
  value,
  isSelected = false,
  isHovered = false,
  isDimmed = false,
  onClick,
  onDblClick,
  onDragStart,
  onDragMove,
  onDragEnd,
  draggable = false,
  showPinNames = true,
  showPinNumbers = false,
}) => {
  const opacity = isDimmed ? 0.3 : 1;
  const highlightColor = isSelected ? COLORS.selected : isHovered ? COLORS.hover : null;

  const handleDragEnd = (e: any) => {
    e.cancelBubble = true;
    const gridX = Math.round(e.target.x() / SCHEMATIC_GRID) * SCHEMATIC_GRID;
    const gridY = Math.round(e.target.y() / SCHEMATIC_GRID) * SCHEMATIC_GRID;
    const accepted = onDragEnd?.(gridX, gridY);
    if (accepted === false) {
      // Collision — snap back to original position from props
      e.target.x(x);
      e.target.y(y);
    } else {
      e.target.x(gridX);
      e.target.y(gridY);
    }
  };

  const bounds = useMemo(() => getSymbolBounds(symbol), [symbol]);

  return (
    <Group
      x={x}
      y={y}
      rotation={rotation}
      scaleX={mirror ? -1 : 1}
      opacity={opacity}
      draggable={draggable}
      onClick={onClick}
      onDblClick={onDblClick}
      onDragStart={(e: any) => { e.cancelBubble = true; onDragStart?.(); }}
      onDragMove={(e: any) => { e.cancelBubble = true; onDragMove?.(); }}
      onDragEnd={handleDragEnd}
    >
      {/* Invisible hit-area covering the full bounding box so every
          component is easy to click/drag regardless of shape geometry */}
      <Rect
        x={bounds.x}
        y={bounds.y}
        width={bounds.width}
        height={bounds.height}
        fill="transparent"
        hitFunc={(context: any, shape: any) => {
          context.beginPath();
          context.rect(0, 0, shape.width(), shape.height());
          context.closePath();
          context.fillStrokeShape(shape);
        }}
      />

      {/* Selection highlight */}
      {isSelected && (
        <Rect
          x={bounds.x}
          y={bounds.y}
          width={bounds.width}
          height={bounds.height}
          fill={COLORS.selectedFill}
          stroke={COLORS.selected}
          strokeWidth={1}
          dash={[4, 4]}
          cornerRadius={4}
          listening={false}
        />
      )}

      {/* Graphics */}
      {symbol.graphics.map((g, i) => (
        <GraphicRenderer key={i} graphic={g} highlight={highlightColor} />
      ))}

      {/* Pins */}
      {symbol.pins.map((pin, i) => (
        <PinRenderer
          key={i}
          pin={pin}
          showName={showPinNames}
          showNumber={showPinNumbers}
          highlight={highlightColor}
        />
      ))}

      {/* Reference (e.g. R1) */}
      {reference && (
        <Text
          text={reference}
          x={0}
          y={-35}
          fontSize={11}
          fontFamily="JetBrains Mono, monospace"
          fill={highlightColor ?? COLORS.componentRef}
          align="center"
          offsetX={0}
          rotation={mirror ? 0 : 0}
          scaleX={mirror ? -1 : 1}
        />
      )}

      {/* Value (e.g. 10kΩ) */}
      {value && (
        <Text
          text={value}
          x={0}
          y={25}
          fontSize={10}
          fontFamily="JetBrains Mono, monospace"
          fill={COLORS.componentValue}
          align="center"
          offsetX={0}
          scaleX={mirror ? -1 : 1}
        />
      )}
    </Group>
  );
});

SymbolRenderer.displayName = 'SymbolRenderer';

// ---- Graphic Renderer ----

const GraphicRenderer: React.FC<{ graphic: SymbolGraphic; highlight: string | null }> = ({ graphic, highlight }) => {
  const stroke = highlight ?? graphic.stroke ?? COLORS.componentBody;
  const strokeWidth = graphic.strokeWidth ?? 2;
  const fill = graphic.fill ?? 'transparent';

  switch (graphic.type) {
    case 'line':
      return (
        <Line
          points={[graphic.start.x, graphic.start.y, graphic.end.x, graphic.end.y]}
          stroke={stroke}
          strokeWidth={strokeWidth}
          lineCap="round"
        />
      );

    case 'rectangle':
      return (
        <Rect
          x={graphic.start.x}
          y={graphic.start.y}
          width={graphic.end.x - graphic.start.x}
          height={graphic.end.y - graphic.start.y}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={fill === 'none' ? COLORS.componentBodyFill : fill}
          cornerRadius={1}
        />
      );

    case 'circle':
      return (
        <Circle
          x={graphic.center.x}
          y={graphic.center.y}
          radius={graphic.radius}
          stroke={stroke}
          strokeWidth={strokeWidth}
          fill={fill === 'none' ? 'transparent' : fill}
        />
      );

    case 'arc':
      return (
        <Arc
          x={graphic.center.x}
          y={graphic.center.y}
          innerRadius={graphic.radius}
          outerRadius={graphic.radius}
          angle={graphic.endAngle - graphic.startAngle}
          rotation={graphic.startAngle}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );

    case 'polyline': {
      const pts = graphic.points.flatMap((p) => [p.x, p.y]);
      return (
        <Line
          points={pts}
          stroke={stroke}
          strokeWidth={strokeWidth}
          closed={graphic.closed ?? false}
          fill={graphic.closed ? (fill === 'none' ? COLORS.componentBodyFill : fill) : undefined}
          lineCap="round"
          lineJoin="round"
        />
      );
    }

    case 'text':
      return (
        <Text
          x={graphic.position.x}
          y={graphic.position.y}
          text={graphic.text}
          fontSize={graphic.fontSize ?? 10}
          fontFamily="JetBrains Mono, monospace"
          fill={stroke}
          align={graphic.anchor ?? 'start'}
        />
      );

    default:
      return null;
  }
};

// ---- Pin Renderer ----

const PinRenderer: React.FC<{
  pin: PinDefinition;
  showName: boolean;
  showNumber: boolean;
  highlight: string | null;
}> = ({ pin, showName, showNumber, highlight }) => {
  const pinColor = highlight ?? PIN_TYPE_COLORS[pin.electricalType] ?? COLORS.componentPin;

  // Calculate pin line endpoint
  const angle = (pin.direction * Math.PI) / 180;
  const endX = pin.position.x + Math.cos(angle) * pin.length;
  const endY = pin.position.y + Math.sin(angle) * pin.length;

  return (
    <Group>
      {/* Pin line */}
      <Line
        points={[pin.position.x, pin.position.y, endX, endY]}
        stroke={pinColor}
        strokeWidth={1.5}
        lineCap="round"
      />
      {/* Pin circle (connection point) */}
      <Circle
        x={pin.position.x}
        y={pin.position.y}
        radius={3}
        fill={pinColor}
        stroke={pinColor}
        strokeWidth={1}
      />
      {/* Pin name */}
      {showName && pin.name && !pin.hidden && (
        <Text
          x={endX + (pin.direction === 0 ? 4 : pin.direction === 180 ? -4 : 0)}
          y={endY + (pin.direction === 90 ? 4 : pin.direction === 270 ? -14 : -5)}
          text={pin.name}
          fontSize={8}
          fontFamily="JetBrains Mono, monospace"
          fill="#aaaaaa"
          align={pin.direction === 180 ? 'right' : 'left'}
        />
      )}
    </Group>
  );
};
