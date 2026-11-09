import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { DIFFICULTIES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Badge, Callout, Card, difficultyTone, EmptyState, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { formatRelative, pluralise, titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import styles from './Questions.module.css';
export function QuestionLibraryPage() {
    const capabilities = useCapabilitiesStore((s) => s.data);
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    const [search, setSearch] = useState('');
    const [debouncedSearch, setDebouncedSearch] = useState('');
    const [difficulty, setDifficulty] = useState('');
    const [category, setCategory] = useState('');
    const [language, setLanguage] = useState('');
    const [includeArchived, setIncludeArchived] = useState(false);
    const [page, setPage] = useState(1);
    useEffect(() => {
        const timer = setTimeout(() => {
            setDebouncedSearch(search);
            setPage(1);
        }, 250);
        return () => clearTimeout(timer);
    }, [search]);
    const load = useCallback(async () => {
        setLoading(true);
        setError(null);
        const params = new URLSearchParams({ page: String(page), pageSize: '24' });
        if (debouncedSearch)
            params.set('search', debouncedSearch);
        if (difficulty)
            params.set('difficulty', difficulty);
        if (category)
            params.set('category', category);
        if (language)
            params.set('language', language);
        if (includeArchived)
            params.set('includeArchived', 'true');
        try {
            setData(await api.get(`/api/questions?${params.toString()}`));
        }
        catch (err) {
            setError(err instanceof ApiError ? err.message : 'Could not load the question library.');
        }
        finally {
            setLoading(false);
        }
    }, [page, debouncedSearch, difficulty, category, language, includeArchived]);
    useEffect(() => {
        void load();
    }, [load]);
    const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
    const filtered = Boolean(debouncedSearch || difficulty || category || language);
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Question library", description: "Questions, their example cases and their hidden test cases. Only interviewers and admins can see this page.", actions: _jsx(LinkButton, { to: "/questions/new", variant: "primary", size: "md", children: "New question" }) }), _jsxs("div", { className: styles.toolbar, children: [_jsx("input", { className: styles.search, type: "search", placeholder: "Search titles and statements\u2026", value: search, onChange: (event) => setSearch(event.target.value), "aria-label": "Search questions" }), _jsxs("select", { className: styles.filter, value: difficulty, onChange: (event) => {
                            setDifficulty(event.target.value);
                            setPage(1);
                        }, "aria-label": "Filter by difficulty", children: [_jsx("option", { value: "", children: "Any difficulty" }), DIFFICULTIES.map((d) => (_jsx("option", { value: d, children: titleCase(d) }, d)))] }), _jsxs("select", { className: styles.filter, value: category, onChange: (event) => {
                            setCategory(event.target.value);
                            setPage(1);
                        }, "aria-label": "Filter by category", children: [_jsx("option", { value: "", children: "Any category" }), capabilities?.categories.map((c) => (_jsx("option", { value: c.id, children: c.label }, c.id)))] }), _jsxs("select", { className: styles.filter, value: language, onChange: (event) => {
                            setLanguage(event.target.value);
                            setPage(1);
                        }, "aria-label": "Filter by language", children: [_jsx("option", { value: "", children: "Any language" }), capabilities?.languages.map((l) => (_jsx("option", { value: l.id, children: l.label }, l.id)))] }), _jsx(Button, { variant: includeArchived ? 'primary' : 'secondary', size: "md", onClick: () => {
                            setIncludeArchived((v) => !v);
                            setPage(1);
                        }, "aria-pressed": includeArchived, children: "Show archived" })] }), error && (_jsx(Callout, { tone: "danger", title: "Could not load questions", children: error })), loading && !data ? (_jsx(LoadingBlock, { label: "Loading questions" })) : data && data.items.length > 0 ? (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.grid, children: data.items.map((question) => (_jsxs(Link, { to: `/questions/${question.id}`, className: [styles.card, question.isArchived ? styles.cardArchived : '']
                                .filter(Boolean)
                                .join(' '), children: [_jsx("div", { children: _jsx("div", { className: styles.cardTitle, children: question.title }) }), _jsxs("div", { className: styles.cardBadges, children: [_jsx(Badge, { tone: difficultyTone[question.difficulty] ?? 'neutral', children: titleCase(question.difficulty) }), question.isArchived && _jsx(Badge, { tone: "warning", children: "archived" }), question.testCaseCount === 0 && _jsx(Badge, { tone: "danger", children: "no tests" }), question.expectedComplexity && (_jsx(Badge, { tone: "info", children: question.expectedComplexity }))] }), _jsx("div", { className: styles.cardBadges, children: question.categories.slice(0, 3).map((c) => (_jsx(Badge, { tone: "neutral", children: titleCase(c) }, c))) }), _jsxs("div", { className: styles.cardFooter, children: [_jsxs("span", { children: [question.testCaseCount, " ", pluralise(question.testCaseCount, 'test')] }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["used in ", question.usedInInterviews, ' ', pluralise(question.usedInInterviews, 'interview')] }), _jsx("span", { children: "\u00B7" }), _jsxs("span", { children: ["edited ", formatRelative(question.updatedAt)] })] })] }, question.id))) }), _jsxs("div", { style: {
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 'var(--space-3)',
                            marginTop: 'var(--space-5)',
                            fontSize: 'var(--text-sm)',
                            color: 'var(--text-tertiary)',
                        }, children: [_jsxs("span", { children: [data.total, " ", pluralise(data.total, 'question'), " \u00B7 page ", data.page, " of ", totalPages] }), _jsxs("div", { style: { display: 'flex', gap: 'var(--space-2)' }, children: [_jsx(Button, { size: "sm", variant: "secondary", disabled: page <= 1 || loading, onClick: () => setPage((p) => Math.max(1, p - 1)), children: "Previous" }), _jsx(Button, { size: "sm", variant: "secondary", disabled: page >= totalPages || loading, onClick: () => setPage((p) => p + 1), children: "Next" })] })] })] })) : (_jsx(Card, { children: _jsx(EmptyState, { icon: "\u2751", title: filtered ? 'No questions match those filters' : 'The library is empty', body: filtered
                        ? 'Try clearing the search or the filters.'
                        : 'Add a question with a statement, examples and hidden test cases. Interviews draw their question sets from here.', actions: !filtered ? (_jsx(LinkButton, { to: "/questions/new", variant: "primary", size: "sm", children: "Create the first question" })) : undefined }) }))] }));
}
