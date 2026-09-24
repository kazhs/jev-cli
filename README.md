# jev-cli

A command-line client for [Jev](https://typesafe.ai/blog/introducing-system-one-models-and-jev), TypeSafe AI's evaluation model.

Jev does not generate text. You give it a *state* (text or JSON) and typed *questions*, and it returns probabilities: a probability for a yes/no question, a pick from a set of options, or a score on a scale. `jev` builds the request from flags or a YAML file, calls the model through [Vercel AI Gateway](https://vercel.com/docs/ai-gateway/modalities/evaluation), and prints the answers as text, JSON, or Markdown.

```console
$ jev -s "I was charged twice" --bool "refund=Is the customer asking for money back?"
refund: 79.0%

provider: vercel / typesafe-ai/jev
elapsed: 1098ms (local) / provider 122ms
tokens: input 278 / output 20
marketCost: 0.000011676
generationId: gen_01M39ZKKYNNKFH2RNP93G2YAY0
```

## Install

Requires Node.js 22 or later.

```sh
npm install -g jev-cli
```

From source:

```sh
git clone https://github.com/kazhs/jev-cli.git
cd jev-cli
pnpm install
pnpm build
node dist/cli.js --help
```

## Authentication

Set an [AI Gateway API key](https://vercel.com/docs/ai-gateway) in `AI_GATEWAY_API_KEY`. The key is read only from the environment. It is never accepted as a flag.

```sh
export AI_GATEWAY_API_KEY=...
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
model: typesafe-ai/jev   # optional

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

JSON output has this shape:

```json
{
  "answers": {
    "refund": { "type": "boolean", "probability": 0.79 }
  },
  "meta": {
    "provider": "vercel",
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

## Other options

| Flag | Default |
| --- | --- |
| `--model <id>` | The question file's `model`, then `typesafe-ai/jev` |
| `--provider <name>` | `vercel` |
| `--timeout <ms>` | `30000` |

## Exit codes

| Code | Meaning |
| --- | --- |
| 0 | Success |
| 1 | API error (HTTP error, non-JSON response, timeout, network failure) |
| 2 | Usage error (flags, question file, or state) |
| 3 | Authentication (key not set, HTTP 401 / 403) |

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
