import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useState } from 'react';
import { PageHeader } from '../../components/layout/PageHeader';
import { Badge, Callout, Card, CardHeader, EmptyState, LoadingBlock, Stat, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatNumber, formatUsd } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Settings.module.css';
export function UsagePage() {
    const capabilities = useCapabilitiesStore((s) => s.data);
    const [usage, setUsage] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    useEffect(() => {
        (async () => {
            try {
                setUsage(await api.get('/api/ai/usage'));
            }
            catch (err) {
                setError(err instanceof ApiError ? err.message : 'Could not load copilot usage.');
            }
            finally {
                setLoading(false);
            }
        })();
    }, []);
    if (loading)
        return _jsx(LoadingBlock, { label: "Loading usage" });
    if (error || !usage) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Copilot usage" }), _jsx(Callout, { tone: "danger", title: "Could not load usage", children: error ?? 'No data.' })] }));
    }
    const budgetUsed = usage.dailyBudgetUsd > 0 ? Math.min(100, (usage.today.costUsd / usage.dailyBudgetUsd) * 100) : 0;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Copilot usage", description: "Token counts and cost for every copilot request made in this organization. Recorded per request at the time it was made." }), !usage.enabled && (_jsxs(Callout, { tone: "warning", title: "Copilot is disabled", children: [capabilities?.ai.disabledReason ??
                        'AI_PROVIDER is set to "disabled". Requests return a configuration notice instead of model output.', ' ', "Historical usage below is still shown."] })), usage.enabled && !usage.pricing.configured && (_jsxs(Callout, { tone: "info", title: "Pricing is not configured", children: ["Token counts are real, but cost shows as $0.00 because", ' ', _jsx("code", { children: "AI_PRICE_INPUT_PER_MTOK" }), " and ", _jsx("code", { children: "AI_PRICE_OUTPUT_PER_MTOK" }), " are unset. Set them to your provider's rates to track spend."] })), _jsxs("div", { className: styles.statGrid, style: { marginTop: 'var(--space-5)' }, children: [_jsx(Stat, { label: "Requests today", value: formatNumber(usage.today.requests), hint: `${formatNumber(usage.allTime.requests)} all time` }), _jsx(Stat, { label: "Cost today", value: formatUsd(usage.today.costUsd), hint: usage.dailyBudgetUsd > 0
                            ? `${budgetUsed.toFixed(0)}% of the ${formatUsd(usage.dailyBudgetUsd)} daily cap`
                            : 'no daily cap set' }), _jsx(Stat, { label: "Input tokens", value: formatNumber(usage.allTime.promptTokens), hint: `${formatNumber(usage.today.promptTokens)} today` }), _jsx(Stat, { label: "Output tokens", value: formatNumber(usage.allTime.completionTokens), hint: `${formatNumber(usage.today.completionTokens)} today` }), _jsx(Stat, { label: "Cost all time", value: formatUsd(usage.allTime.costUsd), hint: usage.pricing.configured ? 'from configured rates' : 'rates not configured' })] }), _jsxs("div", { className: styles.sections, children: [_jsxs(Card, { children: [_jsx(CardHeader, { title: "Configuration", subtitle: "Read from the API's environment at boot" }), _jsxs("div", { className: styles.kindList, children: [_jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: "Provider" }), _jsx("span", { className: styles.kindNumbers, children: _jsx(Badge, { tone: usage.enabled ? 'success' : 'warning', children: usage.provider }) })] }), _jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: "Model" }), _jsx("span", { className: [styles.kindNumbers, styles.mono].join(' '), children: usage.model })] }), _jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: "Input price" }), _jsx("span", { className: styles.kindNumbers, children: usage.pricing.inputPerMTok > 0
                                                    ? `$${usage.pricing.inputPerMTok} / 1M tokens`
                                                    : 'not set' })] }), _jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: "Output price" }), _jsx("span", { className: styles.kindNumbers, children: usage.pricing.outputPerMTok > 0
                                                    ? `$${usage.pricing.outputPerMTok} / 1M tokens`
                                                    : 'not set' })] }), _jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: "Daily budget" }), _jsx("span", { className: styles.kindNumbers, children: usage.dailyBudgetUsd > 0 ? formatUsd(usage.dailyBudgetUsd) : 'unlimited' })] })] })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "By request type", subtitle: "All time" }), usage.byKind.length > 0 ? (_jsx("div", { className: styles.kindList, children: [...usage.byKind]
                                    .sort((a, b) => b.requests - a.requests)
                                    .map((entry) => (_jsxs("div", { className: styles.kindRow, children: [_jsx("span", { children: capabilities?.aiSuggestionKinds[entry.kind] ?? entry.kind }), _jsxs("span", { className: styles.kindNumbers, children: [_jsxs("span", { children: [formatNumber(entry.requests), " requests"] }), _jsx("span", { children: formatUsd(entry.costUsd) })] })] }, entry.kind))) })) : (_jsx(EmptyState, { icon: "\u25F4", title: "No copilot requests yet", body: "Usage appears here once an interviewer asks the copilot something during a session." }))] })] })] }));
}
