# Behave BDD

Forked from [jimasp's](https://github.com/jimasp) excellent [behave-vsc](https://github.com/jimasp/behave-vsc) extension, this one adds features!

Debug and run Python [behave](https://behave.readthedocs.io/) BDD tests using the native Visual Studio Code Test API.  
Includes two-way step navigation, Gherkin syntax highlighting, autoformatting, autocompletion, and a few basic snippets.

> [!NOTE]
> This is a vibe-coded project. I use it every day at work and personally test pre-releases before promoting them to real releases. And I write my own release notes. But the code is AI-sloppy. If you're not comfortable with that, then you should look for another extension.

## Features

### New in this fork

1. Added support for lots of VSCode language features:
    - [Ctrl + Click go to definition](https://code.visualstudio.com/docs/editing/editingevolved#_go-to-definition) in feature files
    - [Find All References](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#find-all-references-to-a-symbol) for steps in feature files
    - [Outline View](https://code.visualstudio.com/docs/getstarted/userinterface#_outline-view) in feature files
    - [Sticky Scrolling](https://code.visualstudio.com/docs/getstarted/userinterface#_sticky-scroll) for steps and fixtures in feature files
    - [Hover Definitions](https://code.visualstudio.com/api/language-extensions/programmatic-language-features#show-hovers) for steps and fixtures in feature files
    - [Selection Ranges](https://code.visualstudio.com/api/references/vscode-api#SelectionRangeProvider) in feature files
2. Added two-way navigation for **fixtures** in feature files and python definitions
3. Slightly better formatting for VSCode Test Results pane (when you run tests with the little "play" buttons or via the Testing tab).
4. Use prettier diagnostics for missing step definitions, especially while still parsing the workspace
5. Added the ability to save presets for environment variables to use when running tests.
6. Package Behave in with the extension (with the option to use a pre-installed version of behave)
7. Support for tests that aren't in the root workspace directory (ie for monorepos).
8. Support for [step libraries](https://github.com/behave/behave/blob/main/features/step.use_step_library.feature).
9. Fix issues with step parsing that was inconsistent with Behave (case sensitivity and colons).
10. **Auto-discovery** of behave projects from native config files (`behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`, `pyproject.toml`). No `featuresPaths` or `projectPath` settings needed in most cases.
11. **Monorepo support** with automatic subdirectory scanning for behave configs. Multi-path `paths` entries in config files are fully supported.
12. **Project switching** for workspaces with multiple behave projects. A status bar indicator and "Select Project" command let you switch between discovered projects.
13. **Per-notification suppression.** Click "Don't Show Again" on any suppressible notification and it stays dismissed for that workspace folder. Backed by the `gs-behave-bdd.suppressedNotifications` array setting — visible in Settings UI, editable by hand, and scoped per workspace folder.
14. **Migration from `behave-vsc`.** This fork now reads settings only from its own `gs-behave-bdd.*` namespace. On activation it scans your existing `behave-vsc.*` settings and offers per-scope consent prompts to migrate them forward. The new `gs-behave-bdd.migrationMode` and `gs-behave-bdd.completedMigrations` settings, plus the *Behave BDD: Recheck Migrations* command, give you control over when and how the migration runs.
15. **`execute_steps` IDE support.** Steps embedded in [`context.execute_steps("...")`](https://behave.readthedocs.io/en/latest/api/#behave.runner.Context.execute_steps) string literals in your Python files get the same IDE features as feature-file steps:
    - **Validation** — a Warning squiggle when an embedded step matches no step definition, and an Error squiggle on lines behave's parser would reject at runtime with a `ParserError` (junk lines, `@tags`, `Scenario:`, a leading `And`/`But`). Squiggles track the live document as you type.
    - **Go to definition** — Ctrl+Click / F12 on an embedded step jumps straight to its step definition function.
    - **Hover info** — hovering an embedded step shows the same decorator + docstring popup you get for steps in feature files.
    - **Parameter highlighting** — `{parameter}` values in embedded steps are colorized like feature-file step parameters. The color is the `gsBehaveBdd.executeStepsParameter` theme color (override it via `workbench.colorCustomizations`).
    - **Auto-completion** — typing a step inside an `execute_steps` string suggests known step definitions, with the same smart type filtering as feature files (an `And` after a `When` only suggests `@when`/`@step` definitions).
    - **Create-step quick-fix** — the lightbulb (Ctrl+.) on an undefined embedded step scaffolds a behave step-definition skeleton into the current steps file (or the workspace's largest steps file when triggered from a helper module).
    - **Reference counting** — `execute_steps` call sites are counted in the step definition's CodeLens, in "Find All Step References", and in native Find All References. The CodeLens distinguishes sources, e.g. `3 references (1 in steps)`.
    - Supported string forms: triple-quoted and single-line literals, `u`/`r` prefixes, `textwrap.dedent(...)` wrapping, and `.format(...)`/`%`-formatted literals (placeholder-bearing lines are treated as dynamic and never flagged). f-strings and non-literal arguments (variables, concatenation) are skipped entirely — they produce no diagnostics, navigation, or references. Scanned files: every `.py` under the extension's watched roots, plus any step-library file behave's registry pulls in from outside them (e.g. a `lib/` package next to `features/`). Limitations: English Gherkin keywords only (the invoking feature's `# language:` is unknowable from the Python file), and on-disk-only changes to files outside the watched roots aren't detected until the next full parse (in-editor edits are picked up immediately).

#### Migrating from `behave-vsc`

> **v1.5.0 behavior change.** Silent fallback reads of `behave-vsc.*` settings are removed. The extension only reads its own `gs-behave-bdd.*` keys at runtime. If you pick *Don't migrate* / `skip`, your legacy values stay in `settings.json` but the extension stops honoring them — copy them across manually or run *Behave BDD: Recheck Migrations* to be re-prompted.

On activation, the extension scans each unfinished migration against every VS Code scope (Global / Workspace / Workspace Folder). Three outcomes are possible per scope:

- **Neither legacy nor canonical set:** silently marked Finished. No prompt, no writes.
- **Legacy set, canonical not set:** the *case 2* prompt (controlled by `migrationMode`). Three actions: *Migrate & delete*, *Migrate & keep*, *Don't migrate*.
- **Both legacy and canonical set:** the *case 3* prompt (always shown, regardless of `migrationMode`). Four actions: *Overwrite & delete*, *Overwrite & keep*, *Keep canonical*, *Keep both*.

**`gs-behave-bdd.migrationMode`** controls case 2 only. Values:

- `prompt` (default) — show the case 2 prompt and let the user choose.
- `migrate-and-delete` — silently copy legacy → canonical, then clear the legacy key.
- `migrate-and-keep` — silently copy legacy → canonical, leave the legacy key alone.
- `skip` — silently mark Finished without copying.

Case 3 ignores this setting and always prompts.

```json
{
  "gs-behave-bdd.migrationMode": "migrate-and-delete"
}
```

**`gs-behave-bdd.completedMigrations`** is an array of migration IDs that have been finished at the current scope. Each VS Code scope (Global / Workspace / Workspace Folder) keeps its own array, so opening a new workspace folder starts with an empty list and triggers a fresh scan. The extension updates this array automatically; you rarely need to edit it by hand.

**`Behave BDD: Recheck Migrations`** (command palette) is the supported way to re-trigger the scan. It clears `completedMigrations` for the scopes you can write to and re-runs the evaluator — useful if you previously picked `skip` and changed your mind, or if you pasted `behave-vsc.*` settings into a workspace that has already been migrated.

### Old from the original extension

- Run or Debug behave tests, either from the test side bar or from inside a feature file.
- Select to run/debug all tests, a nested folder, or just a single feature or scenario.
- See failed test run result inside the feature file. (Full run results are available in the Behave BDD output window.)
- Extensive run customisation settings (e.g. `runParallel`, `featuresPaths`, `envVarOverrides`, etc.)
- Two-way step navigation:
  - "Go to Step Definition" from inside a feature file (default F12).
  - "Find All Step References" from inside a step file (default Alt+F12).
  - Quick navigate in the Step References Window (default F4 + Shift F4).
- Smart feature step auto-completion, e.g. typing `And` after a `Given` step will only show `@given` or `@step` step suggestions. (Also some snippets are thrown in.)
- Feature file formatting (default Ctrl+K,Ctrl+F).
- Automatic Gherkin syntax highlighting (colourisation), including smart parameter recognition.
- Smart test runs minimise behave instances by building an optimised `-i` regex param for behave based on the selected test nodes. (Unless `runParallel` is enabled.)
- This extension supports multi-root workspaces, so you can run features from more than one project in a single instance of vscode. (Each project folder must have its own distinct features/steps folders.)

![Behave BDD demo gif](https://github.com/jimasp/behave-vsc/raw/main/images/behave-vsc.gif)

---

## Workspace requirements

- No conflicting behave/gherkin/cucumber extension is enabled
- Extension activation requires at least one `*.feature` file somewhere in the workspace
- A compatible directory structure
- [ms-python.python](https://marketplace.visualstudio.com/items?itemName=ms-python.python) extension
- [python](https://www.python.org/)

### Required project directory structure

- A [behave-conformant](https://behave.readthedocs.io/en/stable/gherkin.html) directory structure. Note however that the features and steps folders must be somewhere *inside* the project folder (not above it).

Example 1:

```text
  . my-project
  .    +-- features/
  .    |   |   +-- my.feature
  .    |   |   +-- steps/  
  .    |   |   |   +-- steps.py
```

Example 2:

```text
  . my-project
  .    +-- features/
  .    |   |   +-- my.feature   
  .    +-- steps/
  .    |   |   +-- steps.py
```

Example 3:

```text
  . my-project
  .    +-- behave.ini
  .    +-- features/  
  .       +-- environment.py
  .       +-- steps/  
  .       |   |   +-- __init__.py
  .       |   |   +-- steps.py  
  .       +-- storage_tests/  
  .       |   +-- *.feature  
  .       +-- web_tests/  
  .       |   +-- *.feature 
  .       |   +-- steps/
  .       |   |   +-- __init__.py
  .       |   |   +-- steps.py    
```

> **Note:** In most cases you don't need these settings. The extension auto-discovers your behave project from config files. Use `projectPath` and `featuresPaths` only as manual overrides when auto-discovery doesn't suit your setup.

> **Migrating from `featuresPath`:** The previous `featuresPath` (singular) setting was removed in v1.4.0 and replaced by `featuresPaths` (plural array). If you had `featuresPath` set, the extension migrates it automatically on activation — no action required. The plural form means you can now point the extension at multiple test directories from a single workspace folder.

- If your features folder is not called "features", or is not in your project root, then you can add a behave config file (e.g. `behave.ini` or `.behaverc`) to your project folder and add a `paths` setting and then set the `featuresPaths` setting in extension settings to match. Each entry is a relative path to your project folder. For example:

```text
# behave.ini
[behave]
paths=my_tests/behave_features

// settings.json
{
  "gs-behave-bdd.featuresPaths": ["my_tests/behave_features"]
}
```

- If your behave project is not in the workspace root (e.g. in a monorepo), you can use the `projectPath` setting to specify where your behave project lives. The `featuresPaths` entries are then relative to this project path. For example:

```text
// Directory structure:
// my-workspace/
//   └── backend/
//       └── behave.ini
//       └── features/
//           └── my.feature
//           └── steps/

// settings.json
{
  "gs-behave-bdd.projectPath": "backend",
  "gs-behave-bdd.featuresPaths": ["features"]
}
```

---

## Auto-Discovery & Project Switching

The extension automatically discovers your behave project by reading native behave configuration files (`behave.ini`, `.behaverc`, `setup.cfg`, `tox.ini`, `pyproject.toml`). If any of these files exist in your workspace, the extension reads the `paths` setting and configures itself — no manual `featuresPaths` or `projectPath` settings needed.

### Multi-path configs

If your behave config specifies multiple paths (e.g. `paths = tests/features other_tests/features`), all paths are used for test discovery and step navigation.

### Monorepo scanning

For monorepos, the extension scans subdirectories (up to a configurable depth) looking for behave config files. The first discovered project becomes active automatically. You can control scan depth with the `discoveryDepth` setting (default: 3) and stop on the first hit with `discoveryStopOnFirstHit`.

### Project switching

When multiple behave projects are discovered in a workspace, a status bar indicator shows which project is active. Click it or use the **"Behave BDD: Select Project"** command to switch between projects. Switching triggers a full rebuild of the test tree and step navigation.

The status bar indicator is hidden when only one project exists or when `projectPath` is manually set.

---

## Extension settings

- This extension has various options to customise your test run via `settings.json`, e.g. `runParallel`, `featuresPaths`, and `envVarOverrides`.
- By default, the extension uses its own bundled copy of behave. If you want to use behave from your Python environment instead (e.g. for a newer version), set `importStrategy` to `"fromEnvironment"` in your `settings.json`.
- You can also disable/enable `justMyCode` for debug (via `settings.json` not `launch.json`).
- If you are using a multi-root workspace with multiple projects that contain feature files, you can set up default settings in your `*.code-workspace` file, then optionally override these as required in the `settings.json` in each workspace folder.
- For more information on available options, go to the extension settings in vscode.

---

## How it works

### How test runs work

- The python path is obtained from the `ms-python.python` extension (exported settings) i.e. your `python.defaultInterpreterPath` or selected python interpreter override. This is read before each run, so it is kept in sync with your project.

- For each run, the behave command to run the test manually appears in the `Behave BDD` output window.
- The behave process is spawned, and behave output is written to the `Behave BDD` output window for the associated workspace.
- The extension parses the junit file output and updates the test result in the UI, and any assertion failures and python exceptions are shown in the test run detail accessible in the feature file.
- You can adjust the run behaviour via extension settings in your `settings.json` file (e.g. `runParallel` and `envVarOverrides`).
- Tests runs are smart, so for example if you select to run three feature nodes it will build a behave `-i` regex to run them in a single behave instance rather than separate instances (unless you are using `runParallel`). If you choose a nested folder it will run that folder in a behave instance, etc.

### How debug works

- It dynamically builds a debug launch config with the behave command and runs that. (This is a programmatic equivalent to creating your own debug launch.json and enables the `ms-python.python` extension to do the work of debugging.)
- You can control whether debug steps into external code via the extension setting `behave-vsc.justMyCode` (i.e. in your `settings.json` *not* your `launch.json`).
- Behave stderr output (only) is shown in the debug console window. (This is to reduce noise when debugging. Run the test instead if you want to see the full behave output.)
- The extension parses the junit file output and updates the test result in the UI, and any assertion failures and python exceptions are shown in the test run detail accessible in the feature file.
- Debug is not affected by `runParallel`.

---

## Q&A

- *How can I see all effective settings for the extension?* On starting vscode, look in the Behave BDD output window.
- *How can I see the active behave configuration being used for behave execution?* In your behave config file, set `verbose=true`.
- *How do I clear previous test results?* This isn't that obvious in vscode. Click the ellipsis `...` at the top of the test side bar and then click "Clear all results".
- *Why does the behave command output contain `--show-skipped`?* This flag must be enabled for junit files (which the extension depends on) to be produced for skipped tests. It is enabled by default, so this override is there *just in case* your `behave.ini`/`.behaverc` file specifies `show_skipped=False`.
- *How can I only execute a specific set of tests while using the extension?* There are a lot of options here, but there are some examples:

  - (simple but inflexible) use the `default_tags=` setting in your behave.ini file (or a `[behave.userdata]` setting for a custom setup)
  - (higly flexible) consider if you can group them into folders, not just by tag, then you can select to run any folder/subfolder from the test tree in the UI instead.  
  - (highly flexible) consider if you can use a feature/scenario/folder naming scheme that will allow you to leverage the filtering above the test tree to enable you to run just those tests.
  - (custom) use the `envVarOverrides` extension setting to set an environment variable that is only set when running from the extension. This adds endless possibilities, but the most obvious approaches are probably: (a) setting the `BEHAVE_STAGE` environment variable, (b) to control a behave `active_tag_value_provider`, (c) to control `scenario.skip()`, or (d) to control a behave `before_all` for a completely custom setup.
- *How do I enable automatic feature file formatting on save?* You can do this via a standard vscode setting: `"[gherkin]": { "editor.formatOnSave": true }`
- *How do I control the indentation the formatter uses?* You don't configure it in this extension — the formatter uses whatever indentation vscode has resolved for the document, so `editor.insertSpaces` and `editor.tabSize` are respected, including inside a `"[gherkin]": { ... }` block and including values coming from an `.editorconfig` file (via the [EditorConfig extension](https://marketplace.visualstudio.com/items?itemName=EditorConfig.EditorConfig)). One caveat: `editor.detectIndentation` is on by default, and it overrides your configured values based on what the file already contains — so an already-tab-indented feature file will keep reporting tabs until you convert it once (**Convert Indentation to Spaces** in the command palette), or until you set `"editor.detectIndentation": false`. Turn on `gs-behave-bdd.verboseLogging` and format the file to see the resolved indent unit and where it came from in the `Behave BDD` output channel.
- *How do I stop the formatter restructuring my feature files?* Set `gs-behave-bdd.formatBlankLines` to `false` to stop it inserting blank lines before scenarios/examples/tags and collapsing blank line runs, and `gs-behave-bdd.formatAlignTables` to `false` to stop it padding table cells. With both off, the formatter only re-indents. The formatter also follows your `files.trimTrailingWhitespace`, `files.insertFinalNewline` and `files.trimFinalNewlines` settings, and never reformats the contents of a docstring (`"""` or ``` ``` ```) block.
- *How do I disable feature file snippets?* You can do this via a standard vscode setting: `"[gherkin]": { "editor.suggest.showSnippets": false }`
- *How do I disable autocomplete for feature file steps?* You can do this via a standard vscode setting: `"[gherkin]": { "editor.suggest.showFunctions": false }`
- *Why can't I see print statements in the Behave BDD output window even though I have `stdout_capture=False` in my behave config file?* Because the extension depends on the `--junit` behave argument. As per the behave docs, with this flag set, all stdout and stderr will be redirected and dumped to the junit report, regardless of the capture/no-capture options. If you want to see print statements, copy/paste the outputted command and run it manually (or run `python -m behave` for all test output).
- *Where is the behave junit output stored?* In a temp folder that is deleted (recycled) each time the extension is started. The path is displayed on startup in the Behave BDD output window. (Note that if your test run uses runParallel, then multiple files are created for the same feature via a separate folder for each scenario. This is a workaround to stop the same junit file being written multiple times for the same feature, which in runParallel mode would stop us from being able to know the result of the test because each parallel behave execution would rewrite the file and mark scenarios not included in that execution as "skipped".)
- *When will this extension have a release version?* When the code is more stable. At the moment the code is subject to rewrites/refactoring which makes bugs more likely.

---

## Troubleshooting

### If you have used a previous version of this extension

- Please read through the [release notes](https://github.com/gabeseltzer/gs-behave-bdd/releases) for breaking changes. If that does not resolve your issue, then please rollback to the previous working version via the vscode uninstall dropdown and raise an [issue](https://github.com/gabeseltzer/gs-behave-bdd/issues).
  
### Start here: get a diagnostic report

If the extension appears to do nothing — e.g. ctrl+click / F12 on a step doesn't jump to its Python
definition, or no tests appear — collect a report rather than guessing:

1. Turn on `gs-behave-bdd.verboseLogging` in settings. This makes the extension log *why* it gave up
   at every point where it would otherwise fail silently (step navigation, hover, step discovery).
2. Retry the thing that isn't working. If it's step navigation, leave the cursor on the step line.
3. Run the vscode command **`Behave BDD: Save Diagnostic Report`**. This writes a `.log` file to your
   temp folder and opens it. It contains versions, the resolved Python interpreter, the
   features/steps paths actually in use, how many step definitions were loaded, — if the cursor is
   on a step — why that specific step didn't resolve, and then the **complete log for the session**.
   Nothing is truncated, so the file can be large; that's expected, attach it as-is.
4. Skim the file (you can redact anything you'd rather not share), then attach it to a github
   [issue](https://github.com/gabeseltzer/gs-behave-bdd/issues).

> `verboseLogging` does **not** log your environment variable preset values. If you specifically
> need those in the log, enable `gs-behave-bdd.logEnvVarPresetContents` as well — but note that
> preset values may contain secrets, so review the file before sharing it.

Everything the extension writes to the `Behave BDD` output channel is also mirrored to a session
log in `<temp>/gs-behave-bdd-logs/`, one file per vscode window, which is what the report appends.
These are never truncated; logs from sessions older than 7 days are cleaned up automatically.

The three counts near the end of the report localise most problems:

| Symptom in the report | Likely cause |
| --- | --- |
| `parsed feature file steps: 0` | the configured features path doesn't contain your `.feature` files |
| `loaded step definitions: 0` | step discovery failed, or there's no `steps` folder where the extension looked |
| both non-zero but `mappings: 0` | step text doesn't match any definition's pattern, or step files failed to load (check the Problems pane) |

### Otherwise

- Does your project meet the [workspace requirements](#workspace-requirements) and have the [required project directory structure](#required-project-directory-structure)?
- If you have set the `featuresPaths` in extension settings, make sure it matches the `paths` setting in your behave configuration file.
- Did you set extension settings in your user settings instead of your workspace settings?
- Have you tried *manually* running the behave command that is logged in the Behave BDD output window?
- If you are getting different results running all tests vs running a test separately, then it is probably due to lack of test isolation.
- If you are not seeing exceptions while debugging a test, do you have the appropriate breakpoint settings in vscode, e.g. do you have "Raised Exceptions" etc. turned off?
- Do you have the correct extension [settings](#extension-settings) for your project? (See [Q&A](#qa) for information on how to see your effective settings.)
- Does restarting vscode solve your issue?
- Do you have runParallel turned on? Try turning it off.
- Do you have the latest version of the extension installed? The problem may have been fixed in a newer release. (Please note that the latest version you can install is determined by your vscode version, so you may need to update vscode first.)
- Check if the problem is in [Known Issues](#known-issues-and-limitations) below
- Check if the issue has already been reported in github [issues](https://github.com/gabeseltzer/gs-behave-bdd/issues?q=is%3Aissue).
- Try temporarily disabling other extensions.
- Have you recently upgraded vscode, and does your python/behave environment match the one tested for this release? You can check the environment tested for each release in [github](https://github.com/gabeseltzer/gs-behave-bdd/releases) and downgrade as required.
- Any extension errors should pop up in a notification window, but you can also look at debug logs and error stacks by enabling `verboseLogging` in the extension settings and using vscode command "Developer: Toggle Developer Tools". (`xRay` is the deprecated name for this; `verboseLogging` now covers both the console diagnostics and the output channel. The extension will offer to migrate the setting for you.)
- The extension is only tested with a few example projects. It's possible that something specific to your project/setup/environment is not accounted for. See [Contributing](CONTRIBUTING.md) for instructions on debugging the extension with your own project. (If you debug with your own project, you may also wish to check whether the same issue occurs with one of the example project workspaces.)

---

## Known issues and limitations

- There is currently a bug in the MS python extension if you are using `unittest`` for your python tests in a multiroot project and you hit the >> "Run Tests" button (or equivalent command) to execute all tests. This may cause your test run not to stop or not to update test results correctly. Workarounds are:
  - a. Use pytest instead of unittest to run your tests (which supports running unittest tests out of the box), or
  - b. Do not to use the >> button, i.e. run tests from a test tree node instead (e.g. `Python Tests` or `Feature Tests` separately).
- There is currently a [bug](https://github.com/microsoft/vscode-extension-samples/issues/728) in vscode itself where a test will no longer play from within the editor window when you add spaces or autoformat a feature file. A workaround is to close the feature file and reopen it.
- Test durations are taken from behave junit xml files, not an actual execution time.
- vscode always adds up test durations. For `runParallel` runs this means the parent test node reports a longer time than the test run actually took.

---

## Contributing

If you would like to submit a pull request, please see the  [contributing](CONTRIBUTING.md) doc.
