import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  LoadingBlock,
  Stat,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatNumber, formatUsd } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Settings.module.css';

interface UsageSummary {
  provider: string;
  model: string;
  enabled: boolean;
  dailyBudgetUsd: number;
  pricing: { inputPerMTok: number; outputPerMTok: number; configured: boolean };
  allTime: { requests: number; promptTokens: number; completionTokens: number; costUsd: number };
  today: { requests: number; promptTokens: number; completionTokens: number; costUsd: number };
  byKind: { kind: string; requests: number; costUsd: number }[];
}

export function UsagePage() {
  const capabilities = useCapabilitiesStore((s) => s.data);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        setUsage(await api.get<UsageSummary>('/api/ai/usage'));
      } catch (err) {
        setError(err instanceof ApiError ? err.message : 'Could not load copilot usage.');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <LoadingBlock label="Loading usage" />;

  if (error || !usage) {
    return (
      <>
        <PageHeader title="Copilot usage" />
        <Callout tone="danger" title="Could not load usage">
          {error ?? 'No data.'}
        </Callout>
      </>
    );
  }

  const budgetUsed =
    usage.dailyBudgetUsd > 0 ? Math.min(100, (usage.today.costUsd / usage.dailyBudgetUsd) * 100) : 0;

  return (
    <>
      <PageHeader
        title="Copilot usage"
        description="Token counts and cost for every copilot request made in this organization. Recorded per request at the time it was made."
      />

      {!usage.enabled && (
        <Callout tone="warning" title="Copilot is disabled">
          {capabilities?.ai.disabledReason ??
            'AI_PROVIDER is set to "disabled". Requests return a configuration notice instead of model output.'}{' '}
          Historical usage below is still shown.
        </Callout>
      )}

      {usage.enabled && !usage.pricing.configured && (
        <Callout tone="info" title="Pricing is not configured">
          Token counts are real, but cost shows as $0.00 because{' '}
          <code>AI_PRICE_INPUT_PER_MTOK</code> and <code>AI_PRICE_OUTPUT_PER_MTOK</code> are unset.
          Set them to your provider&apos;s rates to track spend.
        </Callout>
      )}

      <div className={styles.statGrid} style={{ marginTop: 'var(--space-5)' }}>
        <Stat
          label="Requests today"
          value={formatNumber(usage.today.requests)}
          hint={`${formatNumber(usage.allTime.requests)} all time`}
        />
        <Stat
          label="Cost today"
          value={formatUsd(usage.today.costUsd)}
          hint={
            usage.dailyBudgetUsd > 0
              ? `${budgetUsed.toFixed(0)}% of the ${formatUsd(usage.dailyBudgetUsd)} daily cap`
              : 'no daily cap set'
          }
        />
        <Stat
          label="Input tokens"
          value={formatNumber(usage.allTime.promptTokens)}
          hint={`${formatNumber(usage.today.promptTokens)} today`}
        />
        <Stat
          label="Output tokens"
          value={formatNumber(usage.allTime.completionTokens)}
          hint={`${formatNumber(usage.today.completionTokens)} today`}
        />
        <Stat
          label="Cost all time"
          value={formatUsd(usage.allTime.costUsd)}
          hint={usage.pricing.configured ? 'from configured rates' : 'rates not configured'}
        />
      </div>

      <div className={styles.sections}>
        <Card>
          <CardHeader
            title="Configuration"
            subtitle="Read from the API's environment at boot"
          />
          <div className={styles.kindList}>
            <div className={styles.kindRow}>
              <span>Provider</span>
              <span className={styles.kindNumbers}>
                <Badge tone={usage.enabled ? 'success' : 'warning'}>{usage.provider}</Badge>
              </span>
            </div>
            <div className={styles.kindRow}>
              <span>Model</span>
              <span className={[styles.kindNumbers, styles.mono].join(' ')}>{usage.model}</span>
            </div>
            <div className={styles.kindRow}>
              <span>Input price</span>
              <span className={styles.kindNumbers}>
                {usage.pricing.inputPerMTok > 0
                  ? `$${usage.pricing.inputPerMTok} / 1M tokens`
                  : 'not set'}
              </span>
            </div>
            <div className={styles.kindRow}>
              <span>Output price</span>
              <span className={styles.kindNumbers}>
                {usage.pricing.outputPerMTok > 0
                  ? `$${usage.pricing.outputPerMTok} / 1M tokens`
                  : 'not set'}
              </span>
            </div>
            <div className={styles.kindRow}>
              <span>Daily budget</span>
              <span className={styles.kindNumbers}>
                {usage.dailyBudgetUsd > 0 ? formatUsd(usage.dailyBudgetUsd) : 'unlimited'}
              </span>
            </div>
          </div>
        </Card>

        <Card>
          <CardHeader title="By request type" subtitle="All time" />
          {usage.byKind.length > 0 ? (
            <div className={styles.kindList}>
              {[...usage.byKind]
                .sort((a, b) => b.requests - a.requests)
                .map((entry) => (
                  <div key={entry.kind} className={styles.kindRow}>
                    <span>{capabilities?.aiSuggestionKinds[entry.kind as never] ?? entry.kind}</span>
                    <span className={styles.kindNumbers}>
                      <span>{formatNumber(entry.requests)} requests</span>
                      <span>{formatUsd(entry.costUsd)}</span>
                    </span>
                  </div>
                ))}
            </div>
          ) : (
            <EmptyState
              icon="◴"
              title="No copilot requests yet"
              body="Usage appears here once an interviewer asks the copilot something during a session."
            />
          )}
        </Card>
      </div>
    </>
  );
}
