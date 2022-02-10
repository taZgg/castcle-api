/*
 * Copyright (c) 2021, Castcle and/or its affiliates. All rights reserved.
 * DO NOT ALTER OR REMOVE COPYRIGHT NOTICES OR THIS FILE HEADER.
 *
 * This code is free software; you can redistribute it and/or modify it
 * under the terms of the GNU General Public License version 3 only, as
 * published by the Free Software Foundation.
 *
 * This code is distributed in the hope that it will be useful, but WITHOUT
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or
 * FITNESS FOR A PARTICULAR PURPOSE. See the GNU General Public License
 * version 3 for more details (a copy is included in the LICENSE file that
 * accompanied this code).
 *
 * You should have received a copy of the GNU General Public License version
 * 3 along with this work; if not, write to the Free Software Foundation,
 * Inc., 51 Franklin St, Fifth Floor, Boston, MA 02110-1301 USA.
 *
 * Please contact Castcle, 22 Phet Kasem 47/2 Alley, Bang Khae, Bangkok,
 * Thailand 10160, or visit www.castcle.com if you need additional information
 * or have any questions.
 */

import {
  ContentService,
  SocialProvider,
  SocialSyncService,
} from '@castcle-api/database';
import { SaveContentDto } from '@castcle-api/database/dtos';
import { Environment } from '@castcle-api/environments';
import { CastLogger } from '@castcle-api/logger';
import { COMMON_SIZE_CONFIGS, Downloader, Image } from '@castcle-api/utils/aws';
import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ValidateWebhookQuery } from '../youtube/dto';
import { FeedEntryChange, FeedEntryType, SubscriptionEntry } from './dto';

@Controller('facebook')
export class FacebookController {
  private logger = new CastLogger(FacebookController.name);

  constructor(
    private readonly contentService: ContentService,
    private readonly downloader: Downloader,
    private readonly socialSyncService: SocialSyncService
  ) {}

  @Get()
  async validateWebhook(
    @Query()
    {
      'hub.challenge': challenge,
      'hub.verify_token': verifyToken,
    }: ValidateWebhookQuery
  ) {
    if (verifyToken !== Environment.YOUTUBE_VERIFY_TOKEN) return;

    return challenge;
  }

  @Post()
  async handleWebhook(
    @Body('entry') entries: SubscriptionEntry<FeedEntryChange>[]
  ) {
    this.logger.log(`#handleWebhook\n${JSON.stringify(entries, null, 2)}`);

    entries.forEach(async (entry) => {
      const socialId = entry.id;
      const syncAccount =
        await this.socialSyncService.getAutoSyncAccountBySocialId(
          SocialProvider.Facebook,
          socialId
        );

      if (!syncAccount) {
        return this.logger.log(
          `#handleWebhook:sync-account-not-found:facebook-${socialId}`
        );
      }

      const author = await this.contentService.getAuthorFromId(
        syncAccount.author.id
      );

      if (!author) {
        return this.logger.log(
          `#handleWebhook:author-not-found:${syncAccount.author.id}`
        );
      }

      entry.changes.forEach(async (change) => {
        const feed = change.value;

        if (feed.verb !== FeedEntryType.ADD) {
          return this.logger.log(
            `#handleWebhook:mismatch-verb-type:${feed.post_id}`
          );
        }

        const photoUrls = feed.photos || [feed.link].filter(Boolean);
        const photos = await Promise.all(
          photoUrls.map(async (url, index) => {
            const base64Photo = await this.downloader.getImageFromUrl(url);
            const photo = await Image.upload(base64Photo, {
              filename: `facebook-${feed.post_id}-${index}`,
              sizes: COMMON_SIZE_CONFIGS,
              subpath: `contents/${socialId}`,
            });

            return { image: photo.toSignUrl() };
          })
        );

        const content = {
          type: 'short',
          payload: {
            message: feed.message,
            photo: { contents: photos },
          },
        } as SaveContentDto;

        await this.contentService.createContentsFromAuthor(author, [content]);
      });
    });
  }
}
