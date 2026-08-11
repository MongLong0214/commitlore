/**
 * Surgical configuration support for the Hermes host profile.
 *
 * Hermes' own `mcp add` command parses and re-emits all of config.yaml. That
 * is useful for its interactive editor, but it is the wrong ownership boundary
 * for an installer: comments, ordering and unrelated operator settings (most
 * importantly approvals) must survive byte-for-byte. These helpers recognise
 * only the ordinary block-style YAML that this installer writes, and otherwise
 * leave the file alone with a reason instead of guessing at a rewrite.
 */
import { relative, resolve, sep } from 'node:path';
export const HERMES_SERVER_KEY = 'commitlore';
const splitLines = (contents) => {
    const lines = [];
    let position = 0;
    const matcher = /([^\r\n]*)(\r\n|\n|\r)/g;
    let match;
    while ((match = matcher.exec(contents)) !== null) {
        lines.push({ text: match[1] ?? '', ending: match[2] ?? '' });
        position = matcher.lastIndex;
    }
    if (position < contents.length)
        lines.push({ text: contents.slice(position), ending: '' });
    return lines;
};
const joinLines = (lines) => lines.map((line) => `${line.text}${line.ending}`).join('');
const newlineOf = (contents) => (contents.includes('\r\n') ? '\r\n' : '\n');
const isTopLevelContent = (line) => line.length > 0 && !/^\s/.test(line) && !line.trimStart().startsWith('#');
const headerFor = (key) => new RegExp(`^${key}:\\s*(?:#.*)?$`);
const potentialHeaderFor = (key) => new RegExp(`^${key}:`);
const findSection = (lines, key) => {
    const start = lines.findIndex((line) => headerFor(key).test(line.text));
    if (start === -1)
        return lines.some((line) => potentialHeaderFor(key).test(line.text)) ? 'complex' : null;
    let end = start + 1;
    while (end < lines.length && !isTopLevelContent(lines[end]?.text ?? ''))
        end += 1;
    return { start, end };
};
const insertBeforeLine = (contents, lineIndex, block) => {
    const lines = splitLines(contents);
    const offset = lines.slice(0, lineIndex).reduce((total, line) => total + line.text.length + line.ending.length, 0);
    const prefix = lineIndex === lines.length && contents.length > 0 && !/\r$|\n$/.test(contents) ? newlineOf(contents) : '';
    return `${contents.slice(0, offset)}${prefix}${block}${contents.slice(offset)}`;
};
const removeLines = (contents, from, to) => {
    const lines = splitLines(contents);
    return joinLines([...lines.slice(0, from), ...lines.slice(to)]);
};
const yamlString = (value) => JSON.stringify(value);
const scalarValue = (value) => {
    const trimmed = value.trim();
    try {
        const parsed = JSON.parse(trimmed);
        return typeof parsed === 'string' ? parsed : null;
    }
    catch {
        if (/^[^\s#][^#]*$/.test(trimmed))
            return trimmed.trimEnd();
        return null;
    }
};
const childStart = (lines, section, key) => {
    const matcher = new RegExp(`^  ${key}:\\s*(?:#.*)?$`);
    for (let index = section.start + 1; index < section.end; index += 1) {
        if (matcher.test(lines[index]?.text ?? ''))
            return index;
    }
    return null;
};
const childEnd = (lines, start, sectionEnd) => {
    let end = start + 1;
    while (end < sectionEnd) {
        const line = lines[end]?.text ?? '';
        if (/^  [^\s#][^:]*:/.test(line))
            break;
        end += 1;
    }
    return end;
};
/**
 * Recognise exactly the small MCP mapping this installer owns.  Similar is not
 * enough: an operator may have added environment, timeout, or transport
 * settings to a server with the same name, and removing or claiming that
 * mapping would be a clobber.  Blank lines and comments after the mapping are
 * intentionally tolerated and left in place by removal.
 */
const ownMcpBlockEnd = (lines, start, end, wrapperPath) => {
    const wrappers = typeof wrapperPath === 'string' ? [wrapperPath] : wrapperPath;
    const expectedCommands = new Set(wrappers.map((path) => `    command: ${yamlString(path)}`));
    const expected = ['  commitlore:', undefined, '    args:', '      - mcp', '    enabled: true'];
    if (lines[start]?.text !== expected[0] ||
        !expectedCommands.has(lines[start + 1]?.text ?? '') ||
        lines[start + 2]?.text !== expected[2] ||
        lines[start + 3]?.text !== expected[3] ||
        lines[start + 4]?.text !== expected[4]) {
        return null;
    }
    for (const line of lines.slice(start + 5, end)) {
        const trimmed = line.text.trim();
        if (trimmed.length > 0 && !trimmed.startsWith('#'))
            return null;
    }
    return start + 5;
};
const hasOwnMcpEntry = (lines, start, end, wrapperPath) => ownMcpBlockEnd(lines, start, end, wrapperPath) !== null;
const mcpBlock = (wrapperPath, newline) => [
    '  commitlore:',
    `    command: ${yamlString(wrapperPath)}`,
    '    args:',
    '      - mcp',
    '    enabled: true',
    '',
].join(newline);
const skillsBlock = (skillsDir, newline) => ['  external_dirs:', `    - ${yamlString(skillsDir)}`, ''].join(newline);
const topLevelMcpBlock = (wrapperPath, newline) => [`mcp_servers:`, mcpBlock(wrapperPath, newline)].join(newline);
const topLevelSkillsBlock = (skillsDir, newline) => [`skills:`, skillsBlock(skillsDir, newline)].join(newline);
export const isManagedHermesSkillsDir = (value, dataRoot, installedSkillsDir) => {
    if (installedSkillsDir !== undefined && resolve(value) === resolve(installedSkillsDir))
        return true;
    const rel = relative(resolve(dataRoot), resolve(value));
    const parts = rel.split(sep);
    return parts.length === 3 && parts[0] !== '' && parts[0] !== '..' && !parts[0]?.startsWith('..') && parts[1] === 'hermes' && parts[2] === 'skills';
};
export const addHermesConfig = (contents, options) => {
    const added = [];
    const unchanged = [];
    const blocked = [];
    const newline = newlineOf(contents);
    let next = contents;
    {
        const lines = splitLines(next);
        const section = findSection(lines, 'mcp_servers');
        if (section === 'complex') {
            blocked.push('mcp_servers is not a block-style YAML mapping, so it was left unchanged');
        }
        else if (section === null) {
            next = insertBeforeLine(next, lines.length, topLevelMcpBlock(options.wrapperPath, newline));
            added.push('mcp');
        }
        else {
            const start = childStart(lines, section, HERMES_SERVER_KEY);
            if (start !== null) {
                const end = childEnd(lines, start, section.end);
                if (hasOwnMcpEntry(lines, start, end, options.wrapperPath))
                    unchanged.push('mcp');
                else
                    blocked.push('mcp_servers.commitlore already exists but does not point at this CommitLore install');
            }
            else {
                next = insertBeforeLine(next, section.end, mcpBlock(options.wrapperPath, newline));
                added.push('mcp');
            }
        }
    }
    {
        const lines = splitLines(next);
        const section = findSection(lines, 'skills');
        if (section === 'complex') {
            blocked.push('skills is not a block-style YAML mapping, so it was left unchanged');
        }
        else if (section === null) {
            next = insertBeforeLine(next, lines.length, topLevelSkillsBlock(options.skillsDir, newline));
            added.push('skills');
        }
        else {
            const start = childStart(lines, section, 'external_dirs');
            if (start === null) {
                next = insertBeforeLine(next, section.end, skillsBlock(options.skillsDir, newline));
                added.push('skills');
            }
            else {
                const end = childEnd(lines, start, section.end);
                let exact = false;
                let replacement = null;
                let unsupported = false;
                for (let index = start + 1; index < end; index += 1) {
                    const line = lines[index]?.text ?? '';
                    const match = /^    -\s+(.+)$/.exec(line);
                    if (match === null) {
                        if (line.trim().length > 0 && !line.trimStart().startsWith('#'))
                            unsupported = true;
                        continue;
                    }
                    const value = scalarValue(match[1] ?? '');
                    if (value === options.skillsDir)
                        exact = true;
                    if (value !== null &&
                        options.dataRoot !== undefined &&
                        isManagedHermesSkillsDir(value, options.dataRoot) &&
                        value !== options.skillsDir) {
                        replacement = index;
                    }
                }
                if (unsupported) {
                    blocked.push('skills.external_dirs is not a simple YAML list, so it was left unchanged');
                }
                else if (exact) {
                    unchanged.push('skills');
                }
                else if (replacement !== null) {
                    const rewritten = [...lines];
                    const old = rewritten[replacement];
                    if (old !== undefined)
                        rewritten[replacement] = { text: `    - ${yamlString(options.skillsDir)}`, ending: old.ending };
                    next = joinLines(rewritten);
                    added.push('skills');
                }
                else {
                    next = insertBeforeLine(next, end, `    - ${yamlString(options.skillsDir)}${newline}`);
                    added.push('skills');
                }
            }
        }
    }
    return { contents: next, added, unchanged, blocked };
};
export const removeHermesConfig = (contents, options) => {
    const removed = [];
    let next = contents;
    {
        const lines = splitLines(next);
        const section = findSection(lines, 'mcp_servers');
        if (section !== null && section !== 'complex') {
            const start = childStart(lines, section, HERMES_SERVER_KEY);
            if (start !== null) {
                const end = childEnd(lines, start, section.end);
                const ownEnd = ownMcpBlockEnd(lines, start, end, options.wrapperPath);
                if (ownEnd !== null) {
                    next = removeLines(next, start, ownEnd);
                    removed.push('mcp');
                }
            }
        }
    }
    {
        const lines = splitLines(next);
        const section = findSection(lines, 'skills');
        if (section !== null && section !== 'complex') {
            const start = childStart(lines, section, 'external_dirs');
            if (start !== null) {
                const end = childEnd(lines, start, section.end);
                const indexes = [];
                for (let index = start + 1; index < end; index += 1) {
                    const match = /^    -\s+(.+)$/.exec(lines[index]?.text ?? '');
                    const value = match === null ? null : scalarValue(match[1] ?? '');
                    if (value !== null && isManagedHermesSkillsDir(value, options.dataRoot, options.installedSkillsDir)) {
                        indexes.push(index);
                    }
                }
                if (indexes.length > 0) {
                    next = joinLines(lines.filter((_, index) => !indexes.includes(index)));
                    removed.push('skills');
                }
            }
        }
    }
    return { contents: next, removed };
};
//# sourceMappingURL=hermes-config.js.map