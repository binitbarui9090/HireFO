import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './SplitPane.module.css';
function readStored(key, fallback) {
    if (!key)
        return fallback;
    try {
        const raw = localStorage.getItem(`hirefo.split.${key}`);
        const parsed = raw ? Number(raw) : Number.NaN;
        return Number.isFinite(parsed) ? parsed : fallback;
    }
    catch {
        return fallback;
    }
}
/**
 * Two resizable panes. Drag the divider with a pointer, or focus it and use the
 * arrow keys (Home/End snap to the limits) so the layout is reachable without a
 * mouse.
 */
export function SplitPane({ direction = 'horizontal', initial = 50, min = 15, max = 85, storageKey, first, second, ariaLabel = 'Resize panels', }) {
    const containerRef = useRef(null);
    const [size, setSize] = useState(() => readStored(storageKey, initial));
    const [dragging, setDragging] = useState(false);
    const clamp = useCallback((value) => Math.min(max, Math.max(min, value)), [min, max]);
    const commit = useCallback((value) => {
        const next = clamp(value);
        setSize(next);
        if (storageKey) {
            try {
                localStorage.setItem(`hirefo.split.${storageKey}`, String(next));
            }
            catch {
                /* private browsing */
            }
        }
    }, [clamp, storageKey]);
    useEffect(() => {
        if (!dragging)
            return;
        const onMove = (event) => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect)
                return;
            const ratio = direction === 'horizontal'
                ? ((event.clientX - rect.left) / rect.width) * 100
                : ((event.clientY - rect.top) / rect.height) * 100;
            setSize(clamp(ratio));
        };
        const onUp = () => {
            setDragging(false);
            commit(size);
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        // Keep the resize cursor while dragging over the panes themselves.
        const previousCursor = document.body.style.cursor;
        document.body.style.cursor = direction === 'horizontal' ? 'col-resize' : 'row-resize';
        document.body.style.userSelect = 'none';
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('pointerup', onUp);
            document.body.style.cursor = previousCursor;
            document.body.style.userSelect = '';
        };
    }, [dragging, direction, clamp, commit, size]);
    const onKeyDown = (event) => {
        const step = event.shiftKey ? 10 : 2;
        const decrease = direction === 'horizontal' ? 'ArrowLeft' : 'ArrowUp';
        const increase = direction === 'horizontal' ? 'ArrowRight' : 'ArrowDown';
        if (event.key === decrease)
            commit(size - step);
        else if (event.key === increase)
            commit(size + step);
        else if (event.key === 'Home')
            commit(min);
        else if (event.key === 'End')
            commit(max);
        else
            return;
        event.preventDefault();
    };
    return (_jsxs("div", { ref: containerRef, className: [styles.container, direction === 'horizontal' ? styles.horizontal : styles.vertical].join(' '), children: [_jsx("div", { className: styles.pane, style: { flex: `0 0 ${size}%` }, children: first }), _jsx("button", { type: "button", className: [
                    styles.handle,
                    direction === 'horizontal' ? styles.handleHorizontal : styles.handleVertical,
                    dragging ? styles.dragging : '',
                ]
                    .filter(Boolean)
                    .join(' '), onPointerDown: (event) => {
                    event.preventDefault();
                    setDragging(true);
                }, onKeyDown: onKeyDown, role: "separator", "aria-label": ariaLabel, "aria-orientation": direction === 'horizontal' ? 'vertical' : 'horizontal', "aria-valuenow": Math.round(size), "aria-valuemin": min, "aria-valuemax": max, tabIndex: 0 }), _jsx("div", { className: styles.pane, style: { flex: '1 1 0' }, children: second })] }));
}
