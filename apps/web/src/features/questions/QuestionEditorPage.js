import { jsx as _jsx, Fragment as _Fragment, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DIFFICULTIES } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import { Badge, Callout, Card, CardBody, CardHeader, LoadingBlock, } from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Questions.module.css';
const emptyTestCase = () => ({
    name: '',
    input: '',
    expectedOutput: '',
    visibility: 'HIDDEN',
    weight: 1,
    timeoutMs: 5000,
    explanation: '',
});
const emptyExample = () => ({ input: '', output: '', explanation: '' });
export function QuestionEditorPage() {
    const { id } = useParams();
    const navigate = useNavigate();
    const capabilities = useCapabilitiesStore((s) => s.data);
    const isNew = !id;
    const [loading, setLoading] = useState(!isNew);
    const [loadError, setLoadError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(null);
    const [fieldErrors, setFieldErrors] = useState({});
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [difficulty, setDifficulty] = useState('MEDIUM');
    const [categories, setCategories] = useState([]);
    const [languages, setLanguages] = useState([]);
    const [expectedComplexity, setExpectedComplexity] = useState('');
    const [hints, setHints] = useState(['']);
    const [criteria, setCriteria] = useState(['']);
    const [examples, setExamples] = useState([emptyExample()]);
    const [testCases, setTestCases] = useState([
        { ...emptyTestCase(), name: 'Example 1', visibility: 'PUBLIC' },
    ]);
    const [starterCode, setStarterCode] = useState({});
    const [starterTab, setStarterTab] = useState('');
    const [isArchived, setIsArchived] = useState(false);
    const load = useCallback(async () => {
        if (!id)
            return;
        try {
            const data = await api.get(`/api/questions/${id}`);
            setTitle(data.title);
            setDescription(data.description);
            setDifficulty(data.difficulty);
            setCategories(data.categories);
            setLanguages(data.languages);
            setExpectedComplexity(data.expectedComplexity ?? '');
            setHints(data.hints.length ? data.hints : ['']);
            setCriteria(data.evaluationCriteria.length ? data.evaluationCriteria : ['']);
            setExamples(data.examples.length
                ? data.examples.map((e) => ({ ...e, explanation: e.explanation ?? '' }))
                : [emptyExample()]);
            setTestCases(data.testCases.length
                ? data.testCases.map((tc) => ({ ...tc, explanation: tc.explanation ?? '' }))
                : [emptyTestCase()]);
            setStarterCode(data.starterCode ?? {});
            setStarterTab(data.languages[0] ?? '');
            setIsArchived(data.isArchived);
        }
        catch (err) {
            setLoadError(err instanceof ApiError ? err.message : 'Could not load this question.');
        }
        finally {
            setLoading(false);
        }
    }, [id]);
    useEffect(() => {
        void load();
    }, [load]);
    // Default the language selection for a new question to the first executable one.
    useEffect(() => {
        if (isNew && languages.length === 0 && capabilities?.languages.length) {
            const first = capabilities.languages.find((l) => l.executable)?.id;
            if (first) {
                setLanguages([first]);
                setStarterTab(first);
            }
        }
    }, [isNew, languages.length, capabilities]);
    const toggle = (list, value) => list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    const save = async (event) => {
        event.preventDefault();
        setSaving(true);
        setError(null);
        setFieldErrors({});
        const payload = {
            title: title.trim(),
            description: description.trim(),
            difficulty,
            categories,
            languages,
            ...(expectedComplexity.trim() ? { expectedComplexity: expectedComplexity.trim() } : {}),
            hints: hints.map((h) => h.trim()).filter(Boolean),
            evaluationCriteria: criteria.map((c) => c.trim()).filter(Boolean),
            examples: examples
                .filter((e) => e.input.trim() || e.output.trim())
                .map((e) => ({
                input: e.input,
                output: e.output,
                ...(e.explanation.trim() ? { explanation: e.explanation.trim() } : {}),
            })),
            starterCode: Object.fromEntries(Object.entries(starterCode).filter(([key, value]) => languages.includes(key) && value.trim())),
            testCases: testCases
                .filter((tc) => tc.name.trim())
                .map((tc) => ({
                name: tc.name.trim(),
                input: tc.input,
                expectedOutput: tc.expectedOutput,
                visibility: tc.visibility,
                weight: tc.weight,
                timeoutMs: tc.timeoutMs,
                ...(tc.explanation.trim() ? { explanation: tc.explanation.trim() } : {}),
            })),
            ...(isNew ? {} : { isArchived }),
        };
        try {
            if (isNew) {
                const created = await api.post('/api/questions', payload);
                toast.success('Question created');
                navigate(`/questions/${created.id}`, { replace: true });
            }
            else {
                await api.patch(`/api/questions/${id}`, payload);
                toast.success('Question saved');
                await load();
            }
        }
        catch (err) {
            if (err instanceof ApiError) {
                setError(err.message);
                setFieldErrors(err.fieldErrors ?? {});
            }
            else {
                setError('Could not save the question.');
            }
        }
        finally {
            setSaving(false);
        }
    };
    const serverError = (field) => fieldErrors[field]?.[0] ?? null;
    if (loading)
        return _jsx(LoadingBlock, { label: "Loading question" });
    if (loadError) {
        return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: "Question", breadcrumbs: [{ label: 'Questions', to: '/questions' }] }), _jsx(Callout, { tone: "danger", title: "Could not load this question", children: loadError })] }));
    }
    const publicCount = testCases.filter((tc) => tc.visibility === 'PUBLIC' && tc.name.trim()).length;
    const hiddenCount = testCases.filter((tc) => tc.visibility === 'HIDDEN' && tc.name.trim()).length;
    return (_jsxs(_Fragment, { children: [_jsx(PageHeader, { title: isNew ? 'New question' : title || 'Question', description: "Programs read the test input from stdin and print the answer to stdout. Output is compared after trimming trailing whitespace.", breadcrumbs: [
                    { label: 'Questions', to: '/questions' },
                    { label: isNew ? 'New' : 'Edit' },
                ], actions: _jsxs(_Fragment, { children: [!isNew && isArchived && _jsx(Badge, { tone: "warning", children: "archived" }), _jsx(LinkButton, { to: "/questions", variant: "ghost", size: "md", children: "Back" })] }) }), _jsxs("form", { className: styles.form, onSubmit: (event) => void save(event), noValidate: true, children: [error && (_jsx(Callout, { tone: "danger", title: "Could not save", children: error })), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Statement" }), _jsx(CardBody, { children: _jsxs("div", { className: styles.form, children: [_jsx(Input, { label: "Title", required: true, value: title, onChange: (event) => setTitle(event.target.value), error: serverError('title'), placeholder: "Merge overlapping intervals" }), _jsx(Textarea, { label: "Problem statement", required: true, value: description, onChange: (event) => setDescription(event.target.value), error: serverError('description'), style: { minHeight: 180 }, placeholder: 'Describe the task, the input format and the output format.\n\nThe candidate sees this text exactly as written.', hint: "Plain text, shown verbatim in the workspace. Be explicit about the I/O format." }), _jsxs("div", { className: styles.row, children: [_jsx(Select, { label: "Difficulty", required: true, value: difficulty, onChange: (event) => setDifficulty(event.target.value), children: DIFFICULTIES.map((d) => (_jsx("option", { value: d, children: titleCase(d) }, d))) }), _jsx(Input, { label: "Expected complexity", optional: true, value: expectedComplexity, onChange: (event) => setExpectedComplexity(event.target.value), placeholder: "O(n log n) time, O(n) space", mono: true })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Classification", subtitle: "Drives filtering and the copilot's context" }), _jsx(CardBody, { children: _jsxs("div", { className: styles.form, children: [_jsxs("div", { children: [_jsxs("div", { style: {
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 'var(--weight-medium)',
                                                        color: 'var(--text-secondary)',
                                                        marginBottom: 'var(--space-2)',
                                                    }, children: ["Categories ", _jsx("span", { style: { color: 'var(--danger-text)' }, children: "*" })] }), _jsx("div", { className: styles.chipGroup, children: capabilities?.categories.map((c) => (_jsx("button", { type: "button", className: [styles.chip, categories.includes(c.id) ? styles.chipActive : '']
                                                            .filter(Boolean)
                                                            .join(' '), onClick: () => setCategories((prev) => toggle(prev, c.id)), "aria-pressed": categories.includes(c.id), children: c.label }, c.id))) }), serverError('categories') && (_jsx("p", { style: { fontSize: 'var(--text-xs)', color: 'var(--danger-text)', marginTop: 'var(--space-2)' }, children: serverError('categories') }))] }), _jsxs("div", { children: [_jsxs("div", { style: {
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 'var(--weight-medium)',
                                                        color: 'var(--text-secondary)',
                                                        marginBottom: 'var(--space-2)',
                                                    }, children: ["Supported languages ", _jsx("span", { style: { color: 'var(--danger-text)' }, children: "*" })] }), _jsx("div", { className: styles.chipGroup, children: capabilities?.languages.map((l) => (_jsxs("button", { type: "button", className: [styles.chip, languages.includes(l.id) ? styles.chipActive : '']
                                                            .filter(Boolean)
                                                            .join(' '), onClick: () => {
                                                            setLanguages((prev) => {
                                                                const next = toggle(prev, l.id);
                                                                if (next.length && !next.includes(starterTab))
                                                                    setStarterTab(next[0]);
                                                                return next;
                                                            });
                                                        }, "aria-pressed": languages.includes(l.id), title: l.executionNote, children: [l.label, !l.executable ? ' (no sandbox)' : ''] }, l.id))) })] })] }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Starter code", subtitle: "Pre-filled in the editor. Leave blank to use the language default." }), _jsx(CardBody, { children: languages.length === 0 ? (_jsx("p", { style: { fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }, children: "Pick at least one language first." })) : (_jsxs(_Fragment, { children: [_jsx("div", { className: styles.starterTabs, children: languages.map((language) => (_jsx("button", { type: "button", className: [styles.chip, starterTab === language ? styles.chipActive : '']
                                                    .filter(Boolean)
                                                    .join(' '), onClick: () => setStarterTab(language), children: capabilities?.languages.find((l) => l.id === language)?.label ?? language }, language))) }), _jsx(Textarea, { label: undefined, mono: true, value: starterCode[starterTab] ?? '', onChange: (event) => setStarterCode((prev) => ({ ...prev, [starterTab]: event.target.value })), style: { minHeight: 160 }, placeholder: "// left blank: HireFO inserts a stdin/stdout skeleton for this language", spellCheck: false })] })) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Examples", subtitle: "Shown to the candidate alongside the statement", actions: _jsx(Button, { type: "button", variant: "secondary", size: "sm", onClick: () => setExamples((prev) => [...prev, emptyExample()]), children: "Add example" }) }), _jsx(CardBody, { children: _jsx("div", { className: styles.repeatable, children: examples.map((example, index) => (_jsxs("div", { className: styles.itemBlock, children: [_jsxs("div", { className: styles.itemHeader, children: [_jsxs("span", { className: styles.itemIndex, children: ["Example ", index + 1] }), examples.length > 1 && (_jsx(Button, { type: "button", variant: "dangerGhost", size: "sm", onClick: () => setExamples((prev) => prev.filter((_, i) => i !== index)), children: "Remove" }))] }), _jsxs("div", { className: styles.row, children: [_jsx(Textarea, { label: "Input", mono: true, value: example.input, onChange: (event) => setExamples((prev) => prev.map((e, i) => (i === index ? { ...e, input: event.target.value } : e))), spellCheck: false }), _jsx(Textarea, { label: "Output", mono: true, value: example.output, onChange: (event) => setExamples((prev) => prev.map((e, i) => (i === index ? { ...e, output: event.target.value } : e))), spellCheck: false })] }), _jsx(Input, { label: "Explanation", optional: true, value: example.explanation, onChange: (event) => setExamples((prev) => prev.map((e, i) => i === index ? { ...e, explanation: event.target.value } : e)) })] }, index))) }) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Test cases", subtitle: `${publicCount} visible to the candidate, ${hiddenCount} hidden`, actions: _jsx(Button, { type: "button", variant: "secondary", size: "sm", onClick: () => setTestCases((prev) => [...prev, emptyTestCase()]), children: "Add test case" }) }), _jsx(CardBody, { children: testCases.length === 0 ? (_jsx(Callout, { tone: "warning", title: "No test cases", children: "Without test cases the Run and Submit buttons still execute the code, but there is nothing to compare the output against." })) : (_jsx("div", { className: styles.repeatable, children: testCases.map((testCase, index) => (_jsxs("div", { className: styles.itemBlock, children: [_jsxs("div", { className: styles.itemHeader, children: [_jsxs("span", { className: styles.itemIndex, children: ["Case ", index + 1, testCase.visibility === 'HIDDEN' ? ' · hidden' : ' · visible'] }), _jsx(Button, { type: "button", variant: "dangerGhost", size: "sm", onClick: () => setTestCases((prev) => prev.filter((_, i) => i !== index)), children: "Remove" })] }), _jsxs("div", { className: [styles.row, styles.rowThree].join(' '), children: [_jsx(Input, { label: "Name", required: true, value: testCase.name, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index ? { ...tc, name: event.target.value } : tc)), placeholder: "Handles an empty list" }), _jsxs(Select, { label: "Visibility", value: testCase.visibility, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index
                                                            ? { ...tc, visibility: event.target.value }
                                                            : tc)), children: [_jsx("option", { value: "PUBLIC", children: "Visible \u2014 runs on Run" }), _jsx("option", { value: "HIDDEN", children: "Hidden \u2014 runs on Submit" })] }), _jsx(Input, { label: "Timeout (ms)", type: "number", min: 100, max: 15000, value: testCase.timeoutMs, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index ? { ...tc, timeoutMs: Number(event.target.value) } : tc)) })] }), _jsxs("div", { className: styles.row, children: [_jsx(Textarea, { label: "stdin", mono: true, value: testCase.input, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index ? { ...tc, input: event.target.value } : tc)), spellCheck: false }), _jsx(Textarea, { label: "Expected stdout", mono: true, value: testCase.expectedOutput, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index ? { ...tc, expectedOutput: event.target.value } : tc)), spellCheck: false })] }), _jsx(Input, { label: "Note for the interviewer", optional: true, value: testCase.explanation, onChange: (event) => setTestCases((prev) => prev.map((tc, i) => i === index ? { ...tc, explanation: event.target.value } : tc)), hint: "What this case is probing. Never shown to the candidate." })] }, index))) })) })] }), _jsxs(Card, { children: [_jsx(CardHeader, { title: "Interviewer material", subtitle: "Hints and criteria \u2014 the API never sends these to a candidate" }), _jsx(CardBody, { children: _jsxs("div", { className: styles.form, children: [_jsxs("div", { children: [_jsx("div", { style: {
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 'var(--weight-medium)',
                                                        color: 'var(--text-secondary)',
                                                        marginBottom: 'var(--space-2)',
                                                    }, children: "Graduated hints" }), _jsxs("div", { className: styles.repeatable, children: [hints.map((hint, index) => (_jsxs("div", { className: styles.repeatRow, children: [_jsx(Input, { value: hint, onChange: (event) => setHints((prev) => prev.map((h, i) => (i === index ? event.target.value : h))), placeholder: index === 0 ? 'Gentlest nudge first…' : 'More direct…' }), _jsx(Button, { type: "button", variant: "ghost", size: "md", onClick: () => setHints((prev) => prev.filter((_, i) => i !== index)), disabled: hints.length === 1, "aria-label": `Remove hint ${index + 1}`, children: "\u2715" })] }, index))), _jsx(Button, { type: "button", variant: "secondary", size: "sm", onClick: () => setHints((prev) => [...prev, '']), children: "Add hint" })] })] }), _jsxs("div", { children: [_jsx("div", { style: {
                                                        fontSize: 'var(--text-sm)',
                                                        fontWeight: 'var(--weight-medium)',
                                                        color: 'var(--text-secondary)',
                                                        marginBottom: 'var(--space-2)',
                                                    }, children: "Evaluation criteria" }), _jsxs("div", { className: styles.repeatable, children: [criteria.map((criterion, index) => (_jsxs("div", { className: styles.repeatRow, children: [_jsx(Input, { value: criterion, onChange: (event) => setCriteria((prev) => prev.map((c, i) => (i === index ? event.target.value : c))), placeholder: "Recognises the sort-then-sweep structure" }), _jsx(Button, { type: "button", variant: "ghost", size: "md", onClick: () => setCriteria((prev) => prev.filter((_, i) => i !== index)), disabled: criteria.length === 1, "aria-label": `Remove criterion ${index + 1}`, children: "\u2715" })] }, index))), _jsx(Button, { type: "button", variant: "secondary", size: "sm", onClick: () => setCriteria((prev) => [...prev, '']), children: "Add criterion" })] })] }), !isNew && (_jsx(Checkbox, { label: "Archived", hint: "Archived questions stay attached to past interviews but cannot be added to new ones.", checked: isArchived, onChange: (event) => setIsArchived(event.target.checked) }))] }) })] }), _jsxs("div", { className: styles.actions, children: [_jsx(LinkButton, { to: "/questions", variant: "ghost", size: "md", children: "Cancel" }), _jsx(Button, { type: "submit", variant: "primary", size: "md", loading: saving, disabled: !title.trim() || !description.trim() || categories.length === 0 || languages.length === 0, children: isNew ? 'Create question' : 'Save changes' })] })] })] }));
}
