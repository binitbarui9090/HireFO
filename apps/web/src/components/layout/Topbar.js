import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Button } from '../ui/Button';
import { useThemeStore } from '../../store/theme';
import styles from './Topbar.module.css';
const themeIcon = { dark: '☾', light: '☀', system: '◐' };
const themeLabel = {
    dark: 'Dark theme',
    light: 'Light theme',
    system: 'Follows system theme',
};
export function Topbar({ title, subtitle, actions, onToggleSidebar, }) {
    const mode = useThemeStore((s) => s.mode);
    const cycle = useThemeStore((s) => s.cycle);
    return (_jsxs("header", { className: styles.topbar, children: [onToggleSidebar && (_jsx(Button, { variant: "ghost", size: "sm", iconOnly: true, onClick: onToggleSidebar, "aria-label": "Toggle navigation", children: "\u2630" })), _jsxs("div", { className: styles.titleGroup, children: [_jsx("h1", { className: styles.title, children: title }), subtitle && _jsx("span", { className: styles.subtitle, children: subtitle })] }), _jsxs("div", { className: styles.actions, children: [actions, _jsx(Button, { variant: "ghost", size: "sm", iconOnly: true, onClick: cycle, title: `${themeLabel[mode]} — click to change`, "aria-label": `${themeLabel[mode]}. Click to change theme.`, children: themeIcon[mode] })] })] }));
}
