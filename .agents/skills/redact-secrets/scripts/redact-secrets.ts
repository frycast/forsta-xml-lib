import { lstat, mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { SaxesParser } from "saxes";

class CliError extends Error {
  fileNumber?: number;
  constructor(readonly code: string, message: string) { super(message); }
}
function fail(code: string, message: string): never { throw new CliError(code, message); }
async function io<T>(code: string, message: string, operation: () => Promise<T>): Promise<T> {
  try { return await operation(); }
  catch (error) {
    if (error instanceof CliError) throw error;
    const reason = (error as { code?: string })?.code;
    const safeReason = ["ENOENT", "ENOTDIR", "EACCES", "EPERM", "EEXIST", "ENOSPC", "EROFS"].includes(reason ?? "") ? ` (${reason})` : "";
    return fail(code, message + safeReason);
  }
}
function launchBetterleaks(executable: string, args: string[], options: Parameters<typeof Bun.spawn>[1] = {}) {
  try { return Bun.spawn([executable, ...args], { stdout: "ignore", stderr: "ignore", ...options }); }
  catch (error) {
    const code = (error as { code?: string })?.code;
    if (code === "ENOENT") fail("BETTERLEAKS_NOT_FOUND", "The Betterleaks executable was not found. Use --betterleaks <executable-path> or install Betterleaks on PATH.");
    if (code === "EACCES" || code === "EPERM") fail("BETTERLEAKS_NOT_EXECUTABLE", "The Betterleaks executable could not be run. Check executable permissions.");
    return fail("BETTERLEAKS_LAUNCH_FAILED", "Could not launch the Betterleaks executable. Check that it is a compatible executable for this operating system.");
  }
}
async function resolveBetterleaks(explicit?: string): Promise<string> {
  // Resolve relative paths before the scanner changes its working directory.
  const executable = explicit ? resolve(explicit) : Bun.which("betterleaks");
  if (!executable) fail("BETTERLEAKS_NOT_FOUND", "Betterleaks was not found on PATH. Pass --betterleaks <executable-path>.");
  const child = launchBetterleaks(executable, ["version"], { stdout: "pipe" });
  const [code, version] = await Promise.all([child.exited, new Response(child.stdout).text()]);
  if (code !== 0) fail("BETTERLEAKS_CHECK_FAILED", `Betterleaks version check exited with code ${code}. Supply a working Betterleaks 1.9.x executable.`);
  if (!/^v?1\.9\.\d+$/.test(version.trim())) fail("BETTERLEAKS_VERSION_UNSUPPORTED", "Use Betterleaks 1.9.x. Other versions and Gitleaks are not supported by the bundled configuration. No version output is logged.");
  return executable;
}
function argumentsFor(args: string[]) {
  let input: string | undefined, betterleaks: string | undefined;
  const usage = () => fail("USAGE", "Usage: bun redact-secrets.ts [--betterleaks <executable-path>] <file-or-directory>");
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--betterleaks") {
      if (betterleaks !== undefined || !args[i + 1] || args[i + 1].startsWith("--")) usage();
      betterleaks = args[++i];
    } else if (args[i] === "--") {
      if (input || args.length !== i + 2) usage();
      input = args[++i];
    } else {
      if (args[i].startsWith("-") || input) usage();
      input = args[i];
    }
  }
  if (!input) usage();
  return { input: input!, betterleaks };
}
let outputCreated = false;

type Span = { start: number; end: number; secret: boolean; entities: boolean; authorization?: boolean; category?: string; structural?: boolean; asset?: boolean };
type Range = [number, number];
type Detection = [number, number, string];
type Replacement = { original_line: number; category: string };
type Redaction = { text: string; replacements: Replacement[] };
const reportName = "redaction-report.json";
const customCategories = new Set(["credential-field", "authorization", "url-credential", "connection-string", "forsta-test-key", "kleber-request-key", "voucher-code", "quoted-token", "credential-getter"]);
// Prefer a specific Betterleaks rule to a custom category for overlapping detections.
const compareCategory = (a: string, b: string) => Number(customCategories.has(a)) - Number(customCategories.has(b)) || a.localeCompare(b);
// Exact credential names, with only recognised service/environment prefixes.
// In particular, hasPassword/showToken/requiresPassword are not credentials.
const credentialNames = new Set(["password", "passwd", "pwd", "secret", "apikey", "accesskey", "secretaccesskey", "privatekey", "clientkey", "clientsecret", "token", "accesstoken", "refreshtoken", "authtoken", "bearertoken", "sessiontoken", "authorization", "connectionstring", "subscriptionkey", "signature", "sig", "externaltestkey"]);
function fieldKey(name: string): string {
  const key = name.replace(/[^a-z0-9]/gi, "").toLowerCase();
  if (credentialNames.has(key)) return key;
  const prefix = ["aws", "azure", "db", "database", "smtp", "forsta", "service", "http", "https"].find(p => key.startsWith(p) && credentialNames.has(key.slice(p.length)));
  return prefix ? key.slice(prefix.length) : key;
}
const secretKey = (name: string) => credentialNames.has(fieldKey(name));

// Keep XML ID/reference fields outside replacement ranges. XML titles, text-only
// display text and image src attributes are also excluded by xmlSpans below.
const structuralKey = (name: string) => {
  const key = name.replace(/[^a-z0-9]/gi, "");
  return !/^href$/i.test(key) && /^(?:id|ids|name|key|ref|refs|reference|references|idref|idrefs|for|target|source|parent|labelledby|describedby)$|(?:id|ids|name|names|ref|refs|reference|references)$/i.test(key);
};
// Binary search keeps source-offset mapping cheap for large script blocks.
function boundary(length: number, before: (index: number) => boolean): number {
  let low = 0, high = length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (before(middle)) low = middle + 1; else high = middle;
  }
  return low;
}

function validateXml(text: string, output = false) {
  const parser = new SaxesParser({ xmlns: true });
  parser.on("error", () => { fail(output ? "OUTPUT_XML_INVALID" : "INPUT_XML_INVALID", `${output ? "Redacted" : "Input"} XML is not well-formed (line ${parser.line}, column ${parser.column}). No source text is included.`); });
  // Do not resolve external entities or accept documents needing a DTD.
  parser.on("doctype", () => { fail("XML_DTD_UNSUPPORTED", "XML containing a DTD is not supported; external entities are never resolved."); });
  parser.write(text).close();
}

// Decode for detection, retaining the source range of every decoded character.
// Replacements use those ranges, never a serialised/reformatted XML document.
function view(text: string, span: Span, percent = false) {
  let value = "";
  const positions: Range[] = [];
  const raw = text.slice(span.start, span.end);
  const entity = /^(?:&(?:amp|lt|gt|quot|apos);|&#(?:[0-9]+|x[0-9a-f]+);)/i;
  const named: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&apos;": "'" };
  for (let i = 0; i < raw.length;) {
    const match = span.entities && raw[i] === "&" ? raw.slice(i).match(entity) : null;
    const token = match?.[0] ?? raw[i];
    const decoded = match ? named[token] ?? String.fromCodePoint(parseInt(token.slice(token[2] === "x" ? 3 : 2, -1), token[2] === "x" ? 16 : 10)) : token;
    value += decoded;
    for (let n = 0; n < decoded.length; n++) positions.push([span.start + i, span.start + i + token.length]);
    i += token.length;
  }
  if (!percent) return { value, positions, span };
  // Percent-encoded ASCII credentials in URLs. Do not decode arbitrary binary.
  let decoded = "";
  const mapped: Range[] = [];
  for (let i = 0; i < value.length;) {
    const match = value.slice(i).match(/^%([0-7][0-9a-f])/i);
    decoded += match ? String.fromCharCode(parseInt(match[1], 16)) : value[i];
    mapped.push([positions[i][0], positions[i + (match ? 2 : 0)][1]]);
    i += match ? 3 : 1;
  }
  return { value: decoded, positions: mapped, span };
}

function xmlSpans(text: string): Span[] {
  validateXml(text);
  const spans: Span[] = [];
  type Element = { credential: boolean; authorization: boolean; structural: boolean; hasChild: boolean; text: Span[] };
  const stack: Element[] = [];
  // XML has already been parsed strictly. This quote-aware lexical pass supplies
  // source offsets; comments, CDATA, processing instructions and tags are distinct.
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<(?:[^<>"']|"[^"]*"|'[^']*')+>|[^<]+/g;
  let end = 0;
  for (const match of text.matchAll(tokens)) {
    if (match.index !== end) fail("XML_OFFSETS", "Could not map XML source positions safely; the file was not processed.");
    const token = match[0], start = match.index;
    end = start + token.length;
    const add = (a: number, b: number, secret = false, entities = false) => spans.push({ start: start + a, end: start + b, secret, entities });
    if (token.startsWith("<?")) continue;
    if (token.startsWith("<!--")) { add(4, token.length - 3); continue; }
    if (token.startsWith("</")) {
      const element = stack.pop()!;
      if (element.structural && !element.hasChild) for (const span of element.text) span.structural = true;
      if (element.credential && !element.hasChild) for (const span of element.text) {
        span.secret = true;
        span.authorization = element.authorization;
      }
      continue;
    }
    if (token.startsWith("<![CDATA[") || !token.startsWith("<")) {
      const cdata = token.startsWith("<![CDATA[");
      add(cdata ? 9 : 0, token.length - (cdata ? 3 : 0), false, !cdata);
      stack.at(-1)?.text.push(spans.at(-1)!);
      continue;
    }
    if (stack.length) stack.at(-1)!.hasChild = true;
    const name = token.match(/^<([^\s/>]+)/)![1].split(":").at(-1)!;
    const attributes = [...token.matchAll(/([^\s=<>]+)\s*=\s*(["'])([\s\S]*?)\2/g)].map(m => {
      const offset = m.index! + m[0].indexOf(m[2]) + 1;
      return { name: m[1], span: { start: start + offset, end: start + offset + m[3].length, secret: false, entities: true } };
    });
    // A questionnaire node named "password" is not a configuration value.
    const label = /^(?:property|config|setting|parameter|param|entry|add|header)$/i.test(name)
      ? attributes.find(a => /^(?:name|key)$/i.test(a.name.split(":").at(-1)!) && secretKey(view(text, a.span).value)) : undefined;
    const labelName = label ? view(text, label.span).value : "";
    for (const attr of attributes) {
      if (/^xmlns(?::|$)/.test(attr.name)) continue;
      const local = attr.name.split(":").at(-1)!;
      attr.span.secret = secretKey(local) || (!!label && /^value$/i.test(local));
      (attr.span as Span).authorization = fieldKey(local) === "authorization" || (!!label && /^value$/i.test(local) && fieldKey(labelName) === "authorization");
      (attr.span as Span).category = /^ExternalTestKey$/i.test(local) ? "forsta-test-key" : undefined;
      (attr.span as Span).asset = /^img$/i.test(name) && /^src$/i.test(local);
      (attr.span as Span).structural = !attr.span.secret && (structuralKey(local) || /^code$/i.test(local) || (/^img$/i.test(name) && /^src$/i.test(local)) || (!!labelName && structuralKey(labelName) && /^value$/i.test(local)));
      spans.push(attr.span);
    }
    if (!token.endsWith("/>")) stack.push({ credential: secretKey(name) || !!label, authorization: fieldKey(name) === "authorization" || fieldKey(labelName) === "authorization", structural: !secretKey(name) && (structuralKey(name) || /^(?:Title|Text)$/i.test(name)), hasChild: false, text: [] });
  }
  if (end !== text.length) fail("XML_OFFSETS", "Could not map XML source positions safely; the file was not processed.");
  return spans;
}

async function detect(text: string, executable: string): Promise<{ secret: string; category: string }[]> {
  const folder = await io("TEMP_CREATE_FAILED", "Could not create the temporary scanner directory.", () => mkdtemp(join(tmpdir(), "redact-secrets-")));
  try {
    // Explicit configuration and an isolated cwd prevent project ignore files or
    // environment overrides from silently disabling detection.
    const config = fileURLToPath(new URL("./betterleaks.toml", import.meta.url)), report = join(folder, "report.json");
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(?:BETTERLEAKS|GITLEAKS)_/i.test(key)));
    const child = launchBetterleaks(executable, ["stdin", "--config", config, "--validation=false", "--ignore-gitleaks-allow", "--max-decode-depth", "0", "--exit-code", "20", "--no-banner", "--log-level", "fatal", "--report-format", "json", "--report-path", report], {
      cwd: folder, env, stdin: new TextEncoder().encode(text), stdout: "ignore", stderr: "ignore",
    });
    const code = await child.exited;
    if (code !== 0 && code !== 20) fail("BETTERLEAKS_SCAN_FAILED", `Betterleaks scan exited with code ${code}. Check Betterleaks compatibility (1.9.x). Scanner output is withheld because it may contain secrets.`);
    const reportText = await io("BETTERLEAKS_REPORT_READ_FAILED", "Could not read the temporary scanner report.", () => readFile(report, "utf8"));
    let findings;
    try {
      findings = JSON.parse(reportText) ?? [];
      if (!Array.isArray(findings) || findings.some(f => typeof f?.Secret !== "string" || typeof f?.RuleID !== "string")) throw new Error();
    } catch { return fail("BETTERLEAKS_REPORT_INVALID", "Betterleaks produced an invalid report. Its contents are withheld because they may contain secrets."); }
    return findings.filter((f: { Secret: string }) => !!f.Secret).map((f: { Secret: string; RuleID: string }) => ({
      secret: f.Secret,
      category: /^[a-z0-9][a-z0-9_-]{0,99}$/.test(f.RuleID) ? f.RuleID : "betterleaks",
    }));
  } finally {
    // Reports contain secrets. They never become tool output or deliverables.
    await io("TEMP_CLEANUP_FAILED", "Could not remove the temporary scanner directory; its report may contain secrets.", () => rm(folder, { recursive: true, force: true }));
  }
}

async function redact(text: string, xml: boolean, executable: string): Promise<Redaction> {
  const spans = xml ? xmlSpans(text) : [{ start: 0, end: text.length, secret: false, entities: false }];
  const lineStarts = [0, ...[...text.matchAll(/\r\n|\r|\n/g)].map(m => m.index! + m[0].length)];
  const sourceLine = (offset: number) => boundary(lineStarts.length, i => lineStarts[i] <= offset);
  const views = spans.flatMap(span => [view(text, span), view(text, span, true)]);
  // Protect XML attributes/elements identified as IDs or references. There is no
  // JavaScript parser or UI interpretation in this CLI; token scoring is Betterleaks configuration.
  const findings = await detect(views.map(v => v.span.structural ? "" : v.value).join("\n"), executable);
  const secrets = new Map(findings.sort((a, b) => compareCategory(b.category, a.category)).map(f => [f.secret, f.category]));
  const ranges: Detection[] = [];
  const environmentFile = !xml && text.split(/\r?\n/).every(line => /^(?:\s*|[ \t]*#.*|[\w.-]+[ \t]*=[^;]*)$/.test(line));
  for (const v of views) {
    const mark = (start: number, end: number, category = "credential-field") => {
      if (end <= start || (v.span.structural && !v.span.asset)) return;
      ranges.push([v.positions[start][0], v.positions[end - 1][1], category]);
      const secret = v.value.slice(start, end);
      // Repeat distinctive known values, not short passwords such as "123" that
      // could also be ordinary survey data. The original occurrence is always removed.
      if (!secrets.has(secret) && (secret.length >= 12 || (secret.length >= 8 && /[a-z]/i.test(secret) && /[^a-z]/i.test(secret)))) secrets.set(secret, category);
    };
    const markCredential = (start: number, end: number, authorization = false) => {
      const auth = authorization ? v.value.slice(start, end).match(/^((?:Bearer|Basic)[ \t]+)([^\s]+)[ \t]*$/i) : null;
      if (auth) { start += auth[1].length; end = start + auth[2].length; }
      mark(start, end, v.span.category ? v.span.category : authorization ? "authorization" : "credential-field");
    };
    if (v.span.secret && v.value.trim()) {
      const start = v.value.search(/\S/);
      markCredential(start, v.value.trimEnd().length, v.span.authorization);
      continue;
    }
    const urls = [...v.value.matchAll(/https?:\/\/[^\s"'<>\\]+/gi)];
    for (const url of urls) {
      for (const m of url[0].matchAll(/[?&]([^=&#\s]+)=([^&#\s"'<>\\]*)/g)) {
        const start = url.index! + m.index! + m[0].indexOf("=") + 1, end = start + m[2].length;
        const name = m[1].toLowerCase();
        if (structuralKey(name)) continue;
        if (name === "__etk" && /^https?:\/\/[^/]+\/extwix\/test_[^/?#]+/i.test(url[0])) mark(start, end, "forsta-test-key");
        else if (name === "requestkey" && /^https?:\/\/kleber\.datatoolscloud\.net\.au\//i.test(url[0])) mark(start, end, "kleber-request-key");
        else if (name === "codes" && /^https?:\/\/egiftpost\.com\/g\//i.test(url[0])) mark(start, end, "voucher-code");
      }
    }
    // Literal credentials only: never replace an expression like getToken().
    for (const m of v.value.matchAll(/([\w$.-]+|["'][\w .-]+["'])\s*[:=]\s*(["'`])((?:\\[\s\S]|(?!\2)[^\\])*?)\2/g)) {
      if (secretKey(m[1]) && !(m[2] === "`" && m[3].includes("${"))) {
        const start = m.index! + m[0].indexOf(m[2], m[1].length) + 1;
        markCredential(start, start + m[3].length, fieldKey(m[1]) === "authorization");
      }
    }
    // Unquoted .env values can contain spaces; consume the complete line.
    if (environmentFile) for (const m of v.value.matchAll(/^([\w.-]+)[ \t]*=[ \t]*([^"'`\r\n][^\r\n]*)/gm)) {
      if (secretKey(m[1]) && !/^[\w$.]+\s*\(|^(?:process|Bun)\.env\b/.test(m[2].trim())) { const start = m.index! + m[0].indexOf("=") + 1; mark(start + v.value.slice(start, m.index! + m[0].length).search(/\S/), m.index! + m[0].trimEnd().length); }
    }
    for (const m of v.value.matchAll(/[?&]([^=&#\s]+)=([^&#\s"'<>\\]*)/g)) {
      if (secretKey(m[1])) { const start = m.index! + m[0].indexOf("=") + 1; mark(start, start + m[2].length, "url-credential"); }
    }
    for (const m of v.value.matchAll(/(?:^|\r?\n)[ \t]*(?:Proxy-)?Authorization[ \t]*:[ \t]*(?:Bearer|Basic)[ \t]+([A-Za-z0-9+/_=.\-]+)/gi)) mark(m.index! + m[0].length - m[1].length, m.index! + m[0].length, "authorization");
    for (const m of v.value.matchAll(/:\/\/[^\s/:@]+:([^\s/@]+)@/g)) mark(m.index! + m[0].length - m[1].length - 1, m.index! + m[0].length - 1, "url-credential");
    if (/(?:^|;)[ \t]*(?:Server|Database|Data Source|Initial Catalog|AccountName|EndpointSuffix)[ \t]*=/i.test(v.value)) for (const m of v.value.matchAll(/(?:^|;)[ \t]*([\w .-]+)=[ \t]*([^"'`;\r\n][^;\r\n]*)/g)) {
      if (secretKey(m[1]) && !/^(?:const|let|var)\s/.test(m[1].trim()) && !/^[\w$.]+\s*\(/.test(m[2].trim())) { const start = m.index! + m[0].indexOf("=") + 1; mark(start + v.value.slice(start, m.index! + m[0].length).search(/\S/), m.index! + m[0].trimEnd().length); }
    }
  }
  const identifierChar = (char: string) => /[\p{L}\p{N}_$.-]/u.test(char);
  for (const v of views) {
    for (const [secret, category] of secrets) {
      for (let i = v.value.indexOf(secret); i !== -1; i = v.value.indexOf(secret, i + secret.length)) {
        // A detected value must not overwrite a substring of a longer survey
        // identifier, e.g. NAME in S_NAME, NAME0, NAME_NA or NAME_input.
        if ((identifierChar(secret[0]) && identifierChar(v.value[i - 1] ?? ""))
          || (identifierChar(secret.at(-1)!) && identifierChar(v.value[i + secret.length] ?? ""))) continue;
        if (!v.span.structural) ranges.push([v.positions[i][0], v.positions[i + secret.length - 1][1], category]);
      }
    }
  }
  // Merge overlaps, then replace from right to left so source offsets stay valid.
  const merged: Detection[] = [];
  for (const range of ranges.sort((a, b) => a[0] - b[0] || a[1] - b[1])) {
    const previous = merged.at(-1);
    if (previous && range[0] < previous[1]) {
      previous[1] = Math.max(previous[1], range[1]);
      if (compareCategory(range[2], previous[2]) < 0) previous[2] = range[2];
    }
    else merged.push([...range]);
  }
  const changes = merged.filter(([start, end]) => text.slice(start, end) !== "redacted");
  const replacements = changes.map(([start, , category]) => ({ original_line: sourceLine(start), category }));
  let output = text;
  for (const [start, end] of [...changes].reverse()) output = output.slice(0, start) + "redacted" + output.slice(end);
  if (xml) validateXml(output, true);
  return { text: output, replacements };
}

async function run(args: string[]) {
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: bun redact-secrets.ts [--betterleaks <executable-path>] <file-or-directory>\nRequires Bun and Betterleaks 1.9.x. Betterleaks is resolved from PATH unless --betterleaks supplies an absolute or relative executable path (quote paths containing spaces). Install the pinned saxes dependency declared in scripts/package.json before running.\nSecrets detection only, NOT PII detection: emails, names, phone numbers and respondent IDs are left alone unless independently identified as secrets.\nProcesses top-level UTF-8 text files only; originals stay unchanged. Writes redacted copies and redaction-report.json in a new redact-secrets-output directory; refuses existing output, binary/non-UTF-8 input, malformed XML and DTDs. The report lists local filenames, original 1-based line numbers and detection categories, never secret values or surrounding text. Its filename is reserved and cannot be an input file. XML replacements affect values only, preserving markup and formatting. General detection uses Betterleaks defaults plus quoted-token detection (12-150 characters, entropy above 3.0 and token-efficiency filtering) and direct literal returns from private/secret/password-named functions. Explicit rules also cover credential fields and known credential URL parameters. Validation against live services is disabled. JavaScript is never parsed or executed; code syntax does not block processing. Random-looking public identifiers, routing references and class names may also be redacted. Unknown layouts, escaped/interpolated literals and obfuscated values may remain. XML IDs/references, text-only Title/Text elements and img src values are preserved; explicit credential URL parameters in img src still redact. Known survey/DOM helper arguments and public asLink/image assets are excluded by scanner configuration. Duplicate values are not replaced inside longer identifiers; arbitrary JavaScript is not interpreted. No guarantee of complete detection.");
    return;
  }
  const options = argumentsFor(args);
  const input = resolve(options.input);
  const info = await io("INPUT_STAT_FAILED", "Could not access the supplied input path.", () => lstat(input));
  if (!info.isFile() && !info.isDirectory()) fail("INPUT_TYPE", "Input must be a regular file or directory; symbolic links are not accepted.");
  const folder = info.isDirectory() ? input : dirname(input);
  const files = info.isDirectory()
    ? (await io("INPUT_LIST_FAILED", "Could not list the input directory.", () => readdir(input, { withFileTypes: true }))).filter(e => e.isFile()).map(e => join(input, e.name)).sort()
    : [input];
  if (files.some(file => basename(file).toLowerCase() === reportName)) fail("REPORT_NAME_RESERVED", "An input file conflicts with the reserved redaction-report.json filename. Rename that input file.");
  const output = join(folder, "redact-secrets-output");
  try { await lstat(output); fail("OUTPUT_EXISTS", "redact-secrets-output already exists. Move or remove it before running again."); }
  catch (error) {
    if (error instanceof CliError) throw error;
    if ((error as { code?: string })?.code !== "ENOENT") fail("OUTPUT_CHECK_FAILED", "Could not check the output directory. Check filesystem permissions.");
  }
  const executable = await resolveBetterleaks(options.betterleaks);
  const outputs: (Redaction & { name: string })[] = [];
  for (let index = 0; index < files.length; index++) {
    const file = files[index];
    try {
      if (!(await io("INPUT_STAT_FAILED", "Could not access an input file.", () => lstat(file))).isFile()) fail("INPUT_TYPE", "Input is no longer a regular file; symbolic links are not accepted.");
      const bytes = await io("INPUT_READ_FAILED", "Could not read the input file.", () => readFile(file));
      let text: string;
      try { text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes); }
      catch { return fail("INPUT_ENCODING", "Input is not valid UTF-8 text. Convert it to UTF-8 before redacting."); }
      if (text.includes("\0")) fail("INPUT_BINARY", "Input contains NUL bytes and is not supported as a text file.");
      const xml = extname(file).toLowerCase() === ".xml" || /^\uFEFF?\s*</.test(text);
      outputs.push({ name: basename(file), ...await redact(text, xml, executable) });
    } catch (error) {
      if (error instanceof CliError) error.fileNumber = index + 1;
      throw error;
    }
  }
  await io("OUTPUT_CREATE_FAILED", "Could not create redact-secrets-output.", () => mkdir(output, { mode: 0o700 }));
  outputCreated = true;
  for (let index = 0; index < outputs.length; index++) {
    const file = outputs[index];
    await io("OUTPUT_WRITE_FAILED", `Could not write redacted output for input file #${index + 1}.`, () => writeFile(join(output, file.name), file.text, { flag: "wx", mode: 0o600 }));
  }
  const report = {
    files_processed: outputs.length,
    files_with_redactions: outputs.filter(file => file.replacements.length > 0).length,
    total_replacements: outputs.reduce((total, file) => total + file.replacements.length, 0),
    files: outputs.map(file => ({ filename: file.name, replacements: file.replacements })),
  };
  await io("OUTPUT_REPORT_WRITE_FAILED", "Could not write redaction-report.json.", () => writeFile(join(output, reportName), JSON.stringify(report, null, 2) + "\n", { flag: "wx", mode: 0o600 }));
  console.log(`Processed ${report.files_processed} files; ${report.total_replacements} replacements across ${report.files_with_redactions} files. Report saved in redact-secrets-output/${reportName}. Secrets detection only, not PII detection; undetected secrets may remain.`);

}

if (import.meta.main) run(Bun.argv.slice(2)).catch(error => {
  // Print only controlled messages: raw parser errors, filenames, subprocess logs
  // and system exception text can contain secrets.
  const failure = error instanceof CliError ? error : new CliError("INTERNAL_ERROR", "An unexpected internal error occurred. No raw exception details are logged.");
  const file = failure.fileNumber ? ` Input file #${failure.fileNumber}:` : "";
  console.error(`Redaction failed [${failure.code}]:${file} ${failure.message}`);
  console.error(outputCreated ? "Partial output may exist and must not be used." : "No output was created.");
  process.exitCode = 1;
});

