import { expect, test, type BrowserContext, type Page } from '@playwright/test';

/**
 * The definition-of-done journey, driven through the real UI:
 *
 *   register -> create a question -> create an interview -> invite a candidate
 *   -> candidate accepts in a second browser context -> both are in the workspace
 *   -> they collaborate in the editor -> code runs in the sandbox -> tests return
 *   -> notes and an evaluation are saved
 *
 * Two browser contexts are used so the two participants are genuinely separate
 * sessions, not the same session in two tabs.
 */

const PASSWORD = 'e2e-password-1234';
const unique = () => Math.random().toString(36).slice(2, 8);

/** The echo question's solution: read stdin, print it back. */
const SOLUTION = `const input = require('fs').readFileSync(0, 'utf8').trim();
console.log(input);
`;

async function registerOrg(page: Page, suffix: string) {
  const email = `interviewer-${suffix}@e2e.test`;
  await page.goto('/register');
  await page.getByLabel('Organization name').fill(`E2E Org ${suffix}`);
  await page.getByLabel('Your name').fill('Sam Rivera');
  await page.getByLabel('Work email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create organization' }).click();

  await expect(page.getByRole('heading', { name: /Welcome back/ })).toBeVisible();
  return email;
}

async function createQuestion(page: Page, title: string) {
  await page.goto('/questions/new');
  await page.getByLabel('Title').fill(title);
  await page
    .getByLabel('Problem statement')
    .fill('Read one line from stdin and print it back unchanged.');

  await page.getByRole('button', { name: 'Algorithms', exact: true }).click();

  // Two visible cases and one hidden case, so RUN and SUBMIT differ observably.
  const cases = [
    { name: 'Example one', input: 'hello', output: 'hello', visibility: 'PUBLIC' },
    { name: 'Example two', input: 'world', output: 'world', visibility: 'PUBLIC' },
    { name: 'Hidden case', input: 'secret-value', output: 'secret-value', visibility: 'HIDDEN' },
  ];

  for (let i = 1; i < cases.length; i += 1) {
    await page.getByRole('button', { name: 'Add test case' }).click();
  }

  for (const [index, testCase] of cases.entries()) {
    const block = page.locator('form').getByText(`Case ${index + 1}`).locator('..').locator('..');
    await block.getByLabel('Name').fill(testCase.name);
    await block.getByLabel('stdin').fill(testCase.input);
    await block.getByLabel('Expected stdout').fill(testCase.output);
    await block
      .getByLabel('Visibility')
      .selectOption(testCase.visibility === 'PUBLIC' ? 'PUBLIC' : 'HIDDEN');
  }

  await page.getByRole('button', { name: 'Create question' }).click();
  await expect(page.getByText('Question created')).toBeVisible();
}

async function createInterview(page: Page, title: string, questionTitle: string) {
  await page.goto('/interviews/new');
  await page.getByLabel('Title').fill(title);
  await page.getByRole('checkbox', { name: new RegExp(questionTitle) }).click();
  await page.getByRole('button', { name: 'Create interview' }).click();

  await expect(page.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
  const url = page.url();
  const id = url.split('/interviews/')[1]!.split(/[/?#]/)[0]!;
  return id;
}

/** Creates an invitation and returns the one-time link. */
async function inviteCandidate(page: Page, email: string): Promise<string> {
  await page.getByRole('button', { name: 'Invite' }).click();
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Role').selectOption('CANDIDATE');
  await page.getByRole('button', { name: 'Create link' }).click();

  const link = page.getByLabel('Invitation link');
  await expect(link).toBeVisible();
  const url = await link.inputValue();
  await page.getByRole('button', { name: 'Done' }).click();
  return url;
}

async function acceptInvitation(context: BrowserContext, url: string): Promise<Page> {
  const page = await context.newPage();
  // The link is absolute against WEB_PUBLIC_URL, which matches the test baseURL.
  await page.goto(url);
  await expect(page.getByRole('heading', { name: /Join E2E Org/ })).toBeVisible();
  await page.getByLabel('Your name').fill('Jules Tan');
  await page.getByLabel('Choose a password').fill(PASSWORD);
  await page.getByRole('button', { name: /Accept/ }).click();
  return page;
}

/**
 * Replaces the whole Monaco buffer.
 *
 * The buffer is set through Monaco's model API rather than by typing: Monaco
 * auto-closes brackets and quotes, so key-by-key typing corrupts source, and
 * select-all keybindings do not reliably reach the editor's hidden textarea from
 * Playwright. `setValue` fires the same change event typing would, so the
 * collaborative sync path is still exercised for real.
 *
 * `window.monaco` is a development-only handle (see src/lib/monaco.ts).
 */
async function setEditorContent(page: Page, code: string) {
  const lines = page.locator('.monaco-editor .view-lines').first();
  await expect(lines).toBeVisible();

  await page.waitForFunction(
    () => Boolean((window as never as { monaco?: { editor: { getModels(): unknown[] } } }).monaco?.editor.getModels().length),
  );

  await page.evaluate((text) => {
    const w = window as never as {
      monaco: { editor: { getModels(): { setValue(v: string): void }[] } };
    };
    const model = w.monaco.editor.getModels()[0]!;
    model.setValue(text);
  }, code);

  // Assert the replacement actually happened. Appending to the starter template
  // produced a duplicate declaration and a confusing downstream failure.
  await expect(lines).toContainText(code.split('\n')[0]!.slice(0, 24));
  await expect(lines).not.toContainText('TODO: implement');
}

test.describe('interview journey', () => {
  test('two participants collaborate, run code in the sandbox and record an evaluation', async ({
    browser,
  }) => {
    const suffix = unique();
    const questionTitle = `Echo the input ${suffix}`;
    const candidateEmail = `candidate-${suffix}@e2e.test`;

    // ---- interviewer ----
    const interviewerContext = await browser.newContext();
    const interviewer = await interviewerContext.newPage();

    await test.step('interviewer registers an organization', async () => {
      await registerOrg(interviewer, suffix);
    });

    await test.step('interviewer adds a question with hidden test cases', async () => {
      await createQuestion(interviewer, questionTitle);
    });

    const interviewId = await test.step('interviewer creates an interview', async () =>
      createInterview(interviewer, `E2E Round ${suffix}`, questionTitle));

    const inviteUrl = await test.step('interviewer invites the candidate', async () =>
      inviteCandidate(interviewer, candidateEmail));

    await test.step('interviewer starts the interview', async () => {
      await interviewer.getByRole('button', { name: 'Start interview' }).click();
      // Starting navigates straight into the workspace.
      await expect(interviewer).toHaveURL(new RegExp(`/interviews/${interviewId}/workspace`));
      await expect(interviewer.getByText('In Progress', { exact: true })).toBeVisible();
    });

    // ---- candidate, in a separate context ----
    const candidateContext = await browser.newContext();

    const candidate = await test.step('candidate accepts the invitation', async () =>
      acceptInvitation(candidateContext, inviteUrl));

    await test.step('candidate lands in the same workspace', async () => {
      await expect(candidate).toHaveURL(new RegExp(`/interviews/${interviewId}/workspace`));
      await expect(candidate.getByText(questionTitle).first()).toBeVisible();
    });

    await test.step('both see each other in the presence list', async () => {
      await expect(interviewer.getByText(/2 online/)).toBeVisible();
      await expect(candidate.getByText(/2 online/)).toBeVisible();
    });

    await test.step('the candidate cannot see interviewer-only material', async () => {
      // Hints exist on the question but must not reach the candidate's panel.
      await expect(candidate.getByText('interviewer only')).toHaveCount(0);
      await expect(candidate.getByRole('tab', { name: 'Copilot' })).toHaveCount(0);
    });

    await test.step('an edit by the candidate reaches the interviewer', async () => {
      await setEditorContent(candidate, SOLUTION);
      // The interviewer's buffer converges on the same text.
      await expect(interviewer.locator('.monaco-editor').first()).toContainText('readFileSync', {
        timeout: 30_000,
      });
    });

    await test.step('RUN executes in the sandbox and passes the visible cases', async () => {
      await candidate.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(candidate.getByText('Succeeded', { exact: true })).toBeVisible({ timeout: 120_000 });

      await candidate.getByRole('tab', { name: /Tests/ }).click();
      await expect(candidate.getByText('Example one')).toBeVisible();
      await expect(candidate.getByText('Example two')).toBeVisible();
      // A RUN never touches the hidden case.
      await expect(candidate.getByText('Hidden case')).toHaveCount(0);
    });

    await test.step('SUBMIT also runs the hidden case, without revealing it', async () => {
      await candidate.getByRole('button', { name: 'Submit' }).click();
      await expect(candidate.getByText('Succeeded', { exact: true })).toBeVisible({ timeout: 120_000 });

      await candidate.getByRole('tab', { name: /Tests/ }).click();
      await expect(candidate.getByText('Hidden case')).toBeVisible();

      // Expanding it shows the redaction notice, not the data.
      await candidate.getByRole('button', { name: /Hidden case/ }).click();
      await expect(candidate.getByText(/visible to the interviewer only/)).toBeVisible();
      await expect(candidate.getByText('secret-value')).toHaveCount(0);
    });

    await test.step('the interviewer sees the hidden case contents', async () => {
      await interviewer.getByRole('tab', { name: /Tests/ }).click();
      await interviewer.getByRole('button', { name: /Hidden case/ }).click();
      await expect(interviewer.getByText('secret-value').first()).toBeVisible();
    });

    await test.step('a failing solution reports the difference', async () => {
      await setEditorContent(candidate, `console.log('wrong answer');\n`);
      await candidate.getByRole('button', { name: 'Run', exact: true }).click();
      await expect(candidate.getByText('Failed', { exact: true })).toBeVisible({ timeout: 120_000 });

      await candidate.getByRole('tab', { name: /Tests/ }).click();
      await candidate.getByRole('button', { name: /Example one/ }).click();
      await expect(candidate.getByText('wrong answer').first()).toBeVisible();
    });

    await test.step('the copilot reports that it is not configured, rather than inventing output', async () => {
      await interviewer.getByRole('tab', { name: 'Copilot' }).click();
      await expect(interviewer.getByText(/Copilot is not configured/)).toBeVisible();
    });

    await test.step('the interviewer saves a private note', async () => {
      await interviewer.getByRole('tab', { name: 'Notes' }).click();
      await interviewer
        .getByPlaceholder(/What the candidate said/)
        .fill('Solved the echo question unaided; moved on quickly.');
      await interviewer.getByRole('button', { name: 'Save note' }).click();
      await expect(interviewer.getByText('Note saved')).toBeVisible();
      await expect(interviewer.getByText(/Solved the echo question unaided/)).toBeVisible();
    });

    await test.step('the private note is not visible to the candidate', async () => {
      await candidate.reload();
      await expect(candidate.getByText(/Solved the echo question unaided/)).toHaveCount(0);
    });

    await test.step('the interviewer completes the interview', async () => {
      await interviewer.goto(`/interviews/${interviewId}`);
      await interviewer.getByRole('button', { name: 'Mark complete' }).click();
      await expect(interviewer.getByText('Completed', { exact: true }).first()).toBeVisible();
    });

    await test.step('analytics reflect the real runs', async () => {
      await interviewer.goto(`/interviews/${interviewId}/evaluation`);
      await expect(interviewer.getByRole('heading', { name: 'Evaluation' })).toBeVisible();
      await expect(interviewer.getByText(/These are counts of what happened/)).toBeVisible();
      // Three runs happened: one RUN, one SUBMIT, one failing RUN.
      await expect(interviewer.getByText('Code runs')).toBeVisible();
      await expect(interviewer.getByText('3', { exact: true }).first()).toBeVisible();
    });

    await test.step('the interviewer records and submits an evaluation', async () => {
      await interviewer.getByRole('radiogroup', { name: 'Problem solving' }).getByText('4').click();
      await interviewer.getByRole('radiogroup', { name: 'Communication' }).getByText('5').click();
      await interviewer
        .getByLabel('Summary')
        .fill('Clear and quick on the warm-up. Would go deeper next round.');
      await interviewer.getByLabel('Recommendation').selectOption('LEAN_YES');

      await interviewer.getByRole('button', { name: 'Submit evaluation' }).click();
      await interviewer.getByRole('button', { name: 'Submit', exact: true }).click();
      await expect(interviewer.getByText('Evaluation submitted')).toBeVisible();
    });

    await test.step('a submitted evaluation becomes read-only', async () => {
      await expect(interviewer.getByText(/cannot be edited/)).toBeVisible();
      await expect(interviewer.getByLabel('Summary')).toBeDisabled();
    });

    await interviewerContext.close();
    await candidateContext.close();
  });

  test('a candidate cannot reach the question library or another interview', async ({ browser }) => {
    const suffix = unique();
    const interviewerContext = await browser.newContext();
    const interviewer = await interviewerContext.newPage();

    await registerOrg(interviewer, suffix);
    const questionTitle = `Echo the input ${suffix}`;
    await createQuestion(interviewer, questionTitle);
    const interviewId = await createInterview(interviewer, `E2E Round ${suffix}`, questionTitle);
    const inviteUrl = await inviteCandidate(interviewer, `candidate-${suffix}@e2e.test`);

    // A second interview the candidate is not part of.
    const otherId = await createInterview(interviewer, `Other Round ${suffix}`, questionTitle);

    const candidateContext = await browser.newContext();
    const candidate = await acceptInvitation(candidateContext, inviteUrl);
    await expect(candidate).toHaveURL(new RegExp(`/interviews/${interviewId}/workspace`));

    await test.step('the question library is not navigable', async () => {
      await candidate.goto('/questions');
      // The guard redirects a candidate to their own interview list.
      await expect(candidate).toHaveURL(/\/interviews$/);
    });

    await test.step('another interview is reported as not found', async () => {
      await candidate.goto(`/interviews/${otherId}`);
      await expect(candidate.getByText(/Could not load this interview/)).toBeVisible();
    });

    await test.step('settings pages are not navigable', async () => {
      await candidate.goto('/settings/team');
      await expect(candidate).toHaveURL(/\/interviews$/);
    });

    await interviewerContext.close();
    await candidateContext.close();
  });
});
