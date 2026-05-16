import type { FeatureGateResult } from '../lib/subscription';

export function UpgradePromptModal({ onClose }: { gate: FeatureGateResult | null; open: boolean; onClose: () => void }) {
  onClose;
  return null;
}

export function UpgradeInlineCard({ gate }: { gate: FeatureGateResult; compact?: boolean }) {
  gate;
  return null;
}
