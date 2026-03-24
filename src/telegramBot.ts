import { TELEGRAM_API_BASE } from './constants.js';

/**
 * Lightweight Telegram Bot API client for ask_user/notify_user MCP tools.
 * Uses long-polling to receive user replies.
 */

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export class TelegramBot {
  private botToken: string;
  private chatId: string;
  private lastUpdateId = 0;

  constructor(botToken: string, chatId: string) {
    this.botToken = botToken;
    this.chatId = chatId;
  }

  private get apiBase(): string {
    return `${TELEGRAM_API_BASE}/bot${this.botToken}`;
  }

  /**
   * Send a message to the configured Telegram chat.
   * Returns the sent message ID.
   */
  async sendMessage(text: string): Promise<number> {
    const url = `${this.apiBase}/sendMessage`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: this.chatId,
        text,
        parse_mode: 'Markdown',
      }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram sendMessage failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: TelegramMessage };
    return data.result.message_id;
  }

  /**
   * Send a message and wait for the user's reply.
   * Implements long-polling on Telegram's getUpdates API.
   * @param text The question to send
   * @param timeoutMs Maximum time to wait for a reply (0 = no limit, default: no limit)
   */
  async askUser(text: string, timeoutMs = 0): Promise<string> {
    // First flush any old pending updates so we only get new messages
    await this.flushOldUpdates();

    // Send the question
    await this.sendMessage(`🤖 *Agent Question:*\n${text}`);

    // Poll for a reply — no timeout by default (loops until reply arrives)
    const hasDeadline = timeoutMs > 0;
    const deadline = hasDeadline ? Date.now() + timeoutMs : 0;

    while (!hasDeadline || Date.now() < deadline) {
      try {
        // Use Telegram long-polling: server holds connection for up to 30 seconds
        let pollTimeout = 30;
        if (hasDeadline) {
          const remaining = Math.max(1, Math.ceil((deadline - Date.now()) / 1000));
          pollTimeout = Math.min(remaining, 30);
        }
        const url = `${this.apiBase}/getUpdates`;
        const resp = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            offset: this.lastUpdateId + 1,
            timeout: pollTimeout,
            allowed_updates: ['message'],
          }),
        });

        if (!resp.ok) {
          console.error(`[Pixel Agents] Telegram getUpdates failed: ${resp.status}`);
          // Brief pause before retrying
          await new Promise((r) => setTimeout(r, 2000));
          continue;
        }

        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
          if (update.message?.text && update.message.chat.id.toString() === this.chatId) {
            console.log(`[Pixel Agents] Telegram reply received: ${update.message.text}`);
            return update.message.text;
          }
        }
      } catch (e) {
        console.error(`[Pixel Agents] Telegram poll error: ${e}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }

    // Only reachable if there was a deadline
    throw new Error(`No reply received within ${(timeoutMs || 0) / 1000}s`);
  }

  /**
   * Flush old pending updates so we only process messages received after this point.
   */
  private async flushOldUpdates(): Promise<void> {
    try {
      const url = `${this.apiBase}/getUpdates`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          offset: this.lastUpdateId + 1,
          timeout: 0,
          allowed_updates: ['message'],
        }),
      });
      if (resp.ok) {
        const data = (await resp.json()) as { result: TelegramUpdate[] };
        for (const update of data.result) {
          this.lastUpdateId = update.update_id;
        }
      }
    } catch {
      /* ignore flush errors */
    }
  }

  /**
   * Send a one-way notification (no reply expected).
   */
  async notifyUser(text: string): Promise<void> {
    await this.sendMessage(`📋 *Agent Notification:*\n${text}`);
  }

  dispose(): void {
    // Nothing to clean up — polling is synchronous per-call
  }
}
