import { Badge, difficultyTone, EmptyState } from '../../components/ui/Primitives';
import { titleCase } from '../../lib/format';
import type { InterviewQuestionDto } from '../interviews/types';
import styles from './Workspace.module.css';

export interface QuestionPanelProps {
  questions: InterviewQuestionDto[];
  activeQuestionId: string | null;
  /** Only interviewers may change which question is live for everyone. */
  canSwitch: boolean;
  isStaff: boolean;
  onSwitch: (questionId: string) => void;
  switching: boolean;
}

export function QuestionPanel({
  questions,
  activeQuestionId,
  canSwitch,
  isStaff,
  onSwitch,
  switching,
}: QuestionPanelProps) {
  const active = questions.find((q) => q.questionId === activeQuestionId) ?? questions[0] ?? null;

  return (
    <div className={styles.panel}>
      {questions.length > 1 && (
        <div className={styles.questionNav}>
          {questions.map((question, index) => (
            <button
              key={question.questionId}
              type="button"
              className={[
                styles.questionTab,
                question.questionId === active?.questionId ? styles.questionTabActive : '',
              ]
                .filter(Boolean)
                .join(' ')}
              onClick={() => onSwitch(question.questionId)}
              disabled={!canSwitch || switching}
              title={
                canSwitch
                  ? `Switch everyone to question ${index + 1}`
                  : 'Only the interviewer can change the active question'
              }
            >
              <span>{index + 1}</span>
              <span>{question.title}</span>
            </button>
          ))}
        </div>
      )}

      {!active ? (
        <div className={styles.panelScroll}>
          <EmptyState
            icon="❑"
            title="No question attached"
            body={
              isStaff
                ? 'This interview has no questions. The editor still works as a shared scratchpad, and the console will run code against ad-hoc input.'
                : 'The interviewer has not set a question yet. You can still use the editor.'
            }
          />
        </div>
      ) : (
        <div className={[styles.panelScroll, styles.panelPad].join(' ')}>
          <div className={styles.questionHeading}>
            <h2 className={styles.questionTitle}>{active.title}</h2>
          </div>

          <div className={styles.questionBadges}>
            <Badge tone={difficultyTone[active.difficulty] ?? 'neutral'}>
              {titleCase(active.difficulty)}
            </Badge>
            {active.expectedComplexity && <Badge tone="info">{active.expectedComplexity}</Badge>}
            <Badge tone="neutral">
              {active.testCaseCount} test{active.testCaseCount === 1 ? '' : 's'}
            </Badge>
            {active.categories.map((category) => (
              <Badge key={category} tone="neutral">
                {titleCase(category)}
              </Badge>
            ))}
          </div>

          <p className={styles.prose}>{active.description}</p>

          {active.examples.length > 0 && (
            <>
              <div className={styles.sectionLabel}>Examples</div>
              {active.examples.map((example, index) => (
                <div key={index} className={styles.exampleBlock}>
                  <div className={styles.exampleRow}>
                    <span className={styles.exampleKey}>Input</span>
                    <span className={styles.exampleValue}>{example.input || '(empty)'}</span>
                  </div>
                  <div className={styles.exampleRow}>
                    <span className={styles.exampleKey}>Output</span>
                    <span className={styles.exampleValue}>{example.output || '(empty)'}</span>
                  </div>
                  {example.explanation && (
                    <div className={styles.exampleRow}>
                      <span className={styles.exampleKey}>Why</span>
                      <span className={styles.exampleValue} style={{ fontFamily: 'var(--font-sans)' }}>
                        {example.explanation}
                      </span>
                    </div>
                  )}
                </div>
              ))}
            </>
          )}

          {/* Hints and criteria are interviewer material; the API omits them for
              candidates, and this guard keeps the UI honest about why. */}
          {isStaff && active.hints.length > 0 && (
            <>
              <div className={styles.sectionLabel}>
                Hints <span className={styles.staffOnly}>· interviewer only</span>
              </div>
              <ul className={styles.hintList}>
                {active.hints.map((hint, index) => (
                  <li key={index} className={styles.hintItem}>
                    <span className={styles.hintMark} aria-hidden="true">
                      {index + 1}.
                    </span>
                    {hint}
                  </li>
                ))}
              </ul>
            </>
          )}

          {isStaff && active.evaluationCriteria.length > 0 && (
            <>
              <div className={styles.sectionLabel}>
                Evaluation criteria <span className={styles.staffOnly}>· interviewer only</span>
              </div>
              <ul className={styles.hintList}>
                {active.evaluationCriteria.map((criterion, index) => (
                  <li key={index} className={styles.hintItem}>
                    <span className={styles.hintMark} aria-hidden="true">
                      ◆
                    </span>
                    {criterion}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
