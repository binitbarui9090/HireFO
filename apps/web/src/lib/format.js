/** Presentation helpers. Pure functions, unit-tested in format.test.ts. */
export function formatDateTime(value) {
    if (!value)
        return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime()))
        return '—';
    return date.toLocaleString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
    });
}
export function formatDate(value) {
    if (!value)
        return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime()))
        return '—';
    return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
export function formatRelative(value) {
    if (!value)
        return '—';
    const date = typeof value === 'string' ? new Date(value) : value;
    if (Number.isNaN(date.getTime()))
        return '—';
    const diffSeconds = Math.round((date.getTime() - Date.now()) / 1000);
    const units = [
        ['second', 60],
        ['minute', 60],
        ['hour', 24],
        ['day', 7],
        ['week', 4.35],
        ['month', 12],
        ['year', Number.POSITIVE_INFINITY],
    ];
    let scaled = diffSeconds;
    for (const [unit, limit] of units) {
        if (Math.abs(scaled) < limit || unit === 'year') {
            return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(Math.round(scaled), unit);
        }
        scaled /= limit;
    }
    return formatDate(date);
}
/** mm:ss, or h:mm:ss once past an hour. */
export function formatDuration(ms) {
    if (ms === null || ms === undefined || !Number.isFinite(ms))
        return '—';
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n) => String(n).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${minutes}:${pad(seconds)}`;
}
export function formatMs(ms) {
    if (ms === null || ms === undefined)
        return '—';
    if (ms < 1000)
        return `${Math.round(ms)}ms`;
    return `${(ms / 1000).toFixed(ms < 10_000 ? 2 : 1)}s`;
}
export function formatBytes(bytes) {
    if (bytes === null || bytes === undefined)
        return '—';
    if (bytes < 1024)
        return `${bytes} B`;
    if (bytes < 1024 * 1024)
        return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
export function formatUsd(amount) {
    if (amount === null || amount === undefined)
        return '—';
    if (amount === 0)
        return '$0.00';
    if (amount < 0.01)
        return `$${amount.toFixed(5)}`;
    return `$${amount.toFixed(2)}`;
}
export function formatNumber(value) {
    if (value === null || value === undefined)
        return '—';
    return value.toLocaleString();
}
export function titleCase(value) {
    return value
        .toLowerCase()
        .split(/[\s_-]+/)
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(' ');
}
export function initials(name) {
    const parts = name.trim().split(/\s+/).filter(Boolean);
    if (parts.length === 0)
        return '?';
    if (parts.length === 1)
        return parts[0].slice(0, 2).toUpperCase();
    return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
export function pluralise(count, singular, plural) {
    return count === 1 ? singular : (plural ?? `${singular}s`);
}
