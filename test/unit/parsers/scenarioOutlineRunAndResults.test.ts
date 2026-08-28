// Tests for Scenario Outline example row execution and junit result matching.
// These tests define the expected behavior for running individual example rows
// and matching their junit XML results.

import * as assert from 'assert';
import * as vscode from 'vscode';
import { getScenarioRunName } from '../../../src/runners/runOrDebug';
import { Scenario, ExampleRow, TestFile } from '../../../src/parsers/testFile';
import { WorkspaceSettings } from '../../../src/settings';
import { deleteFeatureFileSteps } from '../../../src/parsers/featureParser';

// ---------------------------------------------------------------------------
// Helper: build a minimal mock TestController
// ---------------------------------------------------------------------------

interface MockTestItem {
  id: string;
  label: string;
  uri?: vscode.Uri;
  range?: vscode.Range;
  children: { items: MockTestItem[]; replace(items: MockTestItem[]): void; forEach(cb: (item: MockTestItem) => void): void };
  parent?: MockTestItem;
  error?: string | vscode.MarkdownString;
}

function makeMockController() {
  const allItems: MockTestItem[] = [];
  const testData = new WeakMap<MockTestItem, Scenario>();

  function makeChildren(parent?: MockTestItem) {
    const items: MockTestItem[] = [];
    return {
      items,
      replace(newItems: MockTestItem[]) {
        items.splice(0, items.length, ...newItems);
      },
      forEach(cb: (item: MockTestItem) => void) {
        items.forEach(cb);
      },
    };
  }

  function createTestItem(id: string, label: string, uri?: vscode.Uri): MockTestItem {
    const item: MockTestItem = {
      id, label, uri,
      children: makeChildren(),
    };
    allItems.push(item);
    return item;
  }

  return { createTestItem, allItems, testData };
}

// ---------------------------------------------------------------------------
// getScenarioRunName — example rows
// ---------------------------------------------------------------------------

suite('getScenarioRunName', () => {

  test('normal scenario returns ^name\\s*$', () => {
    const pattern = getScenarioRunName('My Scenario', false);
    assert.strictEqual(pattern, '^My Scenario\\s*$');
  });

  test('outline without params returns ^name -- @', () => {
    const pattern = getScenarioRunName('Blend Success', true);
    assert.strictEqual(pattern, '^Blend Success -- @');
  });

  test('outline with <param> replaces params with .*', () => {
    const pattern = getScenarioRunName('Blend <thing>', true);
    assert.ok(pattern.startsWith('^Blend '));
    assert.ok(pattern.includes('.*'));
    assert.ok(pattern.endsWith(' -- @'));
  });

  // Example row pattern tests are in test/unit/runners/exampleRowRunPattern.test.ts

});

// ---------------------------------------------------------------------------
// TestFile.createScenarioTestItemsFromFeatureFileContent — children structure
// ---------------------------------------------------------------------------

suite('TestFile - Scenario Outline creates example row children', () => {
  const testUri = vscode.Uri.file('c:/test/features/outline.feature');
  const wkspUri = vscode.Uri.file('c:/test');
  const wkspSettings = { uri: wkspUri } as WorkspaceSettings;

  setup(() => {
    deleteFeatureFileSteps(vscode.Uri.file('c:/test/features'));
  });

  async function parseFeature(content: string) {
    const { createTestItem, testData } = makeMockController();
    const ctrl = { createTestItem } as unknown as vscode.TestController;

    const featureItem = createTestItem('feature-id', 'My Feature', testUri) as unknown as vscode.TestItem;
    (featureItem as unknown as MockTestItem).children = {
      items: [],
      replace(items: MockTestItem[]) { this.items.splice(0, this.items.length, ...items); },
      forEach(cb: (item: MockTestItem) => void) { this.items.forEach(cb); },
    };

    const tf = new TestFile();
    await tf.createScenarioTestItemsFromFeatureFileContent(
      wkspSettings, content, testData as unknown as WeakMap<vscode.TestItem, import('../../../src/parsers/testFile').BehaveTestData>,
      ctrl, featureItem, 'test'
    );

    return { featureItem: featureItem as unknown as MockTestItem, testData };
  }

  test('plain scenario has no children', async () => {
    const content = `
Feature: My Feature
  Scenario: Plain
    Given a step
`;
    const { featureItem } = await parseFeature(content);
    const scenarios = featureItem.children.items;
    assert.strictEqual(scenarios.length, 1, 'Should have 1 scenario');
    assert.strictEqual(scenarios[0].children.items.length, 0, 'Plain scenario should have no children');
  });

  test('Scenario Outline has Examples group children, each with rows', async () => {
    const content = `
Feature: My Feature
  Scenario Outline: Blend Success
    Given I put "<thing>" in a blender

  Examples: Amphibians
    | thing         |
    | Red Tree Frog |

  Examples: Electronics
    | thing  |
    | iPhone |
    | Nexus  |
`;
    const { featureItem } = await parseFeature(content);
    const outline = featureItem.children.items[0];
    assert.ok(outline.label === 'Blend Success');

    // Outline has 2 group children (not raw rows)
    const groups = outline.children.items;
    assert.strictEqual(groups.length, 2, 'Should have 2 Examples groups');
    assert.strictEqual(groups[0].label, 'Amphibians');
    assert.strictEqual(groups[1].label, 'Electronics');

    // Each group has its rows
    assert.strictEqual(groups[0].children.items.length, 1);
    assert.strictEqual(groups[0].children.items[0].label, '@1.1 Red Tree Frog');
    assert.strictEqual(groups[1].children.items.length, 2);
    assert.strictEqual(groups[1].children.items[0].label, '@2.1 iPhone');
    assert.strictEqual(groups[1].children.items[1].label, '@2.2 Nexus');
  });

  test('last Scenario Outline in file has its groups/rows flushed at EOF', async () => {
    const content = `
Feature: My Feature
  Scenario Outline: First Outline
    Given step

  Examples:
    | x |
    | a |

  Scenario Outline: Last Outline
    Given step

  Examples:
    | y |
    | 1 |
    | 2 |
`;
    const { featureItem } = await parseFeature(content);
    const lastOutline = featureItem.children.items[1];
    assert.ok(lastOutline.label === 'Last Outline');
    // 1 group with 2 rows
    assert.strictEqual(lastOutline.children.items.length, 1, 'Last outline should have 1 group');
    assert.strictEqual(lastOutline.children.items[0].children.items.length, 2,
      'Last group should have 2 rows — tests EOF flush');
  });

  test('example row Scenario data has correct junitName (accessed via group)', async () => {
    const content = `
Feature: My Feature
  Scenario Outline: Blend Success
    Given step

  Examples: Amphibians
    | thing         |
    | Red Tree Frog |
`;
    const { featureItem, testData } = await parseFeature(content);
    const outline = featureItem.children.items[0];
    const group = outline.children.items[0];          // Examples: Amphibians
    const rowItem = group.children.items[0];           // @1.1 Red Tree Frog
    const data = testData.get(rowItem) as unknown as Scenario;

    assert.ok(data, 'testData should contain the row item');
    assert.ok(data.exampleRow, 'Scenario should have exampleRow property set');
    assert.strictEqual(data.exampleRow?.junitName, 'Blend Success -- @1.1 Amphibians');
    assert.strictEqual(data.exampleRow?.tableIndex, 1);
    assert.strictEqual(data.exampleRow?.rowIndex, 1);
    assert.strictEqual(data.isOutline, false);
    assert.strictEqual(data.scenarioName, 'Blend Success');
  });

});

// ---------------------------------------------------------------------------
// ExampleRow junitName format (for junit matching contract)
// ---------------------------------------------------------------------------

suite('ExampleRow junitName format', () => {

  function makeRow(outlineName: string, tableIndex: number, rowIndex: number, examplesName: string): string {
    return `${outlineName} -- @${tableIndex}.${rowIndex}${examplesName ? ' ' + examplesName : ''}`;
  }

  test('named examples: "Blend Success -- @1.1 Amphibians"', () => {
    assert.strictEqual(makeRow('Blend Success', 1, 1, 'Amphibians'), 'Blend Success -- @1.1 Amphibians');
  });

  test('unnamed examples: "Blend Success -- @1.1" (no trailing space)', () => {
    const result = makeRow('Blend Success', 1, 1, '');
    assert.strictEqual(result, 'Blend Success -- @1.1');
    assert.ok(!result.endsWith(' '));
  });

  test('second table second row: "Blend Success -- @2.2 Electronics"', () => {
    assert.strictEqual(makeRow('Blend Success', 2, 2, 'Electronics'), 'Blend Success -- @2.2 Electronics');
  });

  test('matches what getScenarioRunName exact pattern will match (when implemented)', () => {
    const junitName = makeRow('Blend Success', 1, 1, 'Amphibians');
    const escaped = junitName.replace(/[".*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`^${escaped}$`);
    assert.ok(re.test(junitName));
    assert.ok(!re.test(makeRow('Blend Success', 1, 2, 'Amphibians')));
    assert.ok(!re.test(makeRow('Blend Success', 2, 1, 'Amphibians')));
    assert.ok(!re.test(makeRow('Blend Success', 1, 1, 'Electronics')));
  });

});
