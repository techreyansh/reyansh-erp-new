/**
 * Dashboard component kit — shared building blocks for every ERP dashboard.
 *
 * Usage:
 *   import { StatCard, Panel, AttentionCard, EmptyChart, GridBox,
 *            inrCompact, pct, greeting, CHART_COLORS, SEMANTIC,
 *            sortBySeverity } from '../common/kit';
 */
export { default as StatCard } from './StatCard';
export { default as Panel } from './Panel';
export { default as AttentionCard, SEVERITY, sortBySeverity } from './AttentionCard';
export { default as EmptyChart } from './EmptyChart';
export { default as GridBox } from './GridBox';
export {
  CHART_COLORS,
  SEMANTIC,
  inrCompact,
  inrFull,
  pct,
  greeting,
  statusChipColor,
} from './format';
