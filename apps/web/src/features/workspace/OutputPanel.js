import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
import { useState } from 'react';
import { Badge, Callout, EmptyState, executionStatusTone, Spinner } from '../../components/ui/Primitives';
import { formatMs, formatRelative, titleCase } from '../../lib/format';
import styles from './Workspace.module.css';
export function OutputPanel({ execution, running, progress, history, customStdin, onCustomStdinChange, onSelectHistory, hasTestCases, isStaff, }) {
    const [tab, setTab] = useState(hasTestCases ? 'tests' : 'console');
    const [expanded, setExpanded] = useState(null);
    const result = execution?.result ?? null;
    const tests = execution?.testResults ?? [];
    const failedCount = tests.filter((t) => !t.passed).length;
    return (_jsxs("div", { className: styles.panel, children: [_jsxs("div", { className: styles.outputTabs, role: "tablist", "aria-label": "Execution output", children: [_jsxs("button", { type: "button", role: "tab", "aria-selected": tab === 'tests', className: [styles.outputTab, tab === 'tests' ? styles.outputTabActive : ''].filter(Boolean).join(' '), onClick: () => setTab('tests'), children: ["Tests", tests.length > 0 && (_jsxs("span", { className: styles.outputCount, children: [tests.filter((t) => t.passed).length, "/", tests.length] }))] }), _jsx("button", { type: "button", role: "tab", "aria-selected": tab === 'console', className: [styles.outputTab, tab === 'console' ? styles.outputTabActive : ''].filter(Boolean).join(' '), onClick: () => setTab('console'), children: "Console" }), _jsxs("button", { type: "button", role: "tab", "aria-selected": tab === 'history', className: [styles.outputTab, tab === 'history' ? styles.outputTabActive : ''].filter(Boolean).join(' '), onClick: () => setTab('history'), children: ["History", history.length > 0 && _jsx("span", { className: styles.outputCount, children: history.length })] }), _jsx("div", { style: { flex: 1 } }), running && (_jsxs("span", { style: {
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 'var(--space-2)',
                            fontSize: 'var(--text-xs)',
                            color: 'var(--text-tertiary)',
                            paddingInlineEnd: 'var(--space-2)',
                        }, children: [_jsx(Spinner, { size: 11 }), progress?.passedCount !== undefined && progress.totalCount
                                ? `${progress.passedCount}/${progress.totalCount} passed`
                                : 'queued'] })), !running && execution && (_jsx("span", { style: { paddingInlineEnd: 'var(--space-2)' }, children: _jsx(Badge, { tone: executionStatusTone[execution.status] ?? 'neutral', dot: true, children: titleCase(execution.status) }) }))] }), _jsxs("div", { className: styles.panelScroll, children: [tab === 'tests' &&
                        (tests.length === 0 ? (_jsx(EmptyState, { icon: "\u2713", title: running
                                ? 'Running…'
                                : execution
                                    ? 'No test cases were evaluated'
                                    : 'No results yet', body: running
                                ? 'The worker is executing each case in its own container.'
                                : execution
                                    ? 'This run had no question test cases attached, so only the console output is available.'
                                    : hasTestCases
                                        ? 'Press Run to check the example cases, or Submit to include the hidden ones.'
                                        : 'This question has no test cases. Use the Console tab with custom input.' })) : (_jsxs("div", { className: styles.testList, children: [tests.map((test) => {
                                    const isOpen = expanded === test.testCaseId;
                                    return (_jsxs("div", { className: styles.testRow, children: [_jsxs("button", { type: "button", className: styles.testSummary, onClick: () => setExpanded(isOpen ? null : test.testCaseId), "aria-expanded": isOpen, children: [_jsx("span", { className: [
                                                            styles.testMark,
                                                            test.passed ? styles.markPass : styles.markFail,
                                                        ].join(' '), "aria-hidden": "true", children: test.passed ? '✓' : '✕' }), _jsx("span", { className: styles.testName, children: test.name }), test.visibility === 'HIDDEN' && _jsx(Badge, { tone: "neutral", children: "hidden" }), test.timedOut && _jsx(Badge, { tone: "warning", children: "timeout" }), _jsx("span", { className: styles.testTime, children: formatMs(test.durationMs) })] }), isOpen && (_jsx("div", { className: styles.testDetail, children: test.hiddenNotice ? (_jsx(Callout, { tone: "neutral", children: test.hiddenNotice })) : (_jsxs(_Fragment, { children: [_jsxs("div", { className: styles.diffGrid, children: [_jsx("span", { className: styles.diffKey, children: "Input" }), _jsx("span", { className: styles.diffValue, children: test.input || '(empty)' }), _jsx("span", { className: styles.diffKey, children: "Expected" }), _jsx("span", { className: [styles.diffValue, styles.diffExpected].join(' '), children: test.expectedOutput || '(empty)' }), _jsx("span", { className: styles.diffKey, children: "Actual" }), _jsx("span", { className: [
                                                                        styles.diffValue,
                                                                        test.passed ? styles.diffExpected : styles.diffActual,
                                                                    ].join(' '), children: test.actualOutput || '(no output)' })] }), test.stderr && (_jsxs("div", { className: styles.consoleSection, children: [_jsx("span", { className: styles.consoleLabel, children: "stderr" }), _jsx("pre", { className: [styles.console, styles.consoleError].join(' '), style: { padding: 0 }, children: test.stderr })] })), test.errorMessage && (_jsx(Callout, { tone: "warning", children: test.errorMessage })), test.explanation && isStaff && (_jsx("p", { style: { fontSize: 'var(--text-xs)', color: 'var(--text-tertiary)' }, children: test.explanation }))] })) }))] }, test.testCaseId));
                                }), failedCount > 0 && (_jsx("div", { style: { padding: 'var(--space-3)' }, children: _jsxs(Callout, { tone: "neutral", children: [failedCount, " of ", tests.length, " cases failed. Expand a row to see the input and the difference."] }) }))] }))), tab === 'console' && (_jsxs("div", { children: [!hasTestCases && (_jsxs("div", { style: { padding: 'var(--space-3)', borderBottom: '1px solid var(--border-subtle)' }, children: [_jsx("label", { className: styles.consoleLabel, htmlFor: "custom-stdin", style: { marginBottom: 'var(--space-2)' }, children: "stdin for the next run" }), _jsx("textarea", { id: "custom-stdin", className: styles.stdinBox, value: customStdin, onChange: (event) => onCustomStdinChange(event.target.value), placeholder: "Text piped to the program's standard input", spellCheck: false })] })), execution?.errorMessage && (_jsx("div", { style: { padding: 'var(--space-3)' }, children: _jsx(Callout, { tone: "danger", title: "Execution problem", children: execution.errorMessage }) })), result?.compileOutput && (_jsxs("div", { className: styles.consoleSection, style: { padding: 'var(--space-3)' }, children: [_jsx("span", { className: styles.consoleLabel, children: "compiler" }), _jsx("pre", { className: [styles.console, styles.consoleError].join(' '), style: { padding: 0 }, children: result.compileOutput })] })), result ? (_jsxs("div", { style: { padding: 'var(--space-3)' }, children: [_jsxs("div", { className: styles.consoleSection, children: [_jsx("span", { className: styles.consoleLabel, children: "stdout" }), _jsx("pre", { className: styles.console, style: { padding: 0 }, children: result.stdout || '(no output)' })] }), result.stderr && (_jsxs("div", { className: styles.consoleSection, children: [_jsx("span", { className: styles.consoleLabel, children: "stderr" }), _jsx("pre", { className: [styles.console, styles.consoleError].join(' '), style: { padding: 0 }, children: result.stderr })] })), _jsxs("div", { style: {
                                            display: 'flex',
                                            gap: 'var(--space-3)',
                                            flexWrap: 'wrap',
                                            fontSize: 'var(--text-2xs)',
                                            color: 'var(--text-tertiary)',
                                            paddingTop: 'var(--space-2)',
                                            borderTop: '1px solid var(--border-subtle)',
                                        }, children: [_jsxs("span", { children: ["exit ", result.exitCode ?? '—'] }), _jsx("span", { children: formatMs(result.durationMs) }), result.timedOut && _jsx("span", { style: { color: 'var(--warning-text)' }, children: "timed out" }), result.oomKilled && (_jsx("span", { style: { color: 'var(--danger-text)' }, children: "killed: out of memory" })), execution && _jsxs("span", { children: ["runner: ", execution.runnerKind.toLowerCase()] })] })] })) : (!execution?.errorMessage && (_jsx(EmptyState, { icon: "\u25B8", title: running ? 'Waiting for output…' : 'Nothing has run yet', body: running
                                    ? 'Output appears once the sandbox finishes.'
                                    : 'Press Run to execute the current buffer in an isolated container.' })))] })), tab === 'history' &&
                        (history.length === 0 ? (_jsx(EmptyState, { icon: "\u25F4", title: "No runs yet", body: "Every execution in this interview is listed here." })) : (_jsx("div", { className: styles.testList, children: history.map((item) => (_jsx("div", { className: styles.testRow, children: _jsxs("button", { type: "button", className: styles.testSummary, onClick: () => item.execution && onSelectHistory(item.execution.id), disabled: !item.execution, children: [_jsx("span", { className: [
                                                styles.testMark,
                                                item.execution?.status === 'SUCCEEDED'
                                                    ? styles.markPass
                                                    : item.execution && ['FAILED', 'ERROR', 'TIMEOUT'].includes(item.execution.status)
                                                        ? styles.markFail
                                                        : styles.markSkip,
                                            ].join(' '), "aria-hidden": "true", children: item.kind === 'SUBMIT' ? 'S' : 'R' }), _jsxs("span", { className: styles.testName, children: [item.question?.title ?? 'Scratch run', " \u00B7 ", item.author.name] }), item.execution?.passedCount !== null && item.execution?.totalCount ? (_jsxs(Badge, { tone: item.execution.passedCount === item.execution.totalCount
                                                ? 'success'
                                                : 'danger', children: [item.execution.passedCount, "/", item.execution.totalCount] })) : (_jsx(Badge, { tone: executionStatusTone[item.execution?.status ?? 'QUEUED'] ?? 'neutral', children: titleCase(item.execution?.status ?? 'queued') })), _jsx("span", { className: styles.testTime, children: formatRelative(item.createdAt) })] }) }, item.submissionId))) })))] })] }));
}
