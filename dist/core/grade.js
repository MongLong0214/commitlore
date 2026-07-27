/**
 * Trust grading (SPEC §7, ADR-0005): the gate between what a commit *says* and
 * what an agent is allowed to *do*.
 *
 * A commit message is an instruction channel. Anyone who can land a commit —
 * including a fork PR author nobody has ever met — can write `Warn:` text that
 * an agent will read as if the repository itself said it. This module is the
 * minimum defence: every record is graded on the two axes of SPEC §7
 * (provenance × lifecycle) plus author trust, and `Warn:` only survives as a
 * `directive` when all three hold. Everything else degrades to `claim`
 * (surfaced as information, never as an order) or `blocked` (kept out of the
 * injection payload entirely).
 *
 * Every default here fails closed. No `trustedAuthors` means nobody is trusted;
 * an unreadable `Provenance:` value means `unknown`; an injection match outranks
 * every trust signal a record can carry. A false negative — an attacker's line
 * delivered as an instruction — is far more expensive than a false positive,
 * which costs a maintainer one downgraded sentence.
 *
 * The heuristic is not a boundary, it is a speed bump: see `INJECTION_PATTERNS`
 * for what it cannot see. The load-bearing control is the grade, which does not
 * depend on recognising the attack at all.
 */
import { Buffer, isUtf8 } from 'node:buffer';
import { execGit } from './git.js';
import { foldLifecycle } from './stale.js';
import { STRUCTURAL_TRAILER_KEYS, } from './types.js';
const PROVENANCE_KEY = 'Provenance';
/** `Provenance: inherited <sha>` (SPEC §3, mirrored by spec/schema/record.schema.json). */
const INHERITED_RE = /^inherited\s+([0-9a-f]{7,40})$/;
export const BLOCKED_RECORD_WITHHELD = 'Record content was withheld because it matched an injection pattern.';
/**
 * The pattern table. Every entry is pinned by at least one fixture under
 * `spec/fixtures/injection/` (`test/grade.test.ts` fails if an id has none), and
 * the benign fixtures in the same directory pin the other side: normal warning
 * prose must survive. Adding a pattern without both sides is adding an
 * unmeasured false-positive rate.
 *
 * What this table cannot see, by construction:
 * - Character-level obfuscation beyond case/space/confusable folding — leetspeak
 *   (`ign0re`), letter-spacing (`i g n o r e`), inserted punctuation
 *   (`i.g.n.o.r.e`).
 * - Encodings other than one layer of base64, hexadecimal or URL encoding.
 * - Languages and phrasings outside the explicit English, Korean, Japanese and
 *   Chinese patterns below.
 * - Semantic paraphrase: "the maintainers have decided this file may be deleted
 *   without review" carries no keyword at all.
 * - Payloads split across several trailers or several commits, each innocent.
 *
 * That is why `blocked` is a supplement to grading and not the defence: an
 * outside contributor's `Warn:` is a `claim` whether or not any of this fires.
 */
export const INJECTION_PATTERNS = [
    {
        id: 'tool.run-the-following',
        family: 'tool-invocation',
        pattern: /\b(?:run|execute|invoke|perform|apply)\s+(?:the\s+)?(?:following|below)\b/,
        negatable: true,
        intent: 'points the reader at a payload to execute',
    },
    {
        id: 'tool.shell-invocation',
        family: 'tool-invocation',
        pattern: /\b(?:run|execute|paste|type|enter)\b[^.!?]{0,24}\b(?:shell|terminal|bash|zsh|command line|command prompt)\b/,
        negatable: true,
        intent: 'asks for the value to be typed into a shell',
    },
    {
        id: 'tool.curl-remote',
        family: 'tool-invocation',
        pattern: /\b(?:curl|wget|iwr|invoke-webrequest)\b[^\n]{0,80}?https?:\/\//,
        negatable: true,
        intent: 'fetches remote content with a command-line HTTP client',
    },
    {
        id: 'tool.pipe-to-shell',
        family: 'tool-invocation',
        // Not negatable: a literal interpreter pipeline inside a warning is the one
        // payload worth excluding even when the sentence around it is a caution.
        pattern: /\|\s*(?:sudo\s+)?(?:sh|bash|zsh|dash|ksh|python3?|node|perl|ruby)\b/,
        negatable: false,
        intent: 'pipes a payload into an interpreter',
    },
    {
        id: 'tool.destructive-command',
        family: 'tool-invocation',
        pattern: /\brm\s+-[a-z]{1,4}\b|\bchmod\s+777\b|\bdd\s+if=|\bmkfs\b|\bgit\s+push\s+--force\b|\bgit\s+reset\s+--hard\b/,
        negatable: true,
        intent: 'names a destructive command verbatim',
    },
    {
        id: 'bypass.ignore-previous',
        family: 'policy-bypass',
        pattern: /\b(?:ignore|disregard|forget|override|discard|bypass)\s+(?:(?:all|any|the|your|these|those|my|other|earlier)\s+){0,3}(?:previous|prior|earlier|above|preceding|foregoing|system)\b/,
        negatable: true,
        intent: 'tells the agent to drop the instructions it already has',
    },
    {
        id: 'bypass.ignore-previous.ko',
        family: 'policy-bypass',
        pattern: /(?:이전|앞선|기존|위의)\s*(?:모든\s*)?(?:지시|지침|명령)(?:을|를)?\s*(?:모두\s*)?(?:무시(?:하고|하라|해라|해|하세요|하십시오|해줘)|잊어(?:버리고|라|주세요)|폐기(?:하고|하라|해라))(?!서는?\s*안|면\s*안|지\s*마)/,
        negatable: false,
        intent: 'tells the agent in Korean to drop earlier instructions',
    },
    {
        id: 'bypass.ignore-previous.ja',
        family: 'policy-bypass',
        pattern: /(?:以前|前|先ほど|上記)(?:の)?(?:すべて|全て|全部)?(?:の)?(?:指示|命令|プロンプト)(?:を)?(?:すべて|全て|全部)?(?:無視|忘れ|破棄)(?:しろ|せよ|して|してください)(?!はいけ(?:ません|ない)|はなら(?:ない|ぬ))/,
        negatable: false,
        intent: 'tells the agent in Japanese to drop earlier instructions',
    },
    {
        id: 'bypass.ignore-previous.zh',
        family: 'policy-bypass',
        pattern: /(?<!不要)(?<!不得)(?<!禁止)(?<!请勿)(?<!請勿)(?<!切勿)(?:忽略|无视|無視|忘记|忘記|丢弃|丟棄|覆盖|覆蓋)(?:此前|之前|以前|先前|上述)(?:的)?(?:所有|全部)?(?:系统|系統)?(?:指令|指示|提示|命令)/,
        negatable: true,
        intent: 'tells the agent in Chinese to drop earlier instructions',
    },
    {
        id: 'bypass.new-instructions',
        family: 'policy-bypass',
        pattern: /\b(?:your|the)\s+(?:new|updated|revised|real|actual|true)\s+(?:system\s+)?(?:instruction|instructions|prompt|directive|directives)\b/,
        negatable: true,
        intent: 'claims to replace the agent’s instructions',
    },
    {
        id: 'bypass.role-marker',
        family: 'policy-bypass',
        // A chat role marker inside a commit trailer is never prose; it is an
        // attempt to forge a turn boundary in whatever transcript the record lands in.
        pattern: /\b(?:system|assistant|developer)\s*:\s*(?:you\b|do\b|ignore\b|always\b|never\b|new\b|from now\b)/,
        negatable: false,
        intent: 'forges a chat role boundary',
    },
    {
        id: 'bypass.persona-override',
        family: 'policy-bypass',
        pattern: /\byou are (?:now|no longer|actually|really)\b|\b(?:from now on|henceforth)\b[^.!?]{0,20}\byou\b|\b(?:act|behave)\s+as\s+(?:a|an|the|if)\b|\bpretend\s+(?:to\s+be|that|you)\b/,
        negatable: true,
        intent: 'reassigns the agent’s role',
    },
    {
        id: 'privilege.sudo',
        family: 'privilege-escalation',
        // The lookahead keeps "requires sudo access on the build box" — a statement
        // about privilege — out of "sudo <command>", a request for it.
        pattern: /\bsudo\s+(?!access\b|privilege|privileges\b|rights\b|permission|permissions\b|is\b|was\b|required\b|needed\b|user\b)[a-z0-9_./-]+/,
        negatable: true,
        intent: 'invokes a command with sudo',
    },
    {
        id: 'privilege.as-root',
        family: 'privilege-escalation',
        pattern: /\b(?:run|execute|launch|start|install|deploy|apply)\b[^.!?]{0,24}\bas\s+(?:root|admin|administrator|superuser)\b|\bwith\s+(?:root|admin|administrator|superuser|elevated)\s+(?:rights|privileges|access|permission|permissions)\b/,
        negatable: true,
        intent: 'asks for the work to be done with elevated privileges',
    },
    {
        id: 'credential.print-env',
        family: 'credential-exfiltration',
        pattern: /\b(?:print|echo|output|show|display|dump|reveal|cat|send|post|upload|paste|list)\b[^.!?]{0,24}\b(?:env|envs|\.env|dotenv|environment|environment variable|environment variables)\b/,
        negatable: true,
        intent: 'asks for the environment to be printed',
    },
    {
        id: 'credential.exfiltrate-secret',
        family: 'credential-exfiltration',
        pattern: /\b(?:print|echo|output|show|display|dump|reveal|send|share|paste|upload|post|exfiltrate|leak|email)\b[^.!?]{0,32}\b(?:api[ -]?keys?|secrets?|tokens?|credentials?|passwords?|private key|ssh key|access key)\b/,
        negatable: true,
        intent: 'asks for a credential to be emitted or sent somewhere',
    },
    {
        id: 'credential.exfiltrate-secret.ko',
        family: 'credential-exfiltration',
        pattern: /(?:비밀|토큰|암호|비밀번호|자격\s*증명|api\s*키|개인\s*키|ssh\s*키|\.ssh\/id_rsa|id_rsa)[^.!?\n。！？]{0,32}(?:출력|공개|노출|전송)(?:하라|해라|해|하세요|하십시오|해줘)/,
        negatable: false,
        intent: 'asks in Korean for a credential to be emitted or sent',
    },
    {
        id: 'output.always-comply',
        family: 'output-manipulation',
        pattern: /\b(?:always|automatically)\s+(?:answer|reply|respond|say|approve|confirm|accept|output)\b|\bauto-?approve\b|\bapprove\s+(?:everything|all|any)\b/,
        negatable: true,
        intent: 'pre-commits the agent to an answer',
    },
    {
        id: 'output.conceal',
        family: 'output-manipulation',
        pattern: /\b(?:hide|conceal|suppress|omit|obscure)\s+(?:this|that|it|these|the\s+(?:fact|change|edit|diff|output|reason|error|warning|record))\b/,
        negatable: true,
        intent: 'asks for part of the work to be hidden',
    },
    {
        id: 'output.no-disclosure',
        family: 'output-manipulation',
        // Negation is inside the pattern, so the negation guard must not apply:
        // "do not report this" is the attack, not a warning about one.
        pattern: /\b(?:do not|dont|never|no need to)\s+(?:mention|report|reveal|disclose|tell|inform|surface)\s+(?:\w+\s+){0,2}?(?:this|that|it|anyone|anything|users?|humans?)\b/,
        negatable: false,
        intent: 'asks the agent not to disclose what it did',
    },
];
/** Words that disarm an affirmative imperative when they sit right before it. */
const NEGATIONS = new Set([
    'no',
    'not',
    'never',
    'dont',
    'doesnt',
    'didnt',
    'wont',
    'cant',
    'cannot',
    'shouldnt',
    'mustnt',
    'avoid',
    'avoids',
    'avoiding',
    'without',
    'refuse',
    'forbid',
    'forbidden',
    'prohibited',
]);
/** How many words before a match the negation guard reads. */
const NEGATION_LOOKBACK = 2;
/** Invisible characters: they change nothing on screen and everything to a regex. */
const INVISIBLE_RE = /[\u00AD\u180E\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF]/g;
/** ANSI CSI sequences, removed whole so stripping cannot join an attack after grading. */
const ANSI_ESCAPE_RE = /\u001B\[[0-?]*[ -/]*[@-~]/g;
/** Combining marks removed from Latin letters — `íg̃nore` must fold to `ignore`. */
const COMBINING_RE = /\p{M}/gu;
const LATIN_CLUSTER_RE = /\p{Script=Latin}\p{M}*/gu;
const stripTransportNoise = (text) => text.replace(ANSI_ESCAPE_RE, '').replace(INVISIBLE_RE, '');
/**
 * Latin lookalikes from other scripts. NFKC does not touch these (they are
 * distinct letters, not compatibility forms), so `іgnоrе` — Cyrillic і and о and
 * е — sails past every ASCII pattern until it is folded here.
 */
const CONFUSABLES = new Map([
    ['а', 'a'], // а CYRILLIC
    ['е', 'e'], // е
    ['к', 'k'], // к
    ['н', 'h'], // н
    ['о', 'o'], // о
    ['р', 'p'], // р
    ['с', 'c'], // с
    ['т', 't'], // т
    ['у', 'y'], // у
    ['х', 'x'], // х
    ['ѕ', 's'], // ѕ
    ['і', 'i'], // і
    ['ј', 'j'], // ј
    ['һ', 'h'], // һ
    ['ӏ', 'l'], // ӏ
    ['ԁ', 'd'], // ԁ
    ['ԛ', 'q'], // ԛ
    ['ԝ', 'w'], // ԝ
    ['α', 'a'], // α GREEK
    ['ε', 'e'], // ε
    ['ι', 'i'], // ι
    ['κ', 'k'], // κ
    ['ν', 'v'], // ν
    ['ο', 'o'], // ο
    ['ρ', 'p'], // ρ
    ['τ', 't'], // τ
    ['υ', 'u'], // υ
    ['χ', 'x'], // χ
    ['ı', 'i'], // ı DOTLESS I
    ['ɡ', 'g'], // ɡ SCRIPT G
    ['‘', ''], // curly quotes: dropped so don’t folds to dont
    ['’', ''],
    ['ʼ', ''],
    ["'", ''],
    ['`', ''],
    ['´', ''],
    ['‐', '-'], // dash family
    ['‑', '-'],
    ['‒', '-'],
    ['–', '-'],
    ['—', '-'],
    ['―', '-'],
]);
/**
 * Folds a value to the form the patterns are written against.
 *
 * The order is load-bearing. NFKC first, which collapses the cheap evasions in
 * one step: fullwidth (`ｉｇｎｏｒｅ`), mathematical alphanumerics (`𝐢𝐠𝐧𝐨𝐫𝐞`),
 * ligatures. Then invisibles, which would otherwise split a word in the middle
 * (`ig​nore`). Then case, then accents, then cross-script lookalikes, and
 * finally whitespace — so `IGNORE  PREVIOUS` and `ignore previous` are the same
 * string by the time any pattern sees them. Accent folding is limited to Latin
 * letters so Hangul and kana retain the characters multilingual patterns use.
 *
 * Match-only: the result is not safe to display.
 */
export const normalizeForMatch = (text) => {
    const folded = stripTransportNoise(text.normalize('NFKC'))
        .toLowerCase()
        .replace(LATIN_CLUSTER_RE, (cluster) => cluster.normalize('NFD').replace(COMBINING_RE, ''));
    let mapped = '';
    for (const char of folded)
        mapped += CONFUSABLES.get(char) ?? char;
    return mapped.replace(/\s+/g, ' ').trim();
};
const URL_ESCAPE_RE = /%[0-9a-f]{2}/i;
const URL_RUN_RE = /(?:%[0-9a-f]{2})+/gi;
const BASE64_TOKEN_RE = /(?<![a-z0-9+/_-])[a-z0-9+/_-]{16,}=*(?![a-z0-9+/_=-])/gi;
const PADDED_BASE64_PREFIX_RE = /(?<![a-z0-9+/_-])[a-z0-9+/_-]{16,}=+/gi;
const WRAPPED_BASE64_TOKEN_RE = /(?<![a-z0-9+/_-])(?:(?:[a-z0-9+/_-]{4})+[ \t\r\n]+)+(?:[a-z0-9+/_-]{4})+(?:[a-z0-9+/_-]{2,3}=*)?(?![a-z0-9+/_=-])/gi;
const HEX_TOKEN_RE = /(?<![0-9a-f])(?:0x)?([0-9a-f]{16,})(?![0-9a-f])/gi;
const CONTROL_RE = /[\u0000-\u001F\u007F-\u009F]/g;
const addDecoded = (decoded, bytes) => {
    if (!isUtf8(bytes))
        return;
    const text = bytes.toString('utf8');
    if (text !== '')
        decoded.add(text);
};
/** One speculative decode layer; failure never replaces the original text. */
const decodedCandidates = (text) => {
    const decoded = new Set();
    if (URL_ESCAPE_RE.test(text)) {
        decoded.add(text.replace(URL_RUN_RE, (run) => {
            const bytes = Buffer.from(run.replaceAll('%', ''), 'hex');
            return bytes.toString('utf8');
        }));
    }
    for (const scanner of [
        BASE64_TOKEN_RE,
        PADDED_BASE64_PREFIX_RE,
        WRAPPED_BASE64_TOKEN_RE,
    ]) {
        for (const match of text.matchAll(scanner)) {
            const token = match[0].replace(/\s+/g, '').replace(/=+$/, '');
            for (let trim = 0; trim <= 3 && token.length - trim >= 16; trim += 1) {
                const candidate = token.slice(0, trim === 0 ? undefined : -trim);
                if (candidate.length % 4 !== 1) {
                    addDecoded(decoded, Buffer.from(candidate, 'base64'));
                }
            }
        }
    }
    for (const match of text.matchAll(HEX_TOKEN_RE)) {
        const token = match[1];
        if (token !== undefined && token.length % 2 === 0) {
            addDecoded(decoded, Buffer.from(token, 'hex'));
        }
    }
    return [...decoded];
};
/** Whether a nearby CJK prohibition or one of the preceding English words disarms a match. */
const CJK_NEGATION_RE = /(?:不要|不得|禁止|请勿|請勿|切勿)[^。！？.!?\n]{0,8}$/u;
const isNegated = (haystack, index, matchedText) => {
    const prefix = haystack.slice(0, index);
    if (CJK_NEGATION_RE.test(prefix))
        return true;
    if (/[^\x00-\x7F]/u.test(matchedText))
        return false;
    const words = prefix.split(/[^a-z0-9]+/).filter((word) => word !== '');
    return words.slice(-NEGATION_LOOKBACK).some((word) => NEGATIONS.has(word));
};
const fires = (haystack, entry) => {
    // Built fresh so the exported table stays free of `g`-flag lastIndex state,
    // which a caller reading INJECTION_PATTERNS could otherwise trip over.
    const scanner = new RegExp(entry.pattern.source, 'g');
    for (const match of haystack.matchAll(scanner)) {
        if (match.index === undefined)
            continue;
        if (!entry.negatable || !isNegated(haystack, match.index, match[0]))
            return true;
    }
    return false;
};
/**
 * Every pattern id `text` trips, in table order. `[]` means nothing matched —
 * which is not the same as "safe", only "not recognised" (see
 * `INJECTION_PATTERNS`).
 *
 * Exported so consumers can scan text that is not part of a record too.
 */
export const scanInjection = (text) => {
    const prepared = stripTransportNoise(text);
    const candidates = [prepared, ...decodedCandidates(prepared)];
    const haystacks = [
        ...new Set(candidates.flatMap((candidate) => [
            normalizeForMatch(candidate),
            normalizeForMatch(stripTransportNoise(candidate).replace(CONTROL_RE, '')),
        ])),
    ];
    return INJECTION_PATTERNS.filter((entry) => haystacks.some((haystack) => fires(haystack, entry))).map((entry) => entry.id);
};
const trailerValues = (trailers, key) => trailers.filter((trailer) => trailer.key === key).map((trailer) => trailer.value);
const scanRecord = (record) => {
    const matchedPatterns = new Set();
    const matchedKeys = new Set();
    for (const trailer of record.trailers) {
        if (STRUCTURAL_TRAILER_KEYS.has(trailer.key))
            continue;
        const patterns = scanInjection(trailer.value);
        if (patterns.length === 0)
            continue;
        matchedKeys.add(trailer.key);
        patterns.forEach((pattern) => matchedPatterns.add(pattern));
    }
    return {
        patterns: INJECTION_PATTERNS.filter((entry) => matchedPatterns.has(entry.id)).map((entry) => entry.id),
        keys: [...matchedKeys],
    };
};
/**
 * The record's provenance, from its own field when the caller resolved one and
 * from `Provenance:` otherwise. Absent, malformed, or unrecognised all land on
 * `unknown`: a value this module cannot read is a value it cannot trust, and
 * `unknown` is the reading that costs least when it is wrong.
 */
const provenanceOf = (record) => {
    if (record.provenance !== undefined)
        return record.provenance;
    const raw = trailerValues(record.trailers, PROVENANCE_KEY)[0]?.trim();
    if (raw === undefined)
        return { kind: 'unknown' };
    if (raw === 'authored')
        return { kind: 'authored' };
    if (raw === 'reconstructed')
        return { kind: 'reconstructed' };
    const inherited = INHERITED_RE.exec(raw);
    const sha = inherited?.[1];
    if (sha !== undefined)
        return { kind: 'inherited', sha };
    return { kind: 'unknown' };
};
/**
 * The lifecycle to grade against.
 *
 * A non-`active` state always wins, whichever source it came from. The caller's
 * `record.lifecycle` may have been folded over a longer history than the stream
 * handed to `gradeAll`, and the fold may see a supersession the single record
 * cannot — taking the more restrictive of the two means neither view can quietly
 * promote a retired record back to `active`.
 */
const lifecycleOf = (record, at, folded) => {
    if (record.lifecycle !== undefined && record.lifecycle !== 'active')
        return record.lifecycle;
    if (folded !== undefined)
        return folded;
    if (record.lifecycle !== undefined)
        return record.lifecycle;
    // No stream context: the record can still expire on its own `Expires:` date.
    return foldLifecycle([record], { at })[0]?.lifecycle ?? 'active';
};
/** `Name <email>` splits into the whole string, the name, and the email. */
const AUTHOR_EMAIL_RE = /^(.*?)\s*<([^>]+)>$/;
const identitiesOf = (author) => {
    const trimmed = author.trim();
    const match = AUTHOR_EMAIL_RE.exec(trimmed);
    if (match === null)
        return [trimmed];
    const name = match[1]?.trim() ?? '';
    const email = match[2]?.trim() ?? '';
    return [trimmed, name, email].filter((identity) => identity !== '');
};
/**
 * Whether `author` is on the repository's trusted list.
 *
 * Undefined or empty `trustedAuthors` trusts nobody. That default is the
 * feature: a caller that forgets to pass the list gets every record downgraded
 * to `claim`, which is loud and harmless — the opposite default would turn the
 * check off silently. There is no wildcard entry; `*` in the list matches an
 * author literally called `*`.
 *
 * Comparison is exact after trimming, with `Name <email>` also matching on
 * either half. An identity that differs by case does not match, and degrades to
 * `claim` — the safe direction for a misconfigured list.
 */
export const isTrustedAuthor = (author, trustedAuthors) => {
    if (author === undefined || trustedAuthors === undefined)
        return false;
    const trusted = new Set(trustedAuthors.map((entry) => entry.trim()).filter((entry) => entry !== ''));
    if (trusted.size === 0)
        return false;
    return identitiesOf(author).some((identity) => trusted.has(identity));
};
const quoted = (value) => JSON.stringify(value);
const grade = (input, ctx) => {
    const { record, author, folded } = input;
    const provenance = provenanceOf(record).kind;
    const lifecycle = lifecycleOf(record, ctx.at, folded);
    const matched = scanRecord(record);
    // Checked first and unconditionally: a payload written by a trusted author is
    // still a payload, whether they were compromised or careless.
    if (matched.patterns.length > 0) {
        return {
            provenance,
            lifecycle,
            trust: 'blocked',
            reason: `${matched.keys.map((key) => `${key}:`).join(', ')} matched ${matched.patterns.length} injection pattern(s): ${matched.patterns.join(', ')}`,
            matchedPatterns: matched.patterns,
            matchedTrailerKeys: matched.keys,
        };
    }
    const claim = (reason) => ({ provenance, lifecycle, trust: 'claim', reason });
    if (provenance === 'reconstructed') {
        return claim('provenance is reconstructed — rebuilt from history, never directly authored');
    }
    if (provenance !== 'authored') {
        return claim(`provenance is ${provenance}, and only authored records can direct an agent`);
    }
    if (author === undefined) {
        return claim('no commit author is known, so authorship cannot be trusted');
    }
    if (ctx.trustedAuthors === undefined || ctx.trustedAuthors.length === 0) {
        return claim(`no trusted authors are configured, so ${quoted(author)} is an outside contributor`);
    }
    if (!isTrustedAuthor(author, ctx.trustedAuthors)) {
        return claim(`author ${quoted(author)} is not a trusted author of this repository`);
    }
    if (lifecycle !== 'active') {
        return claim(`record is ${lifecycle} and no longer directs anything`);
    }
    return {
        provenance,
        lifecycle,
        trust: 'directive',
        reason: `authored by trusted author ${quoted(author)}, active, no injection pattern matched`,
    };
};
/**
 * Grades one record. `ctx.author` supplies the commit author when the record
 * carries none of its own.
 *
 * With no surrounding stream the lifecycle axis sees only what the record says
 * about itself — an `Expires:` date, nothing more. A supersession lives in
 * *another* commit, so a caller that cares about it must either fold first (and
 * pass `record.lifecycle`) or use `gradeAll`.
 */
export const gradeRecord = (record, ctx) => {
    const author = record.author ?? ctx.author;
    return grade({ record, author, folded: undefined }, ctx);
};
/** blocked outranks claim outranks directive. */
export const TRUST_RANK = { directive: 0, claim: 1, blocked: 2 };
/**
 * Keeps the more restrictive of two grades for the same `Record-Id`.
 *
 * Records fold by identity (SPEC §5), so one `Record-Id` can be declared by
 * several commits — and nothing stops one of them coming from an outside
 * contributor. Latest-commit-wins is right for trailer *values*; for trust it
 * would let an attacker upgrade their own record by appending a commit, so
 * trust takes the floor of every declaration instead.
 */
export const restrictGrade = (a, b) => {
    const kept = TRUST_RANK[b.trust] > TRUST_RANK[a.trust] ? b : a;
    const patterns = [...new Set([...(a.matchedPatterns ?? []), ...(b.matchedPatterns ?? [])])];
    if (patterns.length === 0)
        return kept;
    const keys = [...new Set([...(a.matchedTrailerKeys ?? []), ...(b.matchedTrailerKeys ?? [])])];
    return { ...kept, matchedPatterns: patterns, matchedTrailerKeys: keys };
};
/**
 * Grades a whole stream, keyed by `Record-Id`.
 *
 * The stream is folded once (`foldLifecycle`) so supersessions and expiries are
 * seen, then every record is graded against its own author. Records that
 * declare no `Record-Id` still get an entry — keyed by sha, or by `#<index>`
 * when there is not even that — because dropping a record from the map would
 * hide it from a caller that filters on grade.
 */
export const gradeAll = (records, ctx) => {
    const folded = new Map(foldLifecycle(records, { at: ctx.at }).map((state) => [state.recordId, state.lifecycle]));
    const graded = new Map();
    records.forEach((record, index) => {
        const recordId = record.recordId ?? trailerValues(record.trailers, 'Record-Id')[0];
        const key = recordId ?? record.sha ?? `#${index}`;
        const one = grade({
            record,
            author: record.author ?? ctx.author,
            folded: recordId === undefined ? undefined : folded.get(recordId),
        }, ctx);
        const previous = graded.get(key);
        graded.set(key, previous === undefined ? one : restrictGrade(previous, one));
    });
    return graded;
};
// ---------------------------------------------------------------------------
// Commit authorship — the input grading cannot be honest without
// ---------------------------------------------------------------------------
/** Commits per `git show`. Keeps the argument list well inside any exec limit. */
const AUTHOR_BATCH = 200;
const AUTHOR_RECORD_SEP = '\x01';
const AUTHOR_FIELD_SEP = '\0';
const AUTHOR_SHA_RE = /^[0-9a-f]{4,40}$/;
/**
 * `%x01`/`%x00` rather than the literal bytes: `spawnSync` refuses an argument
 * containing a NUL, and these reach git as text and come back as bytes.
 */
const AUTHOR_FORMAT = '--format=%x01%H%x00%an <%ae>';
/**
 * Maps each commit to its **author** identity, `Name <email>`.
 *
 * Author, never committer: a fork PR is committed by whoever merged it, and
 * grading on the committer would hand every outside contributor the merger's
 * trust (`spec/contract-cases/grade-external-contributor.yaml`).
 *
 * A commit git cannot resolve simply has no entry, and a record with no known
 * author grades as a `claim` — the fail-closed direction.
 *
 * This lives here rather than in `inject.ts`, where it was written, because
 * grading is only as good as the authorship it sees: a consumer that cannot get
 * the author cannot call `gradeRecord` and ends up writing its own weaker rule.
 * `query.ts` did exactly that, and graded every record from every author
 * `directive`.
 */
export const authorsOf = (cwd, shas) => {
    const wanted = [...new Set(shas)].filter((sha) => AUTHOR_SHA_RE.test(sha)).sort();
    const authors = new Map();
    for (let start = 0; start < wanted.length; start += AUTHOR_BATCH) {
        const batch = wanted.slice(start, start + AUTHOR_BATCH);
        const result = execGit(['show', '-s', AUTHOR_FORMAT, ...batch], { cwd });
        if (result.code !== 0)
            continue;
        for (const chunk of result.stdout.split(AUTHOR_RECORD_SEP)) {
            const [sha = '', author = ''] = chunk.split(AUTHOR_FIELD_SEP);
            if (sha === '')
                continue;
            authors.set(sha.trim(), author.trim());
        }
    }
    return authors;
};
//# sourceMappingURL=grade.js.map