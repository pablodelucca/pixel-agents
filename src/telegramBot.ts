import { TELEGRAM_API_BASE } from './constants.js';

/**
 * Lightweight Telegram Bot API client for ask_user/notify_user MCP tools.
 * Uses long-polling to receive user replies.
 */

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramMessage {
  message_id: number;
  chat: { id: number };
  text?: string;
  photo?: TelegramPhotoSize[];
  caption?: string;
  date: number;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

export interface TelegramReply {
  text?: string;
  image?: {
    data: string; // base64-encoded
    mimeType: string;
  };
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
   * Send a photo to the configured Telegram chat via URL.
   * Telegram will fetch the image from the provided URL.
   */
  async sendPhoto(imageUrl: string, caption?: string): Promise<number> {
    const url = `${this.apiBase}/sendPhoto`;
    const payload: Record<string, string> = {
      chat_id: this.chatId,
      photo: imageUrl,
    };
    if (caption) {
      payload.caption = caption;
      payload.parse_mode = 'Markdown';
    }
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram sendPhoto failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: TelegramMessage };
    return data.result.message_id;
  }

  /**
   * Get file info from Telegram servers.
   * Returns the file_path needed to download the file.
   */
  private async getFile(fileId: string): Promise<string> {
    const url = `${this.apiBase}/getFile`;
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ file_id: fileId }),
    });
    if (!resp.ok) {
      const body = await resp.text();
      throw new Error(`Telegram getFile failed (${resp.status}): ${body}`);
    }
    const data = (await resp.json()) as { result: { file_path: string } };
    return data.result.file_path;
  }

  /**
   * Download a file from Telegram servers and return it as a base64-encoded string.
   */
  private async downloadFile(filePath: string): Promise<{ data: string; mimeType: string }> {
    const url = `${TELEGRAM_API_BASE}/file/bot${this.botToken}/${filePath}`;
    const resp = await fetch(url);
    if (!resp.ok) {
      throw new Error(`Telegram file download failed (${resp.status})`);
    }
    const buffer = Buffer.from(await resp.arrayBuffer());
    const mimeType = resp.headers.get('content-type') || 'image/jpeg';
    return { data: buffer.toString('base64'), mimeType };
  }

  /**
   * Send a message and wait for the user's reply.
   * Implements long-polling on Telegram's getUpdates API.
   * Supports receiving text and photo replies.
   * @param text The question to send
   * @param timeoutMs Maximum time to wait for a reply (0 = no limit, default: no limit)
   * @param imageUrl Optional image URL to send alongside the question
   */
  async askUser(text: string, timeoutMs = 0, imageUrl?: string): Promise<TelegramReply> {
    // First flush any old pending updates so we only get new messages
    await this.flushOldUpdates();

    // Send the question (with optional image)
    if (imageUrl) {
      await this.sendPhoto(imageUrl, `🤖 *Agent Question:*\n${text}`);
    } else {
      await this.sendMessage(`🤖 *Agent Question:*\n${text}`);
    }

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
          const msg = update.message;
          if (!msg || msg.chat.id.toString() !== this.chatId) continue;

          // Handle text replies
          if (msg.text) {
            console.log(`[Pixel Agents] Telegram reply received: ${msg.text}`);
            return { text: msg.text };
          }

          // Handle photo replies
          if (msg.photo && msg.photo.length > 0) {
            // Get the largest photo (last in array)
            const largestPhoto = msg.photo[msg.photo.length - 1];
            try {
              const filePath = await this.getFile(largestPhoto.file_id);
              const downloaded = await this.downloadFile(filePath);
              console.log(`[Pixel Agents] Telegram photo reply received`);
              return {
                text: msg.caption || undefined,
                image: downloaded,
              };
            } catch (e) {
              console.error(`[Pixel Agents] Failed to download photo: ${e}`);
              return { text: msg.caption || '[Photo received but download failed]' };
            }
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
   * @param text The notification message
   * @param imageUrl Optional image URL to send alongside the notification
   */
  async notifyUser(text: string, imageUrl?: string): Promise<void> {
    if (imageUrl) {
      await this.sendPhoto(imageUrl, `📋 *Agent Notification:*\n${text}`);
    } else {
      await this.sendMessage(`📋 *Agent Notification:*\n${text}`);
    }
  }

  dispose(): void {
    // Nothing to clean up — polling is synchronous per-call
  }
}
