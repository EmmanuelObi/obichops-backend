import type { EmailAdapter, SendEmailInput } from "./types.js";

export class StubEmailAdapter implements EmailAdapter {
  async send(input: SendEmailInput): Promise<void> {
    console.info("[StubEmailAdapter] send", {
      to: input.to,
      subject: input.subject,
      attachments: input.attachments?.map((a) => ({
        filename: a.filename,
        bytes: a.content.length,
      })),
      textPreview: (input.text ?? input.html).slice(0, 200),
    });
  }
}
