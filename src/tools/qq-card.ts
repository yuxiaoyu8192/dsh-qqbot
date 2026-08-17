/**
 * QQ 卡片消息工具 — 注入到 dsh tools 注册表，供 Agent 发送带图片和按钮的卡片消息。
 *
 * 支持：
 * - Markdown 正文
 * - 远程图片 URL（Markdown 图片）
 * - 本地图片（自动上传后以图片消息 + 文字 + 可选按钮发送）
 * - 可选按钮（不传按钮时就是普通卡片/图文消息）
 */
import type { Context } from '@deepseek-ai/cordis';
import { MediaFileType, MsgType, type QQBot } from '@tencent-connect/qqbot-nodejs';
import type { SessionManager } from '../session/index.js';
import type { DshAgent } from '../session/types.js';
import type { Logger } from '../types.js';

/** dsh tools 注册表的最小接口 */
interface ToolsRegistryLike {
  register(tool: unknown): void;
}

/** 工具执行上下文（dsh 传入） */
interface ToolExecContext {
  agent?: DshAgent;
  signal?: AbortSignal;
}

/** 卡片按钮参数 */
interface CardButtonArg {
  label?: string;
  data?: string;
  style?: number;
}

/** 卡片工具参数 */
interface QQSendCardArgs {
  text?: string;
  image?: string;
  image_url?: string;
  buttons?: CardButtonArg[];
}

function toJsonSchema(spec: Record<string, { type: string; required?: boolean; description?: string; items?: unknown }>) {
  const properties: Record<string, { type: string; description?: string; items?: unknown }> = {};
  const required: string[] = [];

  for (const [key, meta] of Object.entries(spec)) {
    const prop: { type: string; description?: string; items?: unknown } = { type: meta.type };
    if (meta.description) prop.description = meta.description;
    if (meta.items) prop.items = meta.items;
    properties[key] = prop;
    if (meta.required) required.push(key);
  }

  return { type: 'object', properties, required, additionalProperties: false };
}

/**
 * 注册 QQ 卡片消息工具。
 */
export function registerQQCardTools(
  ctx: Context,
  manager: SessionManager,
  bot: QQBot,
  logger: Logger,
): void {
  const tools = getToolsRegistry(ctx);
  if (!tools) {
    logger.debug('im-qqbot: tools service unavailable, skip QQ card tool registration');
    return;
  }

  tools.register({
    name: 'qq_send_card',
    description: [
      'Send a card-style message with optional image and buttons to the current QQ conversation.',
      'Use image for a local image path or HTTPS image URL, and buttons for clickable button rows.',
      'Local images are uploaded automatically before sending.',
      'Buttons are optional; the card can be sent without buttons.',
      'Button clicks are delivered back to the agent as user messages.',
    ].join('\n'),
    parameters: toJsonSchema({
      text: {
        type: 'string',
        required: true,
        description: 'Markdown text content of the card',
      },
      image: {
        type: 'string',
        required: false,
        description: 'Local image path or HTTPS image URL to show in the card',
      },
      image_url: {
        type: 'string',
        required: false,
        description: 'HTTPS image URL to show in the card (deprecated alias of image)',
      },
      buttons: {
        type: 'array',
        required: false,
        description: 'List of buttons: { label, data, style? }',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Button label' },
            data: { type: 'string', description: 'Button callback data' },
            style: { type: 'number', description: 'Button style (optional)' },
          },
          required: ['label', 'data'],
        },
      },
    }),
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string' },
        },
        required: ['text'],
      },
      render: (_args: unknown, value: { text?: string }) => [{ type: 'text', text: value.text ?? '' }],
    },
    async execute(args: QQSendCardArgs, exec: ToolExecContext) {
      const text = args.text?.trim();
      if (!text) {
        return { text: '❌ 请提供卡片 text 内容' };
      }

      const agent = exec?.agent;
      if (!agent) {
        return { text: '❌ 无法获取当前 Agent 上下文' };
      }

      const record = manager.findByAgent(agent);
      if (!record) {
        return { text: '❌ 找不到当前 QQ 会话，无法发送卡片' };
      }

      const image = args.image?.trim() ?? args.image_url?.trim();
      const buttons = Array.isArray(args.buttons) ? args.buttons.filter(b => b?.label && b?.data) : [];

      const keyboard = buttons.length > 0
        ? {
            content: {
              rows: [
                {
                  buttons: buttons.map((b, index) => ({
                    id: `card-btn-${index}`,
                    render_data: {
                      label: b.label!,
                      visited_label: b.label!,
                      style: b.style ?? 1,
                    },
                    action: {
                      type: 2,
                      permission: { type: 2 },
                      data: b.data!,
                    },
                  })),
                },
              ],
            },
          }
        : undefined;

      try {
        if (image && !/^https?:\/\//i.test(image)) {
          // 本地图片：先上传，再以“图片 + 文字 + 可选按钮”的消息发送
          const upload = await bot.uploadMedia({
            target: record.replyTarget,
            fileType: MediaFileType.IMAGE,
            localPath: image,
          });
          await bot.send({
            target: record.replyTarget,
            msgType: MsgType.MEDIA,
            media: { file_info: upload.file_info },
            content: text,
            ...(keyboard ? { keyboard } : {}),
          });
        } else {
          // 远程图片 URL 或无图片：使用 Markdown 卡片
          const content = image
            ? `![#400px #300px](${image})\n\n${text}`
            : text;
          await bot.sendMarkdown(
            record.replyTarget,
            content,
            keyboard ? { keyboard } : undefined,
          );
        }
        return { text: '✅ 卡片已发送' };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        logger.error(`im-qqbot: send card failed: ${message}`);
        return { text: `❌ 发送卡片失败: ${message}` };
      }
    },
  });

  logger.info('im-qqbot: QQ card tool registered (qq_send_card)');
}

function getToolsRegistry(ctx: Context): ToolsRegistryLike | undefined {
  try {
    const service = ctx.get('tools') as ToolsRegistryLike | undefined;
    if (service) return service;
  } catch {
    // ignore
  }

  return (ctx as unknown as { tools?: ToolsRegistryLike }).tools;
}
