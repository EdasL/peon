/**
 * Slack file handler implementation.
 */

import { Readable } from "node:stream";
import { createLogger, sanitizeFilename } from "@lobu/core";
import type { WebClient } from "@slack/web-api";
import { BaseFileHandler } from "../platform/base-file-handler";
import type {
  FileMetadata,
  FileUploadOptions,
  FileUploadResult,
} from "../platform/file-handler";
import type { SlackInstallationStore } from "./installation-store";

const logger = createLogger("slack-file-handler");

interface SlackFileMetadata extends FileMetadata {
  url_private: string;
  url_private_download: string;
}

export class SlackFileHandler extends BaseFileHandler {
  private bearerToken: string;
  private installationStore?: SlackInstallationStore;

  constructor(
    private slackClient: WebClient,
    bearerToken?: string,
    installationStore?: SlackInstallationStore
  ) {
    super();
    this.bearerToken = bearerToken || process.env.SLACK_BOT_TOKEN || "";
    this.installationStore = installationStore;
    if (!this.bearerToken && !installationStore) {
      logger.warn("No Slack bearer token provided - file downloads will fail");
    }
  }

  /**
   * Resolve the bearer token for a given team.
   * Falls back to the default token if no team-specific token is found.
   */
  async resolveToken(teamId?: string): Promise<string> {
    if (teamId && this.installationStore) {
      const token = await this.installationStore.getTokenForTeam(teamId);
      if (token) return token;
    }
    return this.bearerToken;
  }

  async downloadFile(
    fileId: string
  ): Promise<{ stream: Readable; metadata: FileMetadata }> {
    if (!this.bearerToken) {
      throw new Error("Slack bearer token not configured for file downloads");
    }

    const fileInfo = await this.slackClient.files.info({ file: fileId });

    if (!fileInfo.ok || !fileInfo.file) {
      throw new Error(`Failed to get file info: ${fileInfo.error}`);
    }

    const file = fileInfo.file as any;
    const metadata: SlackFileMetadata = {
      id: file.id,
      name: file.name,
      mimetype: file.mimetype,
      size: file.size,
      url: file.url_private,
      url_private: file.url_private,
      url_private_download: file.url_private_download,
      downloadUrl: file.url_private_download,
      permalink: file.permalink,
      timestamp: file.timestamp,
    };

    const response = await fetch(metadata.url_private_download, {
      headers: { Authorization: `Bearer ${this.bearerToken}` },
    });

    if (!response.ok) {
      throw new Error(`Failed to download file: ${response.statusText}`);
    }

    return {
      stream: Readable.fromWeb(response.body as any),
      metadata,
    };
  }

  async uploadFile(
    fileStream: Readable,
    options: FileUploadOptions
  ): Promise<FileUploadResult> {
    const safeFilename = sanitizeFilename(options.filename);

    const chunks: Buffer[] = [];
    for await (const chunk of fileStream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const fileBuffer = Buffer.concat(chunks);

    logger.info(
      `Uploading ${safeFilename} (${fileBuffer.length} bytes) to ${options.channelId}`
    );

    const uploadParams: any = {
      channel_id: options.channelId,
      filename: safeFilename,
      file: fileBuffer,
      title: options.title || safeFilename,
      ...(options.threadTs && { thread_ts: options.threadTs }),
      ...(options.initialComment && {
        initial_comment: options.initialComment,
      }),
    };

    const result = await this.slackClient.files.uploadV2(uploadParams);

    if (!result.ok) {
      throw new Error(`Failed to upload file: ${result.error}`);
    }

    const files = (result as any).files;
    if (!files?.length) {
      throw new Error("Upload succeeded but no file info returned");
    }

    const file = files[0];

    if (options.sessionKey) {
      this.trackUpload(options.sessionKey, file.id);
    }

    return {
      fileId: file.id,
      permalink: file.permalink || file.url_private,
      name: file.name,
      size: file.size || fileBuffer.length,
    };
  }
}
