import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Callout, EmptyState, Spinner } from '../../components/ui/Primitives';
import { api, ApiError, streamSse } from '../../lib/api';
import { formatMs, formatRelative, formatUsd } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Workspace.module.css';
/** The actions offered in the panel, in the order an interviewer tends to need them. */
const ACTIONS = [
    { kind: 'EDGE_CASES', label: 'Edge cases', blurb: 'What this code misses' },
    { kind: 'FOLLOW_UP_QUESTIONS', label: 'Follow-ups', blurb: 'Questions on what they wrote' },
    { kind: 'INTERVIEWER_HINT', label: 'Graduated hints', blurb: 'If they are stuck' },
    { kind: 'EXPLAIN_TEST_FAILURE', label: 'Explain failure', blurb: 'Why a test failed' },
    { kind: 'APPROACH_SUMMARY', label: 'Approach', blurb: 'Summarise the solution' },
    { kind: 'REASONING_GAPS', label: 'Reasoning gaps', blurb: 'Unexamined assumptions' },
    { kind: 'DIFFICULTY_CALIBRATION', label: 'Calibrate', blurb: 'Raise or lower difficulty' },
    { kind: 'STRUCTURED_NOTES', label: 'Draft notes', blurb: 'Notes you can edit' },
];
export function CopilotPanel({ interviewId, activeQuestionId, code, latestExecutionJobId, onUseAsNote, }) {
    const capabilities = useCapabilitiesStore((s) => s.data);
    const [suggestions, setSuggestions] = useState([]);
    const [loading, setLoading] = useState(true);
    const [pendingKind, setPendingKind] = useState(null);
    const [streamText, setStreamText] = useState('');
    const [unavailable, setUnavailable] = useState(null);
    const abortRef = useRef(null);
    const aiEnabled = capabilities?.ai.enabled ?? false;
    useEffect(() => {
        let cancelled = false;
        (async () => {
            try {
                const data = await api.get(`/api/ai/interviews/${interviewId}/suggestions`);
                if (!cancelled)
                    setSuggestions(data.items);
            }
            catch {
                /* an empty history is not an error worth shouting about */
            }
            finally {
                if (!cancelled)
                    setLoading(false);
            }
        })();
        return () => {
            cancelled = true;
        };
    }, [interviewId]);
    useEffect(() => () => abortRef.current?.abort(), []);
    const request = useCallback(async (kind) => {
        if (pendingKind)
            return;
        setPendingKind(kind);
        setStreamText('');
        setUnavailable(null);
        const controller = new AbortController();
        abortRef.current = controller;
        const body = {
            kind,
            ...(activeQuestionId ? { questionId: activeQuestionId } : {}),
            code,
            ...(kind === 'EXPLAIN_TEST_FAILURE' && latestExecutionJobId
                ? { executionJobId: latestExecutionJobId }
                : {}),
            stream: true,
        };
        try {
            let settled = false;
            await streamSse(`/api/ai/interviews/${interviewId}/suggestions/stream`, body, {
                signal: controller.signal,
                onEvent: (event, data) => {
                    if (event === 'delta') {
                        setStreamText((prev) => prev + (data.delta ?? ''));
                    }
                    else if (event === 'result') {
                        settled = true;
                        const record = data;
                        setSuggestions((prev) => [record, ...prev]);
                        setStreamText('');
                    }
                    else if (event === 'error') {
                        settled = true;
                        setUnavailable(data);
                        setStreamText('');
                    }
                },
            });
            if (!settled) {
                setUnavailable({
                    available: false,
                    reason: 'incomplete',
                    message: 'The copilot stream ended before a complete response arrived. Try again.',
                });
            }
        }
        catch (err) {
            if (controller.signal.aborted)
                return;
            setUnavailable({
                available: false,
                reason: 'request_failed',
                message: err instanceof ApiError
                    ? err.message
                    : 'Could not reach the copilot endpoint. Check that the API is running.',
            });
        }
        finally {
            setPendingKind(null);
            abortRef.current = null;
        }
    }, [pendingKind, activeQuestionId, code, latestExecutionJobId, interviewId]);
    const copyNotes = (record) => {
        const lines = [record.payload.headline, ''];
        if (record.payload.observations.length) {
            lines.push('Observed:');
            lines.push(...record.payload.observations.map((o) => `- ${o}`));
            lines.push('');
        }
        if (record.payload.suggestions.length) {
            lines.push('Discussed / to discuss:');
            lines.push(...record.payload.suggestions.map((s) => `- ${s.title}: ${s.detail}`));
        }
        onUseAsNote(lines.join('\n').trim());
        toast.info('Copied into the notes box', 'Edit it before saving — it is a draft, not a record.');
    };
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.panelHeader, children: [_jsx("span", { className: styles.panelTitle, children: "Interviewer copilot" }), aiEnabled ? (_jsx(Badge, { tone: "neutral", children: capabilities?.ai.model ?? '' })) : (_jsx(Badge, { tone: "warning", children: "disabled" }))] }), _jsx("div", { className: styles.guardrail, children: capabilities?.ai.guardrailNotice ??
                    'Copilot output is a drafting aid for the interviewer. It does not score candidates and does not make hiring decisions.' }), !aiEnabled ? (_jsx("div", { className: styles.panelScroll, children: _jsx("div", { style: { padding: 'var(--space-3)' }, children: _jsxs(Callout, { tone: "warning", title: "Copilot is not configured", children: [capabilities?.ai.disabledReason ??
                                'Set AI_PROVIDER and AI_API_KEY in the environment to enable it.', ' ', "No suggestions are generated locally \u2014 the panel stays empty rather than showing invented output."] }) }) })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.copilotActions, children: ACTIONS.map((action) => (_jsxs("button", { type: "button", className: styles.copilotButton, onClick: () => void request(action.kind), disabled: pendingKind !== null ||
                                (action.kind === 'EXPLAIN_TEST_FAILURE' && !latestExecutionJobId), title: action.kind === 'EXPLAIN_TEST_FAILURE' && !latestExecutionJobId
                                ? 'Run the code first so there is a failure to explain'
                                : action.blurb, children: [_jsx("strong", { style: { display: 'block', color: 'var(--text-primary)' }, children: pendingKind === action.kind ? '…' : action.label }), action.blurb] }, action.kind))) }), pendingKind && streamText && (_jsx("div", { className: styles.streamBox, "aria-live": "polite", children: streamText })), pendingKind && !streamText && (_jsxs("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            padding: 'var(--space-3)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--text-tertiary)',
                            borderBottom: '1px solid var(--border-subtle)',
                        }, children: [_jsx(Spinner, { size: 12 }), " Asking the model\u2026"] })), _jsxs("div", { className: styles.panelScroll, children: [unavailable && (_jsx("div", { style: { padding: 'var(--space-3)' }, children: _jsx(Callout, { tone: "danger", title: "Copilot unavailable", children: unavailable.message }) })), loading ? (_jsx("div", { style: { padding: 'var(--space-4)' }, children: _jsx(Spinner, { size: 16 }) })) : suggestions.length === 0 && !unavailable ? (_jsx(EmptyState, { icon: "\u25C6", title: "No suggestions yet", body: "Pick an action above. Everything the copilot returns is split into what it could observe in the code and what it is only inferring." })) : (suggestions.map((record) => (_jsxs("article", { className: styles.suggestion, children: [_jsxs("header", { className: styles.suggestionHeader, children: [_jsx("span", { className: styles.suggestionKind, children: capabilities?.aiSuggestionKinds[record.kind] ?? record.kind }), record.degraded && _jsx(Badge, { tone: "warning", children: "unstructured" }), _jsx("span", { className: styles.suggestionTime, children: formatRelative(record.createdAt) })] }), _jsx("p", { className: styles.suggestionHeadline, children: record.payload.headline }), record.degradedReason && (_jsx("div", { style: { marginBottom: 'var(--space-3)' }, children: _jsx(Callout, { tone: "warning", children: record.degradedReason }) })), record.payload.observations.length > 0 && (_jsxs("div", { className: styles.group, children: [_jsxs("div", { className: [styles.groupLabel, styles.labelObserved].join(' '), children: ["Observed", _jsx("span", { className: styles.groupHint, children: "visible in the code or results" })] }), _jsx("ul", { className: styles.itemList, children: record.payload.observations.map((item, index) => (_jsxs("li", { className: styles.item, children: [_jsx("span", { className: styles.itemMark, "aria-hidden": "true", children: "\u00B7" }), item] }, index))) })] })), record.payload.assumptions.length > 0 && (_jsxs("div", { className: styles.group, children: [_jsxs("div", { className: [styles.groupLabel, styles.labelAssumed].join(' '), children: ["Assumed", _jsx("span", { className: styles.groupHint, children: "model inference \u2014 verify before relying on it" })] }), _jsx("ul", { className: styles.itemList, children: record.payload.assumptions.map((item, index) => (_jsxs("li", { className: styles.item, children: [_jsx("span", { className: styles.itemMark, "aria-hidden": "true", children: "?" }), item] }, index))) })] })), record.payload.suggestions.length > 0 && (_jsxs("div", { className: styles.group, children: [_jsx("div", { className: [styles.groupLabel, styles.labelSuggested].join(' '), children: "Suggested next steps" }), _jsx("ul", { className: styles.itemList, children: record.payload.suggestions.map((item, index) => (_jsxs("li", { className: styles.suggestionCard, children: [_jsx("div", { className: styles.suggestionTitle, children: item.title }), _jsx("div", { className: styles.suggestionDetail, children: item.detail }), item.rationale && (_jsxs("div", { className: styles.suggestionRationale, children: ["Why: ", item.rationale] }))] }, index))) })] })), record.payload.limitations && (_jsx(Callout, { tone: "neutral", title: "What it could not determine", children: record.payload.limitations })), _jsxs("footer", { className: styles.copilotFooter, children: [_jsx("span", { children: record.model }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: [record.usage.promptTokens + record.usage.completionTokens, " tokens"] }), record.usage.costUsd > 0 && (_jsxs(_Fragment, { children: [_jsx("span", { children: "\u00B7" }), _jsx("span", { children: formatUsd(record.usage.costUsd) })] })), _jsx("span", { children: "\u00B7" }), _jsx("span", { children: formatMs(record.usage.latencyMs) }), _jsx("button", { type: "button", className: styles.copilotButton, style: { marginInlineStart: 'auto', padding: '2px var(--space-2)' }, onClick: () => copyNotes(record), children: "Use as note draft" })] })] }, record.id))))] })] }))] }));
}
