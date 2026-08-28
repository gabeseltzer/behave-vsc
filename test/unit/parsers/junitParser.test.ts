// Unit tests for junitParser — focusing on example row matching.
// The key bug: behave substitutes <param> values in junit output, so the
// stored junitName template ("Blenders Fail <thing> -- @1.1 Amphibians")
// never matches the actual junit entry ("Blenders Fail Red Tree Frog -- @1.1 Amphibians").

import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import * as commonModule from '../../../src/common';
import { parseJunitFileAndUpdateTestResults } from '../../../src/parsers/junitParser';
import { Scenario, ExampleRow } from '../../../src/parsers/testFile';
import { WorkspaceSettings } from '../../../src/settings';
import { QueueItem } from '../../../src/extension';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWkspSettings(featuresRelPath = 'features'): WorkspaceSettings {
  const featuresUri = vscode.Uri.file(`c:/test/${featuresRelPath}`);
  return {
    uri: vscode.Uri.file('c:/test'),
    name: 'test',
    featuresUri,
    featuresUris: [featuresUri],
    // steps under features so getjUnitName doesn't add "features." prefix
    stepsSearchUri: vscode.Uri.joinPath(featuresUri, 'steps'),
    stepsSearchUris: [vscode.Uri.joinPath(featuresUri, 'steps')],
    workspaceRelativeFeaturesPath: featuresRelPath,
    workspaceRelativeFeaturesPaths: [featuresRelPath],
    workspaceRelativeProjectPath: '',
  } as unknown as WorkspaceSettings;
}

function makeExampleRowScenario(
  outlineName: string,
  tableIndex: number,
  rowIndex: number,
  examplesName: string,
  values: string[],
  featureName = 'Mixed outline',
  featureFileName = 'outline_mixed.feature',
  featureFileRelPath = 'features/outline_mixed.feature',
): Scenario {
  const junitName = `${outlineName} -- @${tableIndex}.${rowIndex}${examplesName ? ' ' + examplesName : ''}`;
  const exampleRow: ExampleRow = { tableIndex, rowIndex, examplesName, values, junitName };
  return new Scenario(featureFileName, featureFileRelPath, featureName, outlineName, 0, false, exampleRow);
}

function makeQueueItem(scenario: Scenario): QueueItem {
  const testItem = {
    id: vscode.Uri.file('c:/test/features/outline_mixed.feature').toString() + '/' + scenario.getLabel(),
    uri: vscode.Uri.file('c:/test/features/outline_mixed.feature'),
    range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10)),
    label: scenario.getLabel(),
    children: { forEach: () => { /* noop */ } },
  } as unknown as vscode.TestItem;
  return { test: testItem, scenario };
}

function makeRun() {
  const results: { status: string; item: QueueItem }[] = [];
  return {
    run: {
      token: { isCancellationRequested: false },
      passed: (_item: vscode.TestItem, _duration?: number) => results.push({ status: 'passed', item: _item as unknown as QueueItem }),
      failed: (_item: vscode.TestItem) => results.push({ status: 'failed', item: _item as unknown as QueueItem }),
      skipped: (_item: vscode.TestItem) => results.push({ status: 'skipped', item: _item as unknown as QueueItem }),
      errored: (_item: vscode.TestItem) => results.push({ status: 'errored', item: _item as unknown as QueueItem }),
      appendOutput: () => { /* noop */ },
    } as unknown as vscode.TestRun,
    results,
  };
}

// Build a minimal junit XML string matching how behave generates it.
// Note: behave substitutes <param> values in the testcase name.
function makeJunitXml(testcases: { classname: string; name: string; status: string }[]): string {
  const cases = testcases.map(tc => {
    if (tc.status === 'failed') {
      return `  <testcase classname="${tc.classname}" name="${tc.name}" status="${tc.status}" time="0.1">\n` +
        `    <failure type="AssertionError" message="step failed">Assertion failed</failure>\n` +
        `  </testcase>`;
    }
    return `  <testcase classname="${tc.classname}" name="${tc.name}" status="${tc.status}" time="0.1"/>`;
  }).join('\n');
  return `<?xml version="1.0" ?>\n<testsuite name="test" tests="${testcases.length}" errors="0" failures="0" skipped="0" time="0.5" timestamp="2024-01-01T00:00:00" hostname="host">\n${cases}\n</testsuite>`;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

suite('junitParser - example row matching', () => {

  let getContentStub: sinon.SinonStub;
  const junitUri = vscode.Uri.file('c:/tmp/junit/TESTS-outline_mixed.xml');
  const wkspSettings = makeWkspSettings('features');

  setup(() => {
    getContentStub = sinon.stub(commonModule, 'getContentFromFilesystem');
  });

  teardown(() => {
    sinon.restore();
  });

  // The core regression: outline name contains <param>, behave substitutes it
  test('matches example row when outline name contains <param> that behave substitutes', async () => {
    // Scenario Outline: "Blenders Fail <thing>"
    // behave junit entry: "Blenders Fail Red Tree Frog -- @1.1 Amphibians"
    // our junitName:      "Blenders Fail <thing> -- @1.1 Amphibians"  ← template, does NOT match
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Blenders Fail Red Tree Frog -- @1.1 Amphibians',  // substituted by behave
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    const scenario = makeExampleRowScenario('Blenders Fail <thing>', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    try {
      await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]);
    } catch (e: unknown) {
      assert.fail(`Should not throw — got: ${typeof e} ${String(e)} ${JSON.stringify(e)}`);
    }
    assert.strictEqual(results.length, 1, 'Should have recorded one result');
    assert.strictEqual(results[0].status, 'passed');
  });

  test('matches example row without <param> in outline name (plain name, exact match still works)', async () => {
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Blenders Success paramless -- @1.1 Amphibians',
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    const scenario = makeExampleRowScenario('Blenders Success paramless', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    await assert.doesNotReject(
      () => parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi])
    );
    assert.strictEqual(results[0].status, 'passed');
  });

  test('matches by -- @tableIndex.rowIndex suffix, not by which row has which param value', async () => {
    // Two rows in different tables — each must match only its own entry
    const xml = makeJunitXml([
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Fail Red Tree Frog -- @1.1 Amphibians', status: 'passed' },
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Fail iPhone -- @2.1 Electronics', status: 'passed' },
    ]);
    getContentStub.resolves(xml);

    const row1 = makeExampleRowScenario('Blenders Fail <thing>', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const row2 = makeExampleRowScenario('Blenders Fail <thing>', 2, 1, 'Electronics', ['iPhone']);
    const qi1 = makeQueueItem(row1);
    const qi2 = makeQueueItem(row2);
    const { run, results } = makeRun();

    await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi1, qi2]);

    assert.strictEqual(results.length, 2);
    assert.strictEqual(results[0].status, 'passed', 'Row 1 (Amphibians) should be passed');
    assert.strictEqual(results[1].status, 'passed', 'Row 2 (Electronics) should be passed');
  });

  test('matches example row with unnamed Examples table (no examplesName)', async () => {
    // junit name: "Outline -- @1.1" (no trailing name)
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Blenders Success <thing> -- @1.1',
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    const scenario = makeExampleRowScenario('Blenders Success <thing>', 1, 1, '', ['Red Tree Frog']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    await assert.doesNotReject(
      () => parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi])
    );
    assert.strictEqual(results[0].status, 'passed');
  });

  test('matches correct outline when two outlines share same Examples name and row index', async () => {
    // outline_success.feature has "Blend Success" and "Blend Success 2", both with
    // Examples: Amphibians @1.1. When running only "Blend Success" @1.1, the skipped
    // entry from "Blend Success 2" must NOT be picked up instead.
    const xml = makeJunitXml([
      // "Blend Success 2" entry comes FIRST — behave lists it as skipped since -n didn't match
      { classname: 'outline_mixed.Mixed outline', name: 'Blend Success 2 -- @1.1 Amphibians', status: 'skipped' },
      // The actual entry we want
      { classname: 'outline_mixed.Mixed outline', name: 'Blend Success -- @1.1 Amphibians', status: 'passed' },
    ]);
    getContentStub.resolves(xml);

    // Queue item is for "Blend Success" (no <param>), not "Blend Success 2"
    const scenario = makeExampleRowScenario('Blend Success', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    try {
      await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]);
    } catch (e: unknown) {
      assert.fail(`Should not throw — got: ${String(e)}`);
    }
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'passed',
      'Must match "Blend Success" (passed), not "Blend Success 2" (skipped)');
  });

  test('matches correct outline when outline name has <param> and another outline has similar name', async () => {
    // "Blenders Success <thing>" and "Blenders Success paramless" both have @1.1 Amphibians
    const xml = makeJunitXml([
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Success paramless -- @1.1 Amphibians', status: 'skipped' },
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Success Red Tree Frog -- @1.1 Amphibians', status: 'passed' },
    ]);
    getContentStub.resolves(xml);

    // Queue item is for "Blenders Success <thing>" — the <thing> should become .* in matching
    const scenario = makeExampleRowScenario('Blenders Success <thing>', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    try {
      await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]);
    } catch (e: unknown) {
      assert.fail(`Should not throw — got: ${String(e)}`);
    }
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, 'passed',
      'Must match the <param> outline (passed), not "paramless" (skipped)');
  });

  test('matches example row with fallback logic when junit has different format', async () => {
    // Real-world scenario from issue: feature with unnamed Examples table
    // Feature: Test
    // Scenario Outline: Test With Examples
    //   Given I am wanting to pass this example
    //   Examples:
    //     | Description | test val |
    //     | Test        | test     |
    //
    // Behave generates: "Test With Examples -- @1.1"
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Test With Examples -- @1.1',
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    // Queue item with no examples name (unnamed Examples table)
    const scenario = makeExampleRowScenario('Test With Examples', 1, 1, '', ['Test']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    await assert.doesNotReject(
      () => parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]),
      'Should match even with fallback logic'
    );
    assert.strictEqual(results.length, 1, 'Should have one result');
    assert.strictEqual(results[0].status, 'passed', 'Result should be passed');
  });

  test('matches example row with trailing space after row index', async () => {
    // Scenario: junit testcase name has trailing space after row index
    // "Test With Examples -- @1.5 " (note the space at the end)
    // This can happen with how behave formats certain test names
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Test With Examples -- @1.5 ',
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    const scenario = makeExampleRowScenario('Test With Examples', 1, 5, '', ['Test']);
    const qi = makeQueueItem(scenario);
    const { run, results } = makeRun();

    await assert.doesNotReject(
      () => parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]),
      'Should match row with trailing space using fallback logic'
    );
    assert.strictEqual(results.length, 1, 'Should have one result');
    assert.strictEqual(results[0].status, 'passed', 'Result should be passed');
  });

  test('throws when no junit entry matches the example row suffix', async () => {
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Blenders Fail Red Tree Frog -- @1.1 Amphibians',
      status: 'passed',
    }]);
    getContentStub.resolves(xml);

    // Wrong table/row index — should not match @1.1 entry
    const scenario = makeExampleRowScenario('Blenders Fail <thing>', 1, 2, 'Amphibians', ['iPhone']);
    const qi = makeQueueItem(scenario);
    const { run } = makeRun();

    await assert.rejects(
      () => parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]),
      /could not match example row/
    );
  });

  test('failed example row propagates failure message to parent items (group and outline)', async () => {
    const xml = makeJunitXml([{
      classname: 'outline_mixed.Mixed outline',
      name: 'Blenders Fail Red Tree Frog -- @1.1 Amphibians',
      status: 'failed',
    }]);
    getContentStub.resolves(xml);

    // Build parent chain: outline → group → row
    const outlineItem = {
      id: 'outline-id',
      uri: vscode.Uri.file('c:/test/features/outline_mixed.feature'),
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10)),
      label: 'Blenders Fail <thing>',
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;
    const groupItem = {
      id: 'group-id',
      uri: vscode.Uri.file('c:/test/features/outline_mixed.feature'),
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10)),
      label: 'Amphibians',
      parent: outlineItem,
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;

    const scenario = makeExampleRowScenario('Blenders Fail <thing>', 1, 1, 'Amphibians', ['Red Tree Frog']);
    const testItem = {
      id: vscode.Uri.file('c:/test/features/outline_mixed.feature').toString() + '/@1.1 Red Tree Frog',
      uri: vscode.Uri.file('c:/test/features/outline_mixed.feature'),
      range: new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10)),
      label: scenario.getLabel(),
      parent: groupItem,
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;
    const qi: QueueItem = { test: testItem, scenario };

    const failedCalls: { itemId: string }[] = [];
    const { run } = makeRun();
    // Override failed to also capture item IDs
    (run as unknown as { failed: unknown }).failed = (item: vscode.TestItem, _msg: unknown, _dur?: number) => {
      failedCalls.push({ itemId: item.id });
    };

    await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]);

    // The row itself should be failed
    assert.ok(failedCalls.some(c => c.itemId === testItem.id),
      'Row item should have run.failed() called');
    // The group parent should also be failed
    assert.ok(failedCalls.some(c => c.itemId === groupItem.id),
      'Group item should have run.failed() called (propagated from child)');
    // The outline grandparent should also be failed
    assert.ok(failedCalls.some(c => c.itemId === outlineItem.id),
      'Outline item should have run.failed() called (propagated from child)');
  });

  test('running outline directly updates child group and row items with individual results', async () => {
    // When the user clicks play on "Blenders Fail <thing>" (the outline itself),
    // the queue has one item: the outline Scenario with isOutline=true.
    // Behave runs ALL examples and the junit XML has one entry per row.
    // The child group and row test items should each get their individual result.
    const xml = makeJunitXml([
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Fail Red Tree Frog -- @1.1 Amphibians', status: 'passed' },
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Fail ERROR -- @2.1 Electronics', status: 'failed' },
      { classname: 'outline_mixed.Mixed outline', name: 'Blenders Fail iPhone -- @2.2 Electronics', status: 'passed' },
    ]);
    getContentStub.resolves(xml);

    // Build the tree: outline → group → rows (mirroring the real test tree)
    const featureUri = vscode.Uri.file('c:/test/features/outline_mixed.feature');
    const baseRange = new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 10));

    // Row items (leaves)
    const row1_1 = {
      id: 'outline/amphibians/@1.1', label: '@1.1 Red Tree Frog', uri: featureUri, range: baseRange,
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;
    const row2_1 = {
      id: 'outline/electronics/@2.1', label: '@2.1 ERROR', uri: featureUri, range: baseRange,
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;
    const row2_2 = {
      id: 'outline/electronics/@2.2', label: '@2.2 iPhone', uri: featureUri, range: baseRange,
      children: { forEach: () => { /* noop */ } },
    } as unknown as vscode.TestItem;

    // Group items
    const amphibiansGroup = {
      id: 'outline/amphibians', label: 'Amphibians', uri: featureUri, range: baseRange,
      children: {
        forEach: (cb: (item: vscode.TestItem) => void) => [row1_1].forEach(cb),
      },
    } as unknown as vscode.TestItem;
    const electronicsGroup = {
      id: 'outline/electronics', label: 'Electronics', uri: featureUri, range: baseRange,
      children: {
        forEach: (cb: (item: vscode.TestItem) => void) => [row2_1, row2_2].forEach(cb),
      },
    } as unknown as vscode.TestItem;

    // Wire up parents
    (row1_1 as unknown as { parent: vscode.TestItem }).parent = amphibiansGroup;
    (row2_1 as unknown as { parent: vscode.TestItem }).parent = electronicsGroup;
    (row2_2 as unknown as { parent: vscode.TestItem }).parent = electronicsGroup;
    (amphibiansGroup as unknown as { parent: vscode.TestItem }).parent = undefined as unknown as vscode.TestItem;
    (electronicsGroup as unknown as { parent: vscode.TestItem }).parent = undefined as unknown as vscode.TestItem;

    // Outline item with children pointing to groups
    const outlineItem = {
      id: featureUri.toString() + '/Blenders Fail <thing>',
      label: 'Blenders Fail <thing>', uri: featureUri, range: baseRange,
      children: {
        forEach: (cb: (item: vscode.TestItem) => void) => [amphibiansGroup, electronicsGroup].forEach(cb),
      },
    } as unknown as vscode.TestItem;
    (amphibiansGroup as unknown as { parent: vscode.TestItem }).parent = outlineItem;
    (electronicsGroup as unknown as { parent: vscode.TestItem }).parent = outlineItem;

    // Queue: just the outline (as it would be when clicking play on the outline)
    const outlineScenario = new Scenario(
      'outline_mixed.feature', 'features/outline_mixed.feature', 'Mixed outline',
      'Blenders Fail <thing>', 0, true
    );
    const qi: QueueItem = { test: outlineItem, scenario: outlineScenario };

    // Track all calls by item ID
    const resultCalls: { itemId: string; status: string }[] = [];
    const run = {
      token: { isCancellationRequested: false },
      passed: (item: vscode.TestItem, _dur?: number) => resultCalls.push({ itemId: item.id, status: 'passed' }),
      failed: (item: vscode.TestItem, _msg: unknown, _dur?: number) => resultCalls.push({ itemId: item.id, status: 'failed' }),
      skipped: (item: vscode.TestItem) => resultCalls.push({ itemId: item.id, status: 'skipped' }),
      errored: (item: vscode.TestItem, _msg: unknown, _dur?: number) => resultCalls.push({ itemId: item.id, status: 'errored' }),
      appendOutput: () => { /* noop */ },
    } as unknown as vscode.TestRun;

    try {
      await parseJunitFileAndUpdateTestResults(wkspSettings, run, false, junitUri, [qi]);
    } catch (e: unknown) {
      assert.fail(`Should not throw — got: ${String(e)}`);
    }

    // Outline itself should be failed (existing behavior: picks worst result)
    assert.ok(resultCalls.some(c => c.itemId === outlineItem.id && c.status === 'failed'),
      'Outline should be marked failed');

    // Individual rows should get their own results
    assert.ok(resultCalls.some(c => c.itemId === row1_1.id && c.status === 'passed'),
      'Row @1.1 (Red Tree Frog) should be passed');
    assert.ok(resultCalls.some(c => c.itemId === row2_1.id && c.status === 'failed'),
      'Row @2.1 (ERROR) should be failed');
    assert.ok(resultCalls.some(c => c.itemId === row2_2.id && c.status === 'passed'),
      'Row @2.2 (iPhone) should be passed');

    // Groups should reflect their children's worst result
    assert.ok(resultCalls.some(c => c.itemId === amphibiansGroup.id && c.status === 'passed'),
      'Amphibians group should be passed (all children passed)');
    assert.ok(resultCalls.some(c => c.itemId === electronicsGroup.id && c.status === 'failed'),
      'Electronics group should be failed (has a failed child)');
  });

});
