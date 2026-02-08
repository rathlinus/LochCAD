// ============================================================
// Engine barrel export
// ============================================================

export { buildNetlist } from './netlist';
export { runERC } from './erc';
export type { ERCResult, ERCSeverity } from './erc';
export { runDRC } from './drc';
export type { DRCResult } from './drc';
export { findManhattanRoute, getOccupiedHoles, hasCollision, gridKey, hasFootprintCollision, getFootprintBBox, gridBBoxOverlap, rotatePad, isAdjacent, insertSupportPoints, getLötpunkte, SUPPORT_INTERVAL } from './router';
export type { GridBBox } from './router';
export { routeSchematicWire, getComponentBBox, getComponentBodyBBox, bboxOverlap, buildOccupiedEdges, addWireEdges, wirePassesThroughBBox, findSameNetWireIds, buildRoutingContext, getWireEdgeSet } from './schematic-router';
export type { BBox } from './schematic-router';
