// Unit tests for the feature file formatter core
//
// The core (formatFeatureLines) is deliberately vscode-free: it takes plain lines plus
// resolved options, so these tests drive it directly with no TextDocument stub. The
// helpers below turn its LineEdit descriptors back into text so each case can assert on
// the formatted result rather than on edit geometry.

import * as assert from 'assert';
import {
  formatFeatureLines, editsWithinLines, FormatOpts, LineEdit,
} from '../../../src/handlers/formatFeatureProvider';


const FOUR_SPACES = "    ";
const TWO_SPACES = "  ";
const TAB = "\t";

// matches the defaults vscode itself uses for the files.* settings, so that a test only
// has to name the option it actually cares about
function opts(overrides: Partial<FormatOpts> = {}): FormatOpts {
  return {
    unit: FOUR_SPACES,
    eol: "\n",
    trimTrailing: false,
    insertFinalNewline: false,
    trimFinalNewlines: false,
    blankLines: true,
    alignTables: true,
    ...overrides,
  };
}

// apply the edits the same way vscode would: convert each line/character position to an
// absolute offset, then splice from the end so earlier offsets stay valid
function applyEdits(text: string, edits: LineEdit[], eol: string): string {
  const lines = text.split(/\r\n|\r|\n/);

  const offsetOf = (line: number, char: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i++)
      offset += lines[i].length + eol.length;
    return offset + char;
  };

  const resolved = edits
    .map(e => ({
      start: offsetOf(e.startLine, e.startChar),
      end: offsetOf(e.endLine, e.endChar),
      newText: e.newText,
    }))
    .sort((a, b) => b.start - a.start);

  let result = text;
  for (const e of resolved) {
    assert.ok(e.end >= e.start, `edit end ${e.end} precedes start ${e.start}`);
    result = result.slice(0, e.start) + e.newText + result.slice(e.end);
  }
  return result;
}

function format(text: string, o: FormatOpts = opts()): string {
  const eol = o.eol;
  const edits = formatFeatureLines(text.split(/\r\n|\r|\n/), o);
  assertNoOverlaps(edits);
  return applyEdits(text, edits, eol);
}

// vscode rejects overlapping edits outright, so guard against ever emitting them
function assertNoOverlaps(edits: LineEdit[]): void {
  const sorted = [...edits].sort((a, b) => a.startLine - b.startLine || a.startChar - b.startChar);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const overlaps = cur.startLine < prev.endLine
      || (cur.startLine === prev.endLine && cur.startChar < prev.endChar);
    assert.ok(!overlaps,
      `edits overlap: (${prev.startLine},${prev.startChar})-(${prev.endLine},${prev.endChar}) ` +
      `and (${cur.startLine},${cur.startChar})-(${cur.endLine},${cur.endChar})`);
  }
}

function lines(...l: string[]): string {
  return l.join("\n");
}


suite('formatFeatureProvider - indent unit (F1)', () => {

  const input = lines(
    "Feature: Checkout",
    "",
    "Scenario: apply a coupon",
    "Given a cart with 2 items",
    "| sku | qty |",
  );

  test('uses spaces at the configured width when insertSpaces is on', () => {
    assert.strictEqual(format(input, opts({ unit: FOUR_SPACES, alignTables: false })), lines(
      "Feature: Checkout",
      "",
      "    Scenario: apply a coupon",
      "        Given a cart with 2 items",
      "            | sku | qty |",
    ));
  });

  test('honours a narrower tab size', () => {
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: false })), lines(
      "Feature: Checkout",
      "",
      "  Scenario: apply a coupon",
      "    Given a cart with 2 items",
      "      | sku | qty |",
    ));
  });

  test('uses a hard tab when insertSpaces is off', () => {
    assert.strictEqual(format(input, opts({ unit: TAB, alignTables: false })), lines(
      "Feature: Checkout",
      "",
      "\tScenario: apply a coupon",
      "\t\tGiven a cart with 2 items",
      "\t\t\t| sku | qty |",
    ));
  });

  test('converts pre-existing tabs to spaces', () => {
    const tabbed = lines("Feature: f", "", "\tScenario: s", "\t\tGiven x");
    assert.strictEqual(format(tabbed, opts({ unit: TWO_SPACES })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given x",
    ));
  });

});


suite('formatFeatureProvider - indent levels', () => {

  test('assigns level 0/1/2/3 by keyword', () => {
    const input = lines(
      "Feature: f",
      "",
      "Background:",
      "Given a baseline",
      "",
      "Rule: r",
      "",
      "Scenario Outline: o",
      "When <act>",
      "Then it works",
      "",
      "Examples:",
      "| act |",
      "| go  |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: false })), lines(
      "Feature: f",
      "",
      "  Background:",
      "    Given a baseline",
      "",
      "  Rule: r",
      "",
      "  Scenario Outline: o",
      "    When <act>",
      "    Then it works",
      "",
      "    Examples:",
      "      | act |",
      "      | go  |",
    ));
  });

  test('comments and tags borrow the level of the next classifiable line', () => {
    const input = lines(
      "Feature: f",
      "",
      "# about this scenario",
      "@smoke",
      "Scenario: s",
      "# about this step",
      "Given x",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "Feature: f",
      "",
      "  # about this scenario",
      "  @smoke",
      "  Scenario: s",
      "    # about this step",
      "    Given x",
    ));
  });

  test('lines above the Feature: line are moved to column 0', () => {
    const input = lines(
      "    # Copyright someone",
      "    @slow",
      "    Feature: f",
      "",
      "Scenario: s",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "# Copyright someone",
      "@slow",
      "Feature: f",
      "",
      "  Scenario: s",
    ));
  });

});


suite('formatFeatureProvider - blank lines (F7)', () => {

  test('inserts a blank line before scenarios, examples and tags', () => {
    const input = lines(
      "Feature: f",
      "Scenario: a",
      "Given x",
      "@tagged",
      "Scenario: b",
      "Given y",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "Feature: f",
      "",
      "  Scenario: a",
      "    Given x",
      "",
      "  @tagged",
      "  Scenario: b",
      "    Given y",
    ));
  });

  test('collapses a run of blank lines down to one', () => {
    const input = lines("Feature: f", "", "", "", "Scenario: s");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
    ));
  });

  test('does neither when formatBlankLines is off', () => {
    const input = lines("Feature: f", "Scenario: a", "", "", "Given x");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, blankLines: false })), lines(
      "Feature: f",
      "  Scenario: a",
      "",
      "",
      "    Given x",
    ));
  });

  test('uses the document eol for an inserted blank line, not a bare LF', () => {
    const input = ["Feature: f", "Scenario: s"].join("\r\n");
    const result = format(input, opts({ unit: TWO_SPACES, eol: "\r\n" }));
    assert.strictEqual(result, ["Feature: f", "", "  Scenario: s"].join("\r\n"));
    assert.ok(!/[^\r]\n/.test(result), `result contains a lone LF: ${JSON.stringify(result)}`);
  });

});


suite('formatFeatureProvider - docstrings (F2, F3)', () => {

  test('preserves the relative indentation of a payload', () => {
    const input = lines(
      "Feature: Order API",
      "",
      "  Scenario: create an order",
      "    Given the request body",
      "      \"\"\"",
      "      {",
      "        \"id\": 1,",
      "        \"items\": [",
      "          {\"sku\": \"A\"}",
      "        ]",
      "      }",
      "      \"\"\"",
      "    Then the response is 201",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "Feature: Order API",
      "",
      "  Scenario: create an order",
      "    Given the request body",
      "      \"\"\"",
      "      {",
      "        \"id\": 1,",
      "        \"items\": [",
      "          {\"sku\": \"A\"}",
      "        ]",
      "      }",
      "      \"\"\"",
      "    Then the response is 201",
    ));
  });

  test('shifts a payload as a block when its fence moves', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given a yaml document",
      "\"\"\"",
      "root:",
      "  child:",
      "    - one",
      "\"\"\"",
      "    Then it parses",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given a yaml document",
      "      \"\"\"",
      "      root:",
      "        child:",
      "          - one",
      "      \"\"\"",
      "    Then it parses",
    ));
  });

  test('does not inject a blank line before a docstring line starting with @', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the email template",
      "      \"\"\"",
      "      Hi there,",
      "      @support will follow up.",
      "      \"\"\"",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), input);
  });

  test('does not treat a docstring pipe line as a table row', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the markdown",
      "      \"\"\"",
      "      | ref | eta |",
      "      | 1   | now |",
      "      \"\"\"",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), input);
  });

  test('does not re-level docstring prose that looks like gherkin', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the transcript",
      "      \"\"\"",
      "      Feature: this is prose, not gherkin",
      "      And so is this",
      "      \"\"\"",
      "    Then it is stored",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), input);
  });

  test('supports backtick fences', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the snippet",
      "      ```",
      "      def f():",
      "          return 1",
      "      ```",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), input);
  });

  test('leaves everything after an unterminated fence alone', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the truncated body",
      "      \"\"\"",
      "Given this is not really a step",
      "        | nor is this a table |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), input);
  });

});


suite('formatFeatureProvider - files.* settings (F6)', () => {

  test('leaves trailing whitespace when files.trimTrailingWhitespace is off', () => {
    const input = lines("Feature: f", "", "  Scenario: s   ");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimTrailing: false })), input);
  });

  test('trims trailing whitespace when files.trimTrailingWhitespace is on', () => {
    const input = lines("Feature: f", "", "  Scenario: s   ");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimTrailing: true })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
    ));
  });

  test('never trims trailing whitespace inside a docstring', () => {
    // two trailing spaces are a hard line break in markdown, so they are content
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the markdown",
      "      \"\"\"",
      "      line one  ",
      "      line two",
      "      \"\"\"",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimTrailing: true })), input);
  });

  test('adds a final newline when files.insertFinalNewline is on', () => {
    const input = lines("Feature: f", "", "  Scenario: s");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, insertFinalNewline: true })), input + "\n");
  });

  test('does not add a final newline when the setting is off', () => {
    const input = lines("Feature: f", "", "  Scenario: s");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, insertFinalNewline: false })), input);
  });

  test('does not add a second newline when one is already there', () => {
    const input = lines("Feature: f", "", "  Scenario: s") + "\n";
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, insertFinalNewline: true })), input);
  });

  test('trims extra newlines at end of file when files.trimFinalNewlines is on', () => {
    const input = lines("Feature: f", "", "  Scenario: s") + "\n\n\n";
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimFinalNewlines: true })),
      lines("Feature: f", "", "  Scenario: s") + "\n");
  });

  test('keeps the single final newline when trimming', () => {
    const input = lines("Feature: f", "", "  Scenario: s") + "\n";
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimFinalNewlines: true })), input);
  });

  test('adds a final newline when the last line is whitespace-only', () => {
    // a whitespace-only trailing line is not a line break, so insertFinalNewline still
    // has work to do
    const input = lines("Feature: f", "", "  Scenario: s", "   ");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, insertFinalNewline: true })),
      lines("Feature: f", "", "  Scenario: s", "   ") + "\n");
  });

  test('clears a whitespace-only tail when trimming, keeping no newline there was none', () => {
    // the input does not end in a newline, and insertFinalNewline is off, so there is no
    // final newline to preserve - the whitespace-only tail just goes
    const input = lines("Feature: f", "", "  Scenario: s", "   ");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimFinalNewlines: true })),
      lines("Feature: f", "", "  Scenario: s"));
  });

  test('clears a whitespace-only tail down to one newline when both settings are on', () => {
    const input = lines("Feature: f", "", "  Scenario: s", "   ");
    assert.strictEqual(
      format(input, opts({ unit: TWO_SPACES, trimFinalNewlines: true, insertFinalNewline: true })),
      lines("Feature: f", "", "  Scenario: s") + "\n");
  });

  test('trims a whitespace-only tail after a real final newline down to that newline', () => {
    const input = lines("Feature: f", "", "  Scenario: s", "   ") + "\n";
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, trimFinalNewlines: true })),
      lines("Feature: f", "", "  Scenario: s") + "\n");
  });

});


suite('formatFeatureProvider - table alignment (F10)', () => {

  test('pads cells to the widest value per column', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the catalogue",
      "      | sku | quantity | price |",
      "      | A-1 | 2 | 9.99 |",
      "      | LONG-SKU-42 | 10 | 129.00 |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: true })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the catalogue",
      "      | sku         | quantity | price  |",
      "      | A-1         | 2        | 9.99   |",
      "      | LONG-SKU-42 | 10       | 129.00 |",
    ));
  });

  test('leaves cell padding alone when formatAlignTables is off', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the catalogue",
      "      | sku | quantity |",
      "      | LONG-SKU-42 | 10 |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: false })), input);
  });

  test('aligns each contiguous run separately', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario Outline: s",
      "    Given <a>",
      "",
      "    Examples: short",
      "      | a |",
      "      | 1 |",
      "",
      "    Examples: longer",
      "      | a |",
      "      | aaaaa |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: true })), lines(
      "Feature: f",
      "",
      "  Scenario Outline: s",
      "    Given <a>",
      "",
      "    Examples: short",
      "      | a |",
      "      | 1 |",
      "",
      "    Examples: longer",
      "      | a     |",
      "      | aaaaa |",
    ));
  });

  test('does not split a cell on an escaped pipe', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the values",
      "      | expression | result |",
      "      | a \\| b | true |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: true })), lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the values",
      "      | expression | result |",
      "      | a \\| b     | true   |",
    ));
  });

  test('leaves a run with ragged cell counts untouched', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the values",
      "      | a | b |",
      "      | 1 | 2 | 3 |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: true })), input);
  });

  test('leaves a lone pipe untouched', () => {
    const input = lines(
      "Feature: f",
      "",
      "  Scenario: s",
      "    Given the values",
      "      |",
    );
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES, alignTables: true })), input);
  });

});


suite('formatFeatureProvider - range filtering (F4)', () => {

  const input = lines(
    "Feature: f",
    "",
    "Scenario: s",
    "Given a",
    "Given b",
    "Given c",
  );

  test('keeps only edits that fall entirely inside the range', () => {
    const all = formatFeatureLines(input.split("\n"), opts({ unit: TWO_SPACES }));
    const inRange = editsWithinLines(all, 4, 4);

    assert.strictEqual(inRange.length, 1, 'exactly one line should be edited');
    assert.strictEqual(inRange[0].startLine, 4);
    assert.strictEqual(inRange[0].endLine, 4);
    assert.strictEqual(inRange[0].newText, "    Given b");
  });

  test('formatting one line leaves the rest of the document alone', () => {
    const all = formatFeatureLines(input.split("\n"), opts({ unit: TWO_SPACES }));
    const result = applyEdits(input, editsWithinLines(all, 4, 4), "\n");

    assert.strictEqual(result, lines(
      "Feature: f",
      "",
      "Scenario: s",
      "Given a",
      "    Given b",
      "Given c",
    ));
  });

  test('an empty range yields no edits', () => {
    const all = formatFeatureLines(input.split("\n"), opts({ unit: TWO_SPACES }));
    assert.strictEqual(editsWithinLines(all, 1, 1).length, 0);
  });

});


suite('formatFeatureProvider - idempotence', () => {

  const cases: { name: string, text: string, o: FormatOpts }[] = [
    {
      name: 'a scenario outline with tables and a docstring',
      o: opts({ unit: FOUR_SPACES, trimTrailing: true, insertFinalNewline: true, trimFinalNewlines: true }),
      text: lines(
        "@feature-tag",
        "Feature: Checkout",
        "# a comment",
        "Background:",
        "Given a signed in shopper",
        "Scenario Outline: apply a coupon",
        "Given a cart containing",
        "| sku | quantity |",
        "| A-1 | 2 |",
        "When I apply the coupon <code>",
        "Then the response body is",
        "\"\"\"",
        "{",
        "  \"discount\": 10",
        "}",
        "\"\"\"",
        "Examples:",
        "| code |",
        "| SAVE10 |",
      ),
    },
    {
      name: 'a tab indented file formatted to spaces',
      o: opts({ unit: TWO_SPACES }),
      text: lines("Feature: f", "\tScenario: s", "\t\tGiven x", "\t\t\t| a | bb |"),
    },
    {
      name: 'a crlf file',
      o: opts({ unit: TWO_SPACES, eol: "\r\n" }),
      text: ["Feature: f", "Scenario: s", "Given x"].join("\r\n"),
    },
    {
      name: 'blank line and table formatting disabled',
      o: opts({ unit: TAB, blankLines: false, alignTables: false }),
      text: lines("Feature: f", "Scenario: s", "Given x", "| a | bb |"),
    },
  ];

  for (const c of cases) {
    test(`formatting is stable for ${c.name}`, () => {
      const once = format(c.text, c.o);
      const twice = format(once, c.o);
      assert.strictEqual(twice, once, 'a second format should be a no-op');

      const secondPassEdits = formatFeatureLines(once.split(/\r\n|\r|\n/), c.o);
      assert.deepStrictEqual(secondPassEdits, [], 'a second format should produce no edits at all');
    });
  }

});


suite('formatFeatureProvider - edge cases', () => {

  test('an empty document produces no edits', () => {
    assert.deepStrictEqual(formatFeatureLines([""], opts()), []);
  });

  test('a document with no Feature: line is left at column 0', () => {
    const input = lines("# just a comment", "  @a-tag");
    assert.strictEqual(format(input, opts({ unit: TWO_SPACES })), lines("# just a comment", "@a-tag"));
  });

  test('a blank-only document produces no edits', () => {
    assert.deepStrictEqual(
      formatFeatureLines(["", "", ""], opts({ insertFinalNewline: true, trimFinalNewlines: true })), []);
  });

});

// these guard the scaling of the core, not its absolute speed - a run of lines the
// formatter can't classify (comments, tags, description prose) used to make it borrow a
// level by scanning down from each one, which cost O(n^2): a feature file with a few
// thousand commented-out lines took seconds to format on save.
suite('formatFeatureProvider - scaling', () => {

  // deliberately loose - the quadratic version took ~3.7s for this input, and the linear
  // one takes single-digit ms, so a slow CI machine can be an order of magnitude out and
  // this still tells us which one we have
  const BUDGET_MS = 750;

  function timeFormat(input: string[]): number {
    const started = Date.now();
    formatFeatureLines(input, opts());
    return Date.now() - started;
  }

  test('a long run of comment lines does not blow up', () => {
    const input = ["Feature: big", "Scenario: s", "Given a step"];
    for (let i = 0; i < 6000; i++)
      input.push(`#   Given a commented out step ${i}`);
    const elapsed = timeFormat(input);
    assert.ok(elapsed < BUDGET_MS, `${input.length} commented lines took ${elapsed}ms`);
  });

  test('a long run of description prose does not blow up', () => {
    const input = ["Feature: big"];
    for (let i = 0; i < 6000; i++)
      input.push(`  free form description line ${i}`);
    input.push("Scenario: s", "Given a step");
    const elapsed = timeFormat(input);
    assert.ok(elapsed < BUDGET_MS, `${input.length} prose lines took ${elapsed}ms`);
  });

  test('a long docstring does not blow up', () => {
    const input = ["Feature: big", "Scenario: s", "Given a payload", '"""'];
    for (let i = 0; i < 6000; i++)
      input.push(`  payload line ${i}`);
    input.push('"""');
    const elapsed = timeFormat(input);
    assert.ok(elapsed < BUDGET_MS, `${input.length} docstring lines took ${elapsed}ms`);
  });

  test('a large feature file of ordinary gherkin does not blow up', () => {
    const input = ["Feature: big"];
    for (let i = 0; i < 2000; i++)
      input.push("", `@tag${i}`, `# scenario ${i}`, `Scenario: s${i}`, "Given a", "When b", "Then c");
    const elapsed = timeFormat(input);
    assert.ok(elapsed < BUDGET_MS, `${input.length} lines took ${elapsed}ms`);
  });

});
