# jev-cli

English | [日本語](README-ja.md)

A command-line client for [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe AI's evaluation model.

Jev does not generate text. You give it a *state* (text or JSON) and typed *questions*, and it returns probabilities: a probability for a yes/no question, a pick from a set of options, or a score on a scale. `jev` builds the request from flags or a YAML file, calls the model through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/evaluation), and prints the answers as text, JSON, or Markdown.

```console
$ jev -s "I was charged twice for my subscription" \
    --bool "refund=Is the customer asking for money back?" \
    --score "urgency=How urgent is this ticket?|low,medium,high"
refund: 77.0%
  question: Is the customer asking for money back?
urgency: 1.26  (0:low 3.0% / 1:medium 68.0% / 2:high 29.0% / confidence 0.52)
  question: How urgent is this ticket?
  criteria: 0: low / 1: medium / 2: high

state:
  I was charged twice for my subscription

startedAt: 2026-09-25T06:44:50.582Z
provider: vercel / typesafe-ai/jev
elapsed: 948ms (local) / provider 97ms
tokens: input 318 / output 34
marketCost: 0.000013356
generationId: gen_01M3BMYGJ1NXKNY3CGSV78Q68H
```

## Install

Requires Node.js 22 or later.

```sh
npm install -g jev-cli
```

From source, into `~/.local/bin`:

```sh
git clone https://github.com/kazhs/jev-cli.git
cd jev-cli
pnpm install
pnpm run install-local     # builds, packs, and installs with npm --prefix ~/.local
jev --help
```

The installed copy lives in `~/.local/lib/node_modules/jev-cli` and does not depend on the clone, so you can move or delete the clone afterwards. Run `pnpm run install-local` again to update it, and `pnpm run uninstall-local` to remove it. Set `PREFIX` to install somewhere else (`PREFIX=/opt/jev pnpm run install-local` puts the command in `/opt/jev/bin`).

### With Claude Code

This repository ships a project skill, `jev-dev-install` (`.claude/skills/jev-dev-install/`). When you open the repository in Claude Code, ask it to install jev (or run `/jev-dev-install`). It then does the following:

- picks an install directory on your `PATH`, asking you when there is more than one candidate
- runs `pnpm run install-local` and checks the installed build
- checks the API key with `jev auth status`, and walks you through the Keychain or a key file if none is found
- checks the run record directory (`JEV_CLI_OUTPUT_DIR`), creating it or offering to set one up, and offers to add the `export` line to your shell configuration
- checks whether the [`jev-cli` agent skill](#agent-skill) is installed for Claude Code, and offers to install or update it

It edits your shell configuration only to add that one line, and only after you approve. It never reads or types the API key.

## Authentication

`jev` needs an [AI Gateway API key](https://vercel.com/docs/ai-gateway). It looks for the key in this order and uses the first one it finds:

1. `AI_GATEWAY_API_KEY` — the key itself
2. `AI_GATEWAY_API_KEY_FILE` — the path to a file that contains the key. Surrounding whitespace is ignored. `jev` warns if other users can read or write the file
3. The macOS Keychain (service `jev-cli`, account `vercel`)

The key is never accepted as a flag or an argument, because arguments are visible in the process list.

### macOS Keychain

```sh
jev auth set      # prompts for the key and saves it to the Keychain
jev auth status   # shows where the key would be read from, never the key itself
jev auth delete   # removes the key from the Keychain
```

`jev auth set` needs a terminal: the key is typed at a prompt from the `security` command.

### Key file

For Linux, CI, or when you do not use the Keychain:

```sh
mkdir -p ~/.config/jev
install -m 600 /dev/null ~/.config/jev/ai-gateway-key   # create an empty file readable only by you
$EDITOR ~/.config/jev/ai-gateway-key                   # paste the key
export AI_GATEWAY_API_KEY_FILE=~/.config/jev/ai-gateway-key
```

## State

`-s, --state` takes one of:

| Value | Meaning |
| --- | --- |
| `some text` | The text itself |
| `@path` | The contents of a file. `.json` files are parsed as JSON, everything else is sent as text |
| `-` | Standard input |
| `@@text` | Text that starts with `@` (`@@mention` sends `@mention`) |

A trailing newline is removed from file and stdin input.

Repeat `-s key=<value>` to combine several inputs into one JSON object:

```sh
jev -s thesis=@thesis.txt -s market=@snapshot.json --bool "consistent=Does the thesis agree with the market data?"
# state sent: { "thesis": "...", "market": { ... } }
```

`key=` is recognized only when the key is an identifier (letters, digits, `_`, not starting with a digit). To send text that begins with `word=` literally, use `@file` or `-`.

Only one `--state` can read from stdin.

## Questions

### Inline flags

```sh
# boolean: probability that the statement is true. Criteria are optional
--bool  "refund=Is the customer asking for money back?"
--bool  "passed=Did the build succeed?|true:exit code 0,false:any non-zero exit code"

# choice: pick one option. "name:description", or just "name"
--choice "route=Route this ticket|billing:payment problems,shipping:delivery problems,technical"

# score: rate on a scale, levels from lowest to highest
--score "urgency=How urgent is this ticket?|low,medium,high"
```

The instructions and the criteria are split at the last `|`, and the criteria items are separated by `,`. If a description needs `,` or `|`, use a question file.

Question names must start with a letter or `_` and contain only letters, digits, `_`, and `-`.

### Question file

```yaml
# questions/thesis.yaml
state:                   # optional: declare the keys that -s must provide
  thesis: text
  market: json

questions:
  direction:
    type: choice
    instructions: Which direction does the thesis argue for?
    criteria:
      long: expects the price to rise
      short: expects the price to fall
      neutral: no direction, or expects a range

  quality:
    type: score
    instructions: How well is the thesis supported by evidence?
    criteria:
      - no evidence
      - some evidence
      - strong evidence

  mentions_risk:
    type: boolean
    instructions: Does the thesis mention a stop loss or a risk limit?
```

```sh
jev -f questions/thesis.yaml -s thesis=@thesis.txt -s market=@snapshot.json
```

If `state` is declared, every declared key must be passed and no other keys are allowed. The declared type (`text` / `json`) takes precedence over the file extension.

A question file and inline flags can be combined. Using the same question name in both is an error.

Questions are checked before the request is sent:

| Type | `criteria` |
| --- | --- |
| `boolean` | Optional. `true` and/or `false` descriptions |
| `choice` | Option name → description, 2 to 255 options |
| `score` | Array of level descriptions, lowest first, 2 to 10 levels |

Jev evaluates all questions in a request independently and in parallel, so one question cannot refer to the answer of another.

## Output

| Flag | Effect |
| --- | --- |
| `--format text\|json\|md` | Output format. Default: `text` when stdout is a terminal, `json` otherwise |
| `-o, --output <path>` | Also write the result to a file. `.json` and `.md` choose the format; other extensions follow `--format` |
| `--raw` | Print the API response body unchanged |
| `--dry-run` | Print the request body and exit without calling the API (no key needed) |

Choice and score answers show the probability of each option or level, plus `confidence` when the API returns it. Values missing from the response are shown as `n/a` in text and Markdown, and as `null` in JSON.

Every output also records the input. Text shows each question's instructions and criteria plus the state; Markdown adds `## State` and `## Questions` sections; JSON has a `request` field. Score levels are shown with their descriptions (`3:excellent 98.0%`).

JSON output has this shape:

```json
{
  "request": {
    "model": "typesafe-ai/jev",
    "state": "I was charged twice",
    "questions": {
      "refund": { "type": "boolean", "instructions": "Is the customer asking for money back?" }
    }
  },
  "answers": {
    "refund": { "type": "boolean", "probability": 0.79 }
  },
  "meta": {
    "provider": "vercel",
    "startedAt": "2026-09-25T02:15:30.123Z",
    "model": "typesafe-ai/jev",
    "elapsedMs": 1098,
    "providerMs": 122,
    "inputTokens": 278,
    "outputTokens": 20,
    "marketCost": "0.000011676",
    "generationId": "gen_01M39ZKKYNNKFH2RNP93G2YAY0"
  }
}
```

`elapsedMs` is measured locally and includes the network round trip. `providerMs` is the provider call time recorded by the gateway.

### Run records

Set `JEV_CLI_OUTPUT_DIR` to keep every evaluation as a file, without passing `-o`:

```sh
export JEV_CLI_OUTPUT_DIR=~/jev-runs
jev -s "I was charged twice" --bool "refund=Is the customer asking for money back?"
# also writes ~/jev-runs/20260925T021530Z-gen_01M39ZKKYNNKFH2RNP93G2YAY0.json
```

Each file has the same content as `--format json` (request, answers, and meta), whatever `--format` or `--raw` is used for stdout. File names start with the UTC start time, so sorting by name gives chronological order. It works alongside `-o`. Nothing is written for `--dry-run` or when the API call fails.

## Other options

| Flag | Default |
| --- | --- |
| `--provider <name>` | `vercel` |
| `--timeout <ms>` | `30000` (1 to 2147483647) |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | API error (HTTP error, non-JSON response, timeout, network failure) |
| 2 | Usage error (flags, question file, or state) |
| 3 | Authentication (no key found, unreadable or empty key file, Keychain failure, HTTP 401 / 403) |

## Agent skill

This repository also ships an [Agent Skill](https://agentskills.io/specification), `jev-cli` (`skills/jev-cli/`), for AI coding agents that run the `jev` command for you. With it, an agent:

- turns a plain request ("classify this ticket", "does this data support the thesis?") into `boolean` / `choice` / `score` questions, avoiding the traps described in [Questions](#questions) (for example, one question cannot refer to another's answer)
- runs `jev` (a `--dry-run` first, then `--format json`) and reports each answer with its probabilities, including undecided ones
- aggregates the run records in `JEV_CLI_OUTPUT_DIR`, comparing only runs that asked the same question

The skill uses the `jev` command, so install `jev` first ([Install](#install)).

### Installing the skill

With the [GitHub CLI](https://cli.github.com/) (`gh skill` is in preview):

```sh
# Claude Code, available in every project
gh skill install kazhs/jev-cli jev-cli --agent claude-code --scope user

# Claude Code, only in the current repository
gh skill install kazhs/jev-cli jev-cli --agent claude-code --scope project
```

Pass another `--agent` value (`codex`, `cursor`, `github-copilot`, ...) for other agents; `gh skill install --help` lists them. Run the same command with `--force` to update the skill.

Without the GitHub CLI, copy the directory into your agent's skills directory. For Claude Code:

```sh
mkdir -p ~/.claude/skills
cp -R skills/jev-cli ~/.claude/skills/
```

## Development

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
```

Tests do not call the API.

## License

MIT
