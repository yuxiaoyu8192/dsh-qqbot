/**
 * QQ 交互事件处理 — 按钮点击回调。
 *
 * 当用户点击卡片按钮时，SDK 触发 `interaction` 事件。
 * 这里把按钮点击转换成一条 user 消息，交给当前 QQ 会话对应的 Agent 处理。
 */
import type { QQBot, InteractionEvent } from '@tencent-connect/qqbot-nodejs';
import type { ContentBlock } from '@deepseek-ai/dsh-llm';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import type { SessionManager } from '../session/index.js';
import type { Logger } from '../types.js';

export function registerInteractionHandler(
  bot: QQBot,
  manager: SessionManager,
  logger: Logger,
): void {
  bot.on('interaction', async (_ctx, event: InteractionEvent) => {
    try {
      const scope: 'c2c' | 'group' =
        event.group_openid || event.group_member_openid ? 'group' : 'c2c';
      const peerId = scope === 'group'
        ? (event.group_openid ?? event.group_member_openid ?? '')
        : (event.user_openid ?? '');
      const senderId = event.group_member_openid ?? event.user_openid ?? '';

      if (!peerId) {
        logger.warn('im-qqbot: interaction ignored, missing peer id');
        return;
      }

      const buttonData = event.data.resolved.button_data ?? event.data.resolved.button_id ?? '';
      const text = `[Button clicked] ${buttonData}`;
      const content: ContentBlock[] = [{ type: 'text' as const, text }];

      const message = createUserMessage({
        content,
        source: { kind: 'user' as const },
      });

      const replyTarget = {
        scope,
        targetId: peerId,
        msgId: event.data.resolved.message_id,
      };

      const record = await manager.getOrCreate(scope, peerId, senderId, replyTarget);
      record.agent.followup(message);

      await bot.acknowledgeInteraction(event.id, 0);
      logger.info(`im-qqbot: interaction handled scope=${scope} data=${buttonData}`);
    } catch (err) {
      logger.error(`im-qqbot: interaction handler failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}
