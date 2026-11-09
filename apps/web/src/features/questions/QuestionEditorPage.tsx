import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { DIFFICULTIES, type Difficulty } from '@hirefo/shared';
import { PageHeader } from '../../components/layout/PageHeader';
import { Button, LinkButton } from '../../components/ui/Button';
import { Checkbox, Input, Select, Textarea } from '../../components/ui/Field';
import {
  Badge,
  Callout,
  Card,
  CardBody,
  CardHeader,
  LoadingBlock,
} from '../../components/ui/Primitives';
import { api, ApiError } from '../../lib/api';
import { titleCase } from '../../lib/format';
import { useCapabilitiesStore } from '../../store/capabilities';
import { toast } from '../../store/toast';
import styles from './Questions.module.css';

interface TestCaseForm {
  name: string;
  input: string;
  expectedOutput: string;
  visibility: 'PUBLIC' | 'HIDDEN';
  weight: number;
  timeoutMs: number;
  explanation: string;
}

interface ExampleForm {
  input: string;
  output: string;
  explanation: string;
}

interface QuestionDetail {
  id: string;
  title: string;
  description: string;
  difficulty: Difficulty;
  categories: string[];
  languages: string[];
  expectedComplexity: string | null;
  hints: string[];
  evaluationCriteria: string[];
  examples: ExampleForm[];
  starterCode: Record<string, string>;
  isArchived: boolean;
  testCases: (TestCaseForm & { id: string })[];
}

const emptyTestCase = (): TestCaseForm => ({
  name: '',
  input: '',
  expectedOutput: '',
  visibility: 'HIDDEN',
  weight: 1,
  timeoutMs: 5000,
  explanation: '',
});

const emptyExample = (): ExampleForm => ({ input: '', output: '', explanation: '' });

export function QuestionEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const capabilities = useCapabilitiesStore((s) => s.data);
  const isNew = !id;

  const [loading, setLoading] = useState(!isNew);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({});

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('MEDIUM');
  const [categories, setCategories] = useState<string[]>([]);
  const [languages, setLanguages] = useState<string[]>([]);
  const [expectedComplexity, setExpectedComplexity] = useState('');
  const [hints, setHints] = useState<string[]>(['']);
  const [criteria, setCriteria] = useState<string[]>(['']);
  const [examples, setExamples] = useState<ExampleForm[]>([emptyExample()]);
  const [testCases, setTestCases] = useState<TestCaseForm[]>([
    { ...emptyTestCase(), name: 'Example 1', visibility: 'PUBLIC' },
  ]);
  const [starterCode, setStarterCode] = useState<Record<string, string>>({});
  const [starterTab, setStarterTab] = useState<string>('');
  const [isArchived, setIsArchived] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const data = await api.get<QuestionDetail>(`/api/questions/${id}`);
      setTitle(data.title);
      setDescription(data.description);
      setDifficulty(data.difficulty);
      setCategories(data.categories);
      setLanguages(data.languages);
      setExpectedComplexity(data.expectedComplexity ?? '');
      setHints(data.hints.length ? data.hints : ['']);
      setCriteria(data.evaluationCriteria.length ? data.evaluationCriteria : ['']);
      setExamples(
        data.examples.length
          ? data.examples.map((e) => ({ ...e, explanation: e.explanation ?? '' }))
          : [emptyExample()],
      );
      setTestCases(
        data.testCases.length
          ? data.testCases.map((tc) => ({ ...tc, explanation: tc.explanation ?? '' }))
          : [emptyTestCase()],
      );
      setStarterCode(data.starterCode ?? {});
      setStarterTab(data.languages[0] ?? '');
      setIsArchived(data.isArchived);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : 'Could not load this question.');
    } finally {
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

  const toggle = (list: string[], value: string): string[] =>
    list.includes(value) ? list.filter((v) => v !== value) : [...list, value];

  const save = async (event: React.FormEvent) => {
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
      starterCode: Object.fromEntries(
        Object.entries(starterCode).filter(([key, value]) => languages.includes(key) && value.trim()),
      ),
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
        const created = await api.post<{ id: string }>('/api/questions', payload);
        toast.success('Question created');
        navigate(`/questions/${created.id}`, { replace: true });
      } else {
        await api.patch(`/api/questions/${id}`, payload);
        toast.success('Question saved');
        await load();
      }
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
        setFieldErrors(err.fieldErrors ?? {});
      } else {
        setError('Could not save the question.');
      }
    } finally {
      setSaving(false);
    }
  };

  const serverError = (field: string) => fieldErrors[field]?.[0] ?? null;

  if (loading) return <LoadingBlock label="Loading question" />;

  if (loadError) {
    return (
      <>
        <PageHeader title="Question" breadcrumbs={[{ label: 'Questions', to: '/questions' }]} />
        <Callout tone="danger" title="Could not load this question">
          {loadError}
        </Callout>
      </>
    );
  }

  const publicCount = testCases.filter((tc) => tc.visibility === 'PUBLIC' && tc.name.trim()).length;
  const hiddenCount = testCases.filter((tc) => tc.visibility === 'HIDDEN' && tc.name.trim()).length;

  return (
    <>
      <PageHeader
        title={isNew ? 'New question' : title || 'Question'}
        description="Programs read the test input from stdin and print the answer to stdout. Output is compared after trimming trailing whitespace."
        breadcrumbs={[
          { label: 'Questions', to: '/questions' },
          { label: isNew ? 'New' : 'Edit' },
        ]}
        actions={
          <>
            {!isNew && isArchived && <Badge tone="warning">archived</Badge>}
            <LinkButton to="/questions" variant="ghost" size="md">
              Back
            </LinkButton>
          </>
        }
      />

      <form className={styles.form} onSubmit={(event) => void save(event)} noValidate>
        {error && (
          <Callout tone="danger" title="Could not save">
            {error}
          </Callout>
        )}

        <Card>
          <CardHeader title="Statement" />
          <CardBody>
            <div className={styles.form}>
              <Input
                label="Title"
                required
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                error={serverError('title')}
                placeholder="Merge overlapping intervals"
              />
              <Textarea
                label="Problem statement"
                required
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                error={serverError('description')}
                style={{ minHeight: 180 }}
                placeholder={
                  'Describe the task, the input format and the output format.\n\nThe candidate sees this text exactly as written.'
                }
                hint="Plain text, shown verbatim in the workspace. Be explicit about the I/O format."
              />
              <div className={styles.row}>
                <Select
                  label="Difficulty"
                  required
                  value={difficulty}
                  onChange={(event) => setDifficulty(event.target.value as Difficulty)}
                >
                  {DIFFICULTIES.map((d) => (
                    <option key={d} value={d}>
                      {titleCase(d)}
                    </option>
                  ))}
                </Select>
                <Input
                  label="Expected complexity"
                  optional
                  value={expectedComplexity}
                  onChange={(event) => setExpectedComplexity(event.target.value)}
                  placeholder="O(n log n) time, O(n) space"
                  mono
                />
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Classification" subtitle="Drives filtering and the copilot's context" />
          <CardBody>
            <div className={styles.form}>
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Categories <span style={{ color: 'var(--danger-text)' }}>*</span>
                </div>
                <div className={styles.chipGroup}>
                  {capabilities?.categories.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={[styles.chip, categories.includes(c.id) ? styles.chipActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setCategories((prev) => toggle(prev, c.id))}
                      aria-pressed={categories.includes(c.id)}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                {serverError('categories') && (
                  <p style={{ fontSize: 'var(--text-xs)', color: 'var(--danger-text)', marginTop: 'var(--space-2)' }}>
                    {serverError('categories')}
                  </p>
                )}
              </div>

              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Supported languages <span style={{ color: 'var(--danger-text)' }}>*</span>
                </div>
                <div className={styles.chipGroup}>
                  {capabilities?.languages.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      className={[styles.chip, languages.includes(l.id) ? styles.chipActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => {
                        setLanguages((prev) => {
                          const next = toggle(prev, l.id);
                          if (next.length && !next.includes(starterTab)) setStarterTab(next[0]!);
                          return next;
                        });
                      }}
                      aria-pressed={languages.includes(l.id)}
                      title={l.executionNote}
                    >
                      {l.label}
                      {!l.executable ? ' (no sandbox)' : ''}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Starter code"
            subtitle="Pre-filled in the editor. Leave blank to use the language default."
          />
          <CardBody>
            {languages.length === 0 ? (
              <p style={{ fontSize: 'var(--text-sm)', color: 'var(--text-tertiary)' }}>
                Pick at least one language first.
              </p>
            ) : (
              <>
                <div className={styles.starterTabs}>
                  {languages.map((language) => (
                    <button
                      key={language}
                      type="button"
                      className={[styles.chip, starterTab === language ? styles.chipActive : '']
                        .filter(Boolean)
                        .join(' ')}
                      onClick={() => setStarterTab(language)}
                    >
                      {capabilities?.languages.find((l) => l.id === language)?.label ?? language}
                    </button>
                  ))}
                </div>
                <Textarea
                  label={undefined}
                  mono
                  value={starterCode[starterTab] ?? ''}
                  onChange={(event) =>
                    setStarterCode((prev) => ({ ...prev, [starterTab]: event.target.value }))
                  }
                  style={{ minHeight: 160 }}
                  placeholder="// left blank: HireFO inserts a stdin/stdout skeleton for this language"
                  spellCheck={false}
                />
              </>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Examples"
            subtitle="Shown to the candidate alongside the statement"
            actions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setExamples((prev) => [...prev, emptyExample()])}
              >
                Add example
              </Button>
            }
          />
          <CardBody>
            <div className={styles.repeatable}>
              {examples.map((example, index) => (
                <div key={index} className={styles.itemBlock}>
                  <div className={styles.itemHeader}>
                    <span className={styles.itemIndex}>Example {index + 1}</span>
                    {examples.length > 1 && (
                      <Button
                        type="button"
                        variant="dangerGhost"
                        size="sm"
                        onClick={() => setExamples((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <div className={styles.row}>
                    <Textarea
                      label="Input"
                      mono
                      value={example.input}
                      onChange={(event) =>
                        setExamples((prev) =>
                          prev.map((e, i) => (i === index ? { ...e, input: event.target.value } : e)),
                        )
                      }
                      spellCheck={false}
                    />
                    <Textarea
                      label="Output"
                      mono
                      value={example.output}
                      onChange={(event) =>
                        setExamples((prev) =>
                          prev.map((e, i) => (i === index ? { ...e, output: event.target.value } : e)),
                        )
                      }
                      spellCheck={false}
                    />
                  </div>
                  <Input
                    label="Explanation"
                    optional
                    value={example.explanation}
                    onChange={(event) =>
                      setExamples((prev) =>
                        prev.map((e, i) =>
                          i === index ? { ...e, explanation: event.target.value } : e,
                        ),
                      )
                    }
                  />
                </div>
              ))}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Test cases"
            subtitle={`${publicCount} visible to the candidate, ${hiddenCount} hidden`}
            actions={
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setTestCases((prev) => [...prev, emptyTestCase()])}
              >
                Add test case
              </Button>
            }
          />
          <CardBody>
            {testCases.length === 0 ? (
              <Callout tone="warning" title="No test cases">
                Without test cases the Run and Submit buttons still execute the code, but there is
                nothing to compare the output against.
              </Callout>
            ) : (
              <div className={styles.repeatable}>
                {testCases.map((testCase, index) => (
                  <div key={index} className={styles.itemBlock}>
                    <div className={styles.itemHeader}>
                      <span className={styles.itemIndex}>
                        Case {index + 1}
                        {testCase.visibility === 'HIDDEN' ? ' · hidden' : ' · visible'}
                      </span>
                      <Button
                        type="button"
                        variant="dangerGhost"
                        size="sm"
                        onClick={() => setTestCases((prev) => prev.filter((_, i) => i !== index))}
                      >
                        Remove
                      </Button>
                    </div>

                    <div className={[styles.row, styles.rowThree].join(' ')}>
                      <Input
                        label="Name"
                        required
                        value={testCase.name}
                        onChange={(event) =>
                          setTestCases((prev) =>
                            prev.map((tc, i) =>
                              i === index ? { ...tc, name: event.target.value } : tc,
                            ),
                          )
                        }
                        placeholder="Handles an empty list"
                      />
                      <Select
                        label="Visibility"
                        value={testCase.visibility}
                        onChange={(event) =>
                          setTestCases((prev) =>
                            prev.map((tc, i) =>
                              i === index
                                ? { ...tc, visibility: event.target.value as 'PUBLIC' | 'HIDDEN' }
                                : tc,
                            ),
                          )
                        }
                      >
                        <option value="PUBLIC">Visible — runs on Run</option>
                        <option value="HIDDEN">Hidden — runs on Submit</option>
                      </Select>
                      <Input
                        label="Timeout (ms)"
                        type="number"
                        min={100}
                        max={15000}
                        value={testCase.timeoutMs}
                        onChange={(event) =>
                          setTestCases((prev) =>
                            prev.map((tc, i) =>
                              i === index ? { ...tc, timeoutMs: Number(event.target.value) } : tc,
                            ),
                          )
                        }
                      />
                    </div>

                    <div className={styles.row}>
                      <Textarea
                        label="stdin"
                        mono
                        value={testCase.input}
                        onChange={(event) =>
                          setTestCases((prev) =>
                            prev.map((tc, i) =>
                              i === index ? { ...tc, input: event.target.value } : tc,
                            ),
                          )
                        }
                        spellCheck={false}
                      />
                      <Textarea
                        label="Expected stdout"
                        mono
                        value={testCase.expectedOutput}
                        onChange={(event) =>
                          setTestCases((prev) =>
                            prev.map((tc, i) =>
                              i === index ? { ...tc, expectedOutput: event.target.value } : tc,
                            ),
                          )
                        }
                        spellCheck={false}
                      />
                    </div>

                    <Input
                      label="Note for the interviewer"
                      optional
                      value={testCase.explanation}
                      onChange={(event) =>
                        setTestCases((prev) =>
                          prev.map((tc, i) =>
                            i === index ? { ...tc, explanation: event.target.value } : tc,
                          ),
                        )
                      }
                      hint="What this case is probing. Never shown to the candidate."
                    />
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="Interviewer material"
            subtitle="Hints and criteria — the API never sends these to a candidate"
          />
          <CardBody>
            <div className={styles.form}>
              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Graduated hints
                </div>
                <div className={styles.repeatable}>
                  {hints.map((hint, index) => (
                    <div key={index} className={styles.repeatRow}>
                      <Input
                        value={hint}
                        onChange={(event) =>
                          setHints((prev) =>
                            prev.map((h, i) => (i === index ? event.target.value : h)),
                          )
                        }
                        placeholder={index === 0 ? 'Gentlest nudge first…' : 'More direct…'}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={() => setHints((prev) => prev.filter((_, i) => i !== index))}
                        disabled={hints.length === 1}
                        aria-label={`Remove hint ${index + 1}`}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setHints((prev) => [...prev, ''])}
                  >
                    Add hint
                  </Button>
                </div>
              </div>

              <div>
                <div
                  style={{
                    fontSize: 'var(--text-sm)',
                    fontWeight: 'var(--weight-medium)',
                    color: 'var(--text-secondary)',
                    marginBottom: 'var(--space-2)',
                  }}
                >
                  Evaluation criteria
                </div>
                <div className={styles.repeatable}>
                  {criteria.map((criterion, index) => (
                    <div key={index} className={styles.repeatRow}>
                      <Input
                        value={criterion}
                        onChange={(event) =>
                          setCriteria((prev) =>
                            prev.map((c, i) => (i === index ? event.target.value : c)),
                          )
                        }
                        placeholder="Recognises the sort-then-sweep structure"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="md"
                        onClick={() => setCriteria((prev) => prev.filter((_, i) => i !== index))}
                        disabled={criteria.length === 1}
                        aria-label={`Remove criterion ${index + 1}`}
                      >
                        ✕
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => setCriteria((prev) => [...prev, ''])}
                  >
                    Add criterion
                  </Button>
                </div>
              </div>

              {!isNew && (
                <Checkbox
                  label="Archived"
                  hint="Archived questions stay attached to past interviews but cannot be added to new ones."
                  checked={isArchived}
                  onChange={(event) => setIsArchived(event.target.checked)}
                />
              )}
            </div>
          </CardBody>
        </Card>

        <div className={styles.actions}>
          <LinkButton to="/questions" variant="ghost" size="md">
            Cancel
          </LinkButton>
          <Button
            type="submit"
            variant="primary"
            size="md"
            loading={saving}
            disabled={!title.trim() || !description.trim() || categories.length === 0 || languages.length === 0}
          >
            {isNew ? 'Create question' : 'Save changes'}
          </Button>
        </div>
      </form>
    </>
  );
}
