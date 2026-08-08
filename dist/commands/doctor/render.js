/**
 * Doctor's human-readable report renderer.
 *
 * It owns text formatting alone so the frozen output can be verified separately
 * from diagnosis and command registration.
 */
const STATUS_WIDTH = 8;
export const formatReport = (report) => {
    const lines = report.checks.flatMap((entry) => {
        const head = `${entry.status.padEnd(STATUS_WIDTH)}${entry.title} — ${entry.detail}`;
        const fixed = entry.fixed ? [`${' '.repeat(STATUS_WIDTH)}fixed by --fix`] : [];
        const fix = entry.fix === null
            ? []
            : entry.fix.split('\n').map((line) => `${' '.repeat(STATUS_WIDTH)}fix: ${line}`);
        return [head, ...fixed, ...fix];
    });
    return `${lines.join('\n')}\n`;
};
//# sourceMappingURL=render.js.map