import * as Brevo from "@getbrevo/brevo";
import { getEnv } from "../config/env.js";
import type { EmailAdapter, SendEmailInput } from "./types.js";

export class BrevoEmailAdapter implements EmailAdapter {
  private api: Brevo.TransactionalEmailsApi;

  constructor() {
    const env = getEnv();
    const api = new Brevo.TransactionalEmailsApi();
    api.setApiKey(Brevo.TransactionalEmailsApiApiKeys.apiKey, env.BREVO_API_KEY!);
    this.api = api;
  }

  async send(input: SendEmailInput): Promise<void> {
    const env = getEnv();
    const sendSmtpEmail = new Brevo.SendSmtpEmail();
    sendSmtpEmail.sender = {
      email: env.BREVO_SENDER_EMAIL!,
      name: env.BREVO_SENDER_NAME ?? "Obi's Chops",
    };
    sendSmtpEmail.to = [{ email: input.to }];
    sendSmtpEmail.subject = input.subject;
    sendSmtpEmail.htmlContent = input.html;
    if (input.text) {
      sendSmtpEmail.textContent = input.text;
    }
    if (input.attachments?.length) {
      sendSmtpEmail.attachment = input.attachments.map((file) => ({
        name: file.filename,
        content: file.content.toString("base64"),
      }));
    }
    await this.api.sendTransacEmail(sendSmtpEmail);
  }
}
