import { describe, expect, it } from 'vitest';
import { formatBytes, formatDuration, formatMs, formatNumber, formatUsd, initials, pluralise, titleCase, } from './format';
describe('formatDuration', () => {
    it('renders mm:ss below an hour', () => {
        expect(formatDuration(0)).toBe('0:00');
        expect(formatDuration(9_000)).toBe('0:09');
        expect(formatDuration(65_000)).toBe('1:05');
        expect(formatDuration(59 * 60_000 + 59_000)).toBe('59:59');
    });
    it('renders h:mm:ss at an hour and beyond', () => {
        expect(formatDuration(3_600_000)).toBe('1:00:00');
        expect(formatDuration(3_600_000 + 65_000)).toBe('1:01:05');
    });
    it('never renders a negative duration', () => {
        expect(formatDuration(-5_000)).toBe('0:00');
    });
    it('renders a dash for missing or non-finite input', () => {
        expect(formatDuration(null)).toBe('—');
        expect(formatDuration(undefined)).toBe('—');
        expect(formatDuration(Number.NaN)).toBe('—');
        expect(formatDuration(Number.POSITIVE_INFINITY)).toBe('—');
    });
});
describe('formatMs', () => {
    it('uses milliseconds below a second', () => {
        expect(formatMs(0)).toBe('0ms');
        expect(formatMs(142)).toBe('142ms');
        expect(formatMs(999)).toBe('999ms');
    });
    it('switches to seconds at a second', () => {
        expect(formatMs(1_000)).toBe('1.00s');
        expect(formatMs(1_234)).toBe('1.23s');
    });
    it('drops a decimal place for long durations', () => {
        expect(formatMs(12_345)).toBe('12.3s');
    });
    it('renders a dash for missing input', () => {
        expect(formatMs(null)).toBe('—');
    });
});
describe('formatBytes', () => {
    it('scales through B, KB and MB', () => {
        expect(formatBytes(512)).toBe('512 B');
        expect(formatBytes(1_024)).toBe('1.0 KB');
        expect(formatBytes(1_536)).toBe('1.5 KB');
        expect(formatBytes(1_048_576)).toBe('1.0 MB');
    });
    it('renders zero and missing input distinctly', () => {
        expect(formatBytes(0)).toBe('0 B');
        expect(formatBytes(null)).toBe('—');
    });
});
describe('formatUsd', () => {
    it('shows five decimals for sub-cent amounts, so tiny costs are not hidden as $0.00', () => {
        expect(formatUsd(0.00042)).toBe('$0.00042');
    });
    it('shows two decimals from a cent upwards', () => {
        expect(formatUsd(0.01)).toBe('$0.01');
        expect(formatUsd(12.5)).toBe('$12.50');
    });
    it('shows exactly zero plainly', () => {
        expect(formatUsd(0)).toBe('$0.00');
    });
    it('renders a dash for missing input', () => {
        expect(formatUsd(null)).toBe('—');
        expect(formatUsd(undefined)).toBe('—');
    });
});
describe('formatNumber', () => {
    it('groups thousands', () => {
        expect(formatNumber(1234567)).toBe((1234567).toLocaleString());
    });
    it('distinguishes zero from missing', () => {
        expect(formatNumber(0)).toBe('0');
        expect(formatNumber(null)).toBe('—');
    });
});
describe('titleCase', () => {
    it('converts the enum shapes the API returns', () => {
        expect(titleCase('IN_PROGRESS')).toBe('In Progress');
        expect(titleCase('DATA_STRUCTURES')).toBe('Data Structures');
        expect(titleCase('STRONG_YES')).toBe('Strong Yes');
        expect(titleCase('EASY')).toBe('Easy');
    });
    it('handles hyphens and extra whitespace', () => {
        expect(titleCase('no-hire  decision')).toBe('No Hire Decision');
    });
    it('returns an empty string unchanged', () => {
        expect(titleCase('')).toBe('');
    });
});
describe('initials', () => {
    it('takes the first and last initial', () => {
        expect(initials('Dana Okafor')).toBe('DO');
        expect(initials('Jules van der Berg')).toBe('JB');
    });
    it('takes two letters from a single name', () => {
        expect(initials('Sam')).toBe('SA');
    });
    it('handles extra whitespace', () => {
        expect(initials('  Sam   Rivera  ')).toBe('SR');
    });
    it('falls back to a question mark for empty input', () => {
        expect(initials('')).toBe('?');
        expect(initials('   ')).toBe('?');
    });
});
describe('pluralise', () => {
    it('uses the singular only for exactly one', () => {
        expect(pluralise(1, 'test')).toBe('test');
        expect(pluralise(0, 'test')).toBe('tests');
        expect(pluralise(2, 'test')).toBe('tests');
    });
    it('accepts an irregular plural', () => {
        expect(pluralise(2, 'person', 'people')).toBe('people');
        expect(pluralise(1, 'person', 'people')).toBe('person');
    });
});
