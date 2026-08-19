# @yuxiaoyu8192/dsh-qqbot

A QQ Bot IM plugin for [deepseek-harness](https://github.com/deepseek-ai/deepseek-harness) (dsh), driving the dsh agent loop with the QQ messaging platform as the frontend protocol.

[中文文档](./README.md) | English

## Architecture

```
QQ User → QQ WebSocket → dsh-im-qqbot → ctx.agents → dsh agent loop → LLM
                                 ↑                           │
                                 └── session/event ──────────┘
                                       (assistant reply → QQ sendMarkdown)
```

## Features

- C2C direct message and group message support
- Markdown replies with C2C streaming output
- Send images, videos, voice messages, and files
- Automatic voice transcoding (mp3 / flac and other common audio)
- Card messages: Markdown / Ark / Embed / custom templates + buttons
- Button click events forwarded back to the agent
- Quoted files are downloaded automatically and passed to the agent
- Session management, model switching, access control, idle eviction
- Outbound message queue to reduce the chance of hitting QQ rate limits

## Installation

### Method 1: Manual

```bash
# Add to a profile
npx @deepseek-ai/dsh plugin --profile qqbot add @yuxiaoyu8192/dsh-qqbot

# Start
npx @deepseek-ai/dsh --profile qqbot
```

On first launch, the plugin detects missing credentials and automatically starts the QR flow: a QR code is printed in the terminal → scan it with the QQ mobile app → credentials are saved to the profile, so subsequent launches require no re-scan.

<img src="./docs/assets/qrcode.png" alt="QR code scan example" width="280" />

> **Note**: Upgrade to `0.4.0` or later for browser-link scanning, which avoids QR code misalignment in some terminals.

### Method 2: Local path

```bash
# Build
cd /path/to/dsh-qqbot
pnpm install && pnpm build

# Add to a profile (local path)
npx @deepseek-ai/dsh plugin --profile qqbot add /path/to/dsh-qqbot

# Start
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh --profile qqbot
```

### Method 3: --patch dev mode

```bash
export QQBOT_APPID="yourAppID" QQBOT_SECRET="yourAppSecret"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## Configuration

| Config | Type | Default | Description |
|------|------|--------|------|
| `appId` | string | **required** | QQ Bot AppID (or via `QQBOT_APPID` env var) |
| `appSecret` | string | **required** | QQ Bot AppSecret (or via `QQBOT_SECRET` env var) |
| `provider` | string | `deepseek-official` | LLM provider name |
| `model` | string | `deepseek-chat` | Model name |
| `preset` | string | - | Agent preset id |
| `cwd` | string | `process.cwd()` | Agent working directory |
| `requireMention` | boolean | `true` | Whether group messages require @bot to trigger |
| `groupPrompt` | string | - | Extra system prompt for group chats |
| `directPrompt` | string | - | Extra system prompt for direct chats |
| `textChunkLimit` | number | `4500` | Max chars per message |
| `sessionIdleTimeout` | number | `1800000` | Session idle timeout (ms), default 30 min |
| `debug` | boolean | `false` | Debug mode |

## Built-in Commands

| Command | Description |
|------|------|
| `/new` (aliases `/reset` `/clear`) | Start a new session (clear context) |
| `/compact` | Compact session history (replace old records with a summary) |
| `/model` | View or switch model |
| `/stop` | Abort the current generation |
| `/bot-ping` | Connectivity test |
| `/bot-version` | View version info |
| `/bot-status` | View current session status |
| `/bot-help` | View all commands |

## Agent Tools

The plugin injects the following tools into dsh agents:

### `qq_send_media`

Send an image, video, voice message, or file.

```json
{
  "tool": "qq_send_media",
  "media_type": "image",
  "source": "/tmp/cat.png"
}
```

Voice messages support automatic transcoding:

```json
{
  "tool": "qq_send_media",
  "media_type": "voice",
  "source": "/tmp/voice.mp3"
}
```

### `qq_send_card`

Send card messages with Markdown / Ark / Embed / custom template support, optional image and buttons.

```json
{
  "tool": "qq_send_card",
  "mode": "markdown",
  "text": "This is a card",
  "image": "/tmp/card.png",
  "buttons": [
    { "label": "Confirm", "data": "confirm" }
  ]
}
```

Button clicks are automatically sent back to the agent.

## Core Modules

```
src/
├── index.ts                    # Cordis plugin entry (async apply)
├── config.ts                   # Config schema
├── types.ts                    # Global types
├── setup.ts                    # Credential binding (QR)
├── transport/                  # Transport layer
│   ├── inbound.ts              # QQ inbound message → agent.followup()
│   ├── outbound.ts             # session/event → QQ sendMarkdown
│   ├── outbound-buffer.ts      # Streaming buffer
│   └── chunker.ts              # Markdown chunking
├── session/                    # Session management
│   ├── session-manager.ts      # QQ peer → Agent mapping
│   └── idle-evictor.ts         # Idle eviction
├── model/                      # Model routing
│   ├── model-resolver.ts       # Route resolution
│   ├── prefs-store.ts          # Per-peer preference persistence
│   └── settings-reader.ts      # settings.yaml read-only
├── shared/                     # Shared utilities
│   ├── utils.ts                # Common helpers
│   ├── scope.ts                # scope/peer extraction
│   └── send-helper.ts          # Chunked send
├── tools/                      # Agent tools
│   ├── qq-media.ts             # Media sending tool
│   └── qq-card.ts              # Card message tool
├── gateway/
│   ├── bootstrap.ts            # Gateway bootstrap
│   ├── interaction.ts          # Button interaction handler
│   └── middleware-setup.ts     # Middleware setup
├── commands/                   # Slash commands
└── typings/                    # External module declarations
```

## Session Routing

sessionKey: `qqbot:${appId}:${scope}:${peerId}`, with the SessionId derived deterministically via SHA-256 so sessions survive restarts.

Resolution strategy: in-process reuse → persisted resume → fresh create.

## Design Principles

- **Pure Cordis plugin** — follows the dsh "Plugins, not loop changes" principle
- **Declarative dependencies** — `inject = ['agents']`, no direct coupling to other plugins
- **Session isolation** — one independent Agent per QQ direct user / group
- **Preset support** — mount presets (toolkits, prompts, etc.) via the `agent-presets` service
- **Idle eviction** — auto-dispose Agents on timeout to prevent memory leaks
- **Markdown output** — replies sent as Markdown with code-block/table-aware chunking

## Local Development

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Dev mode (watch)
pnpm dev

# Debug via --patch
export QQBOT_APPID="xxx" QQBOT_SECRET="xxx"
npx @deepseek-ai/dsh web --patch /path/to/dsh-qqbot/cordis.dev.yml
```

## License

[MIT](./LICENSE)
