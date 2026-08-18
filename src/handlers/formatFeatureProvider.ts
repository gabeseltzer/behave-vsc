import * as vscode from 'vscode';
import { getWorkspaceUriForFile, getLines } from '../common';
import { config } from '../configuration';

// NOTE: behaviour should be roughly consistent with
// gherkin.language-configuration.json (which is used for autoformat while typing).
// the difference here is that we enforce the indent based on the current line content,
// rather than just on the previous line content.

const zeroIndent = /^$|^\s*$|^\s*Feature:.*/;
const oneIndent = /^\s*(Background:|Rule:|Scenario:|Scenario Outline:|Scenario Template:).*/;
const twoIndent = /^\s*(Given|When|Then|And|But|Examples:).*/;
const threeIndent = /^\s*\|.*/;
const allIndents = new RegExp([oneIndent, twoIndent, threeIndent].map(r => r.source).join("|"));

// both delimiters are valid docstring fences per the gherkin spec
const docstringDelimiters = ['"""', '```'];


// a format taking longer than this is worth a line in the output channel on its own
const SLOW_FORMAT_MS = 250;


// ============================================================================
// core
//
// the core is deliberately free of any vscode dependency: it takes plain lines
// plus resolved options and returns plain line/character edit descriptors, so it
// can be unit tested without stubbing a TextDocument.
// ============================================================================

export interface FormatOpts {
  // the resolved indent unit, e.g. "    " or "\t" - one level of indentation
  unit: string;
  eol: string;
  trimTrailing: boolean;
  insertFinalNewline: boolean;
  trimFinalNewlines: boolean;
  blankLines: boolean;
  alignTables: boolean;
}

export interface LineEdit {
  startLine: number;
  startChar: number;
  endLine: number;
  endChar: number;
  newText: string;
}


export function formatFeatureLines(lines: string[], opts: FormatOpts): LineEdit[] {

  const edits: LineEdit[] = [];
  const lineCount = lines.length;

  const { isFence, isBody, fenceOf } = findDocstrings(lines);
  const levels = computeLevels(lines, isFence, isBody);
  const alignedRows = opts.alignTables ? alignTables(lines, isFence, isBody) : new Map<number, string>();

  // the last line that has content. trailing blank lines are dealt with once, at the
  // end, so that the end-of-file edit can never overlap a blank-line collapse edit
  // (vscode rejects overlapping edits).
  let lastContent = lineCount - 1;
  while (lastContent >= 0 && lines[lastContent].trim() === "")
    lastContent--;
  const collapseLimit = opts.trimFinalNewlines ? lastContent : lineCount - 1;

  for (let lineNo = 0; lineNo < lineCount; lineNo++) {
    const line = lines[lineNo];

    if (line.trim() === "") {
      // collapse a run of blank lines down to one
      if (opts.blankLines && lineNo > 0 && lineNo <= collapseLimit && lines[lineNo - 1].trim() === "")
        edits.push({ startLine: lineNo - 1, startChar: 0, endLine: lineNo, endChar: 0, newText: "" });
      continue;
    }

    // docstring content is user data, not gherkin: shift it to follow its fence, but
    // otherwise leave it exactly as it is (no keyword matching, no blank line
    // insertion, no trailing whitespace trimming).
    if (isBody[lineNo]) {
      const shifted = shiftBodyLine(lines, lineNo, fenceOf[lineNo], levels, opts);
      if (shifted !== undefined && shifted !== line)
        edits.push({ startLine: lineNo, startChar: 0, endLine: lineNo, endChar: line.length, newText: shifted });
      continue;
    }

    const alignedRow = alignedRows.get(lineNo);
    let content = alignedRow !== undefined ? alignedRow : line.replace(/^\s*/, "");
    if (opts.trimTrailing)
      content = content.trimEnd();

    const newText = leadingBlankLine(lines, lineNo, opts) + opts.unit.repeat(levels[lineNo]) + content;
    if (newText !== line)
      edits.push({ startLine: lineNo, startChar: 0, endLine: lineNo, endChar: line.length, newText });
  }

  edits.push(...endOfFileEdits(lines, lastContent, opts));

  return edits;
}


// vscode's native FormattingOptions carries only { tabSize, insertSpaces } - the final
// newline settings are LSP-only, so they are resolved from files.* by the caller.
function endOfFileEdits(lines: string[], lastContent: number, opts: FormatOpts): LineEdit[] {

  if (lastContent < 0)
    return [];

  const lastLine = lines.length - 1;

  // getLines() splits on the line break, so a document that ends in one yields a final
  // empty element. note that a trailing whitespace-only line is NOT a line break.
  const endsWithNewline = lines[lastLine] === "";

  if (!opts.trimFinalNewlines) {
    // nothing to collapse, so the only question is whether a final newline is missing
    if (opts.insertFinalNewline && !endsWithNewline)
      return [{
        startLine: lastLine, startChar: lines[lastLine].length,
        endLine: lastLine, endChar: lines[lastLine].length,
        newText: opts.eol,
      }];
    return [];
  }

  // trimFinalNewlines trims the newlines *after* the final one, so one is kept whenever
  // the document had one to begin with (or insertFinalNewline asks for one)
  const wanted = (opts.insertFinalNewline || endsWithNewline) ? opts.eol : "";

  const breaks = lastLine - lastContent;
  const tailIsJustLineBreaks = lines.slice(lastContent + 1).every(line => line === "");
  const alreadyCorrect = wanted === "" ? breaks === 0 : (breaks === 1 && tailIsJustLineBreaks);
  if (alreadyCorrect)
    return [];

  return [{
    startLine: lastContent, startChar: lines[lastContent].length,
    endLine: lastLine, endChar: lines[lastLine].length,
    newText: wanted,
  }];
}


// locate gherkin docstrings. isFence marks the fence lines themselves, isBody marks the
// content between them. an unterminated docstring leaves the remainder of the file
// marked as body, which is the safe failure mode - we won't touch it.
function findDocstrings(lines: string[]): { isFence: boolean[], isBody: boolean[], fenceOf: Int32Array } {

  const isFence = new Array<boolean>(lines.length).fill(false);
  const isBody = new Array<boolean>(lines.length).fill(false);
  // the opening fence of each body line (-1 for a line that isn't body). recorded here so
  // that shiftBodyLine doesn't have to scan back for it - that scan made a long docstring
  // cost O(n^2).
  const fenceOf = new Int32Array(lines.length).fill(-1);
  let openDelimiter: string | undefined;
  let openFence = -1;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const trimmed = lines[lineNo].trim();
    const delimiter = docstringDelimiters.find(d => trimmed.startsWith(d));

    if (openDelimiter === undefined) {
      if (delimiter) {
        isFence[lineNo] = true;
        openDelimiter = delimiter;
        openFence = lineNo;
      }
    }
    else if (delimiter === openDelimiter) {
      isFence[lineNo] = true;
      openDelimiter = undefined;
    }
    else {
      isBody[lineNo] = true;
      fenceOf[lineNo] = openFence;
    }
  }

  return { isFence, isBody, fenceOf };
}


function computeLevels(lines: string[], isFence: boolean[], isBody: boolean[]): number[] {

  const levels = new Array<number>(lines.length).fill(0);
  const nextLevels = computeNextLevels(lines, isFence, isBody);
  let featFound = false;
  let current = 0;
  let openFenceLevel: number | undefined;

  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    if (isBody[lineNo])
      continue;

    const trimmed = lines[lineNo].trim();
    if (trimmed === "")
      continue;

    // a docstring sits one level deeper than the step that owns it, and the closing
    // fence must line up with the opening one
    if (isFence[lineNo]) {
      if (openFenceLevel === undefined) {
        openFenceLevel = current + 1;
        levels[lineNo] = openFenceLevel;
      }
      else {
        levels[lineNo] = openFenceLevel;
        openFenceLevel = undefined;
      }
      continue;
    }

    // anything above the Feature: line (tags, comments, licence headers) goes to column 0
    if (!featFound) {
      if (!/^Feature:/.test(trimmed))
        continue;
      featFound = true;
    }

    const classified = classifyLevel(trimmed);
    // unmatched, so must be a comment line, or a tag line - borrow the level of the
    // next line we can classify, and failing that keep the level we are already at
    current = classified !== undefined ? classified : (nextLevels[lineNo] ?? current);
    levels[lineNo] = current;
  }

  return levels;
}


function classifyLevel(trimmed: string): number | undefined {
  if (zeroIndent.test(trimmed))
    return 0;
  if (oneIndent.test(trimmed))
    return 1;
  if (twoIndent.test(trimmed))
    return 2;
  if (threeIndent.test(trimmed))
    return 3;
  return undefined;
}


// for each line, the level of the nearest line below it that we can classify (undefined if
// there is none). comments, tags and free-form description lines borrow their level from
// below, and scanning down for each of them separately cost O(n^2) over a run of them - a
// few thousand consecutive commented-out lines took seconds.
function computeNextLevels(lines: string[], isFence: boolean[], isBody: boolean[]): (number | undefined)[] {

  const nextLevels = new Array<number | undefined>(lines.length).fill(undefined);
  let pending: number | undefined;

  for (let lineNo = lines.length - 1; lineNo >= 0; lineNo--) {
    // assign before classifying this line - a line borrows from *below* it, never itself
    nextLevels[lineNo] = pending;
    // docstring content only looks like gherkin - never borrow a level from it
    if (isBody[lineNo] || isFence[lineNo])
      continue;
    const trimmed = lines[lineNo].trim();
    if (allIndents.test(trimmed))
      pending = classifyLevel(trimmed);
  }

  return nextLevels;
}


// re-indent a docstring body line by the same amount its opening fence moved, so that
// indentation-sensitive payloads (yaml, python, markdown) keep their structure.
function shiftBodyLine(lines: string[], lineNo: number, fence: number, levels: number[],
  opts: FormatOpts): string | undefined {

  if (fence < 0)
    return undefined;

  const oldFencePrefix = leadingWhitespace(lines[fence]);
  const newFencePrefix = opts.unit.repeat(levels[fence]);
  const line = lines[lineNo];
  const prefix = leadingWhitespace(line);

  // a body line we can't shift correctly (shallower than its fence, or indented with
  // different whitespace characters) is left exactly as it is - we would be guessing, and
  // this is user data
  if (!prefix.startsWith(oldFencePrefix))
    return undefined;

  // whatever the body line had beyond its fence's indent is preserved verbatim - that
  // relative indentation is content
  return newFencePrefix + prefix.slice(oldFencePrefix.length) + line.slice(prefix.length);
}


function leadingWhitespace(line: string): string {
  const match = line.match(/^\s*/);
  return match ? match[0] : "";
}


function leadingBlankLine(lines: string[], lineNo: number, opts: FormatOpts): string {

  if (!opts.blankLines || lineNo === 0)
    return "";

  const line = lines[lineNo].trim();
  const prevLine = lines[lineNo - 1].trim();

  if (prevLine === "" || prevLine.startsWith("#") || prevLine.startsWith("@"))
    return "";
  if (oneIndent.test(line) || line.toLowerCase().startsWith("examples:") || line.startsWith("@"))
    return opts.eol;

  return "";
}


// pad the cells of each contiguous run of table rows so the pipes line up. anything we
// don't recognise as a plain table (ragged rows, content after the last pipe) is left
// untouched rather than guessed at.
function alignTables(lines: string[], isFence: boolean[], isBody: boolean[]): Map<number, string> {

  const aligned = new Map<number, string>();

  const flushRun = (start: number, end: number) => {
    const rows: string[][] = [];
    for (let lineNo = start; lineNo <= end; lineNo++) {
      const cells = splitRow(lines[lineNo].trim());
      if (!cells)
        return;
      rows.push(cells);
    }

    const cellCount = rows[0].length;
    if (rows.some(row => row.length !== cellCount))
      return;

    // note: width is counted in code points, so full width / CJK cells will still be
    // padded by count rather than by rendered width
    const cellWidths = rows.map(row => row.map(cellWidth));
    const widths = new Array<number>(cellCount).fill(0);
    for (const row of cellWidths) {
      for (let cell = 0; cell < cellCount; cell++) {
        if (row[cell] > widths[cell])
          widths[cell] = row[cell];
      }
    }

    for (let lineNo = start; lineNo <= end; lineNo++) {
      const cells = rows[lineNo - start];
      const rowWidths = cellWidths[lineNo - start];
      const padded = cells.map((cell, i) => cell + " ".repeat(widths[i] - rowWidths[i]));
      aligned.set(lineNo, "| " + padded.join(" | ") + " |");
    }
  };

  let runStart = -1;
  for (let lineNo = 0; lineNo < lines.length; lineNo++) {
    const isRow = !isBody[lineNo] && !isFence[lineNo] && threeIndent.test(lines[lineNo].trim());
    if (isRow) {
      if (runStart < 0)
        runStart = lineNo;
      continue;
    }
    if (runStart >= 0) {
      flushRun(runStart, lineNo - 1);
      runStart = -1;
    }
  }
  if (runStart >= 0)
    flushRun(runStart, lines.length - 1);

  return aligned;
}


function cellWidth(cell: string): number {
  return [...cell].length;
}


// split a table row into trimmed cells, respecting gherkin's backslash escapes (so an
// escaped \| does not split a cell). returns undefined if this isn't a plain table row.
function splitRow(trimmed: string): string[] | undefined {

  if (!trimmed.startsWith("|") || !trimmed.endsWith("|"))
    return undefined;

  const cells: string[] = [];
  let cell = "";

  for (let i = 1; i < trimmed.length; i++) {
    const char = trimmed[i];
    if (char === "\\" && i + 1 < trimmed.length) {
      cell += char + trimmed[i + 1];
      i++;
      continue;
    }
    if (char === "|") {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += char;
  }

  // content after the final pipe (or an escaped trailing pipe) means this isn't a row
  if (cells.length === 0 || cell.trim() !== "")
    return undefined;

  return cells;
}


// keep only the edits that fall entirely inside the given line range
export function editsWithinLines(edits: LineEdit[], startLine: number, endLine: number): LineEdit[] {
  return edits.filter(e => e.startLine >= startLine && e.endLine <= endLine);
}


// ============================================================================
// providers
// ============================================================================

function resolveOpts(document: vscode.TextDocument, options: vscode.FormattingOptions): FormatOpts {

  // the indent unit always comes from the options vscode passed us for THIS document.
  // vscode resolves those from the document's TextModel, so they already account for
  // editor.tabSize / editor.insertSpaces / editor.indentSize, any [gherkin] override,
  // editor.detectIndentation, and the EditorConfig extension (which applies indent
  // settings by assigning editor.options, mutating the same TextModel).
  // do NOT re-read the editor.* configuration here - it would be less correct, not more.
  // the floor guards against a bogus tabSize silently stripping all indentation.
  const unit = options.insertSpaces ? " ".repeat(Math.max(1, Math.trunc(options.tabSize))) : "\t";

  // the whitespace / newline settings are not in vscode's native FormattingOptions
  // (they are LSP-only), so read them from files.* ourselves. the document is passed as
  // the configuration scope so that any [gherkin] override applies.
  const filesCfg = vscode.workspace.getConfiguration("files", document);
  const ourCfg = vscode.workspace.getConfiguration("gs-behave-bdd", document);

  return {
    unit,
    eol: document.eol === vscode.EndOfLine.CRLF ? "\r\n" : "\n",
    trimTrailing: filesCfg.get<boolean>("trimTrailingWhitespace", false),
    insertFinalNewline: filesCfg.get<boolean>("insertFinalNewline", false),
    trimFinalNewlines: filesCfg.get<boolean>("trimFinalNewlines", false),
    blankLines: ourCfg.get<boolean>("formatBlankLines", true),
    alignTables: ourCfg.get<boolean>("formatAlignTables", true),
  };
}


// only the most recent full-document result is kept - see the note in format()
let lastRun: { key: string, edits: LineEdit[] } | undefined;


function format(document: vscode.TextDocument, options: vscode.FormattingOptions,
  range?: vscode.Range): vscode.TextEdit[] {

  const opts = resolveOpts(document, options);

  // vscode asks the range provider for one range at a time, and editor.formatOnSaveMode
  // "modifications" can hand us a range per modified region of the document. we always
  // have to scan the whole document (the indent of a line depends on the lines above it),
  // so without this we would rescan the whole file once per range. the document version
  // covers the text, and vscode bumps it on every edit, so a cached result can't outlive
  // a change to either the content or the resolved options.
  const key = JSON.stringify([document.uri.toString(), document.version, opts]);

  let edits = lastRun && lastRun.key === key ? lastRun.edits : undefined;
  if (!edits) {
    const started = Date.now();
    const lines = getLines(document.getText());
    edits = formatFeatureLines(lines, opts);
    lastRun = { key, edits };
    logFormatRun(document, options, opts, lines.length, Date.now() - started);
  }

  // honour the requested range. note that the indent state above is still computed from
  // line 0 - we scan the whole document and filter the edits, which is what lets
  // editor.formatOnSaveMode "modifications" touch only the lines the user changed.
  const inRange = range ? editsWithinLines(edits, range.start.line, range.end.line) : edits;

  return inRange
    .map(e => new vscode.TextEdit(
      new vscode.Range(new vscode.Position(e.startLine, e.startChar), new vscode.Position(e.endLine, e.endChar)),
      e.newText));
}


// this fires on format document / format on save
export const formatFeatureProvider: vscode.DocumentFormattingEditProvider = {
  provideDocumentFormattingEdits(document: vscode.TextDocument, options: vscode.FormattingOptions) {
    try {
      return format(document, options);
    }
    catch (e: unknown) {
      // entry point function (handler) - show error
      showFormatError(document, e);
    }
  }
};


// this fires on format selection, and on format on save when editor.formatOnSaveMode
// is set to "modifications" / "modificationsIfAvailable"
export const formatFeatureRangeProvider: vscode.DocumentRangeFormattingEditProvider = {
  provideDocumentRangeFormattingEdits(document: vscode.TextDocument, range: vscode.Range,
    options: vscode.FormattingOptions) {
    try {
      return format(document, options, range);
    }
    catch (e: unknown) {
      // entry point function (handler) - show error
      showFormatError(document, e);
    }
  }
};


function showFormatError(document: vscode.TextDocument, e: unknown): void {
  try {
    const wkspUri = getWorkspaceUriForFile(document.uri);
    config.logger.showError(e, wkspUri);
  }
  catch {
    config.logger.showError(e);
  }
}


// log where the indent unit came from, so that "why did it use tabs?" is answerable from
// the output channel rather than needing a repro. a slow format gets a line of its own
// whatever the log level, so that "why was saving so slow?" is answerable the same way.
function logFormatRun(document: vscode.TextDocument, options: vscode.FormattingOptions,
  opts: FormatOpts, lineCount: number, elapsedMs: number): void {
  try {
    const wkspUri = getWorkspaceUriForFile(document.uri);
    if (!wkspUri)
      return;
    if (elapsedMs >= SLOW_FORMAT_MS)
      config.logger.logInfo(`format feature file: took ${elapsedMs}ms for ${lineCount} lines`, wkspUri);
    if (!config.globalSettings.verboseLogging)
      return;
    const unit = opts.unit === "\t" ? "1 tab" : `${opts.unit.length} space(s)`;
    config.logger.logInfo(
      `format feature file: indent unit = ${unit} per level, from the editor's resolved options ` +
      `for this document (insertSpaces=${options.insertSpaces}, tabSize=${options.tabSize}) - these ` +
      `already account for any [gherkin] override, editor.detectIndentation and .editorconfig. ` +
      `files.trimTrailingWhitespace=${opts.trimTrailing}, files.insertFinalNewline=${opts.insertFinalNewline}, ` +
      `files.trimFinalNewlines=${opts.trimFinalNewlines}, formatBlankLines=${opts.blankLines}, ` +
      `formatAlignTables=${opts.alignTables}, ${lineCount} lines formatted in ${elapsedMs}ms`,
      wkspUri);
  }
  catch {
    // diagnostics must never break formatting
  }
}
