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

import { TopicName } from '@castcle-api/utils/queue';
import { BullModule } from '@nestjs/bull';
import { MongooseModule } from '@nestjs/mongoose';
import { Test } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { connect, disconnect, model } from 'mongoose';
import {
  CampaignService,
  MongooseAsyncFeatures,
  MongooseForFeatures,
} from '../database.module';
import { CampaignType } from '../models';
import { Campaign, CampaignSchema } from '../schemas';

describe('Campaign Service', () => {
  let mongo: MongoMemoryServer;
  let campaignService: CampaignService;
  const campaignModel = model('Campaign', CampaignSchema);
  const accountId = 'account-id';

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    connect(mongo.getUri('test'));
    const moduleRef = await Test.createTestingModule({
      imports: [
        BullModule.forRoot({}),
        BullModule.registerQueue({ name: TopicName.Campaigns }),
        MongooseModule.forRoot(mongo.getUri(), { useCreateIndex: true }),
        MongooseAsyncFeatures,
        MongooseForFeatures,
      ],
      providers: [CampaignService],
    }).compile();

    campaignService = moduleRef.get(CampaignService);
  });

  afterAll(async () => {
    await mongo.stop();
    await disconnect();
  });

  it('should be defined', () => {
    expect(campaignService).toBeDefined();
  });

  it('should return NOT_FOUND when campaign does not exist or expired', async () => {
    await expect(
      campaignService.claimCampaignsAirdrop(
        accountId,
        CampaignType.VERIFY_MOBILE
      )
    ).rejects.toThrowError('This campaign has not started');
  });

  it('should return REWARD_IS_NOT_ENOUGH when reward is not enough to claim', async () => {
    const campaign = await new campaignModel({
      name: 'Early Caster Airdrop',
      type: CampaignType.VERIFY_MOBILE,
      startDate: new Date('2022-01-17T00:00Z'),
      endDate: new Date('3000-01-20T23:59Z'),
      maxClaims: 1,
      rewardsPerClaim: 10,
      rewardBalance: 0,
      totalRewards: 100_000,
    }).save();

    await expect(
      campaignService.claimCampaignsAirdrop(
        accountId,
        CampaignType.VERIFY_MOBILE
      )
    ).rejects.toThrowError('The reward is not enough');

    await campaign.deleteOne();
  });

  describe('Verify Mobile Campaign', () => {
    let campaign: Campaign;
    let claimAirdropResponse: void;

    beforeAll(async () => {
      campaign = await new campaignModel({
        name: 'Early Caster Airdrop',
        type: CampaignType.VERIFY_MOBILE,
        startDate: new Date('2022-01-17T00:00Z'),
        endDate: new Date('3000-01-20T23:59Z'),
        maxClaims: 1,
        rewardsPerClaim: 10,
        rewardBalance: 100_000,
        totalRewards: 100_000,
      }).save();

      claimAirdropResponse = await campaignService.claimCampaignsAirdrop(
        accountId,
        CampaignType.VERIFY_MOBILE
      );
    });

    afterAll(async () => {
      await campaign.deleteOne();
    });

    it('should return NO_CONTENT when airdrop claim has been submitted successfully', async () => {
      expect(claimAirdropResponse).toBeUndefined();
    });

    it('should return REACHED_MAX_CLAIMS when user reached the maximum limit of claims', async () => {
      await expect(
        campaignService.claimCampaignsAirdrop(
          accountId,
          CampaignType.VERIFY_MOBILE
        )
      ).rejects.toThrowError('Reached the maximum limit of claims');
    });
  });

  describe('Friend Referral Campaign', () => {
    let campaign: Campaign;
    let claimAirdropResponse: void;

    beforeAll(async () => {
      campaign = await new campaignModel({
        name: 'Early Caster Airdrop',
        type: CampaignType.FRIEND_REFERRAL,
        startDate: new Date('2022-01-17T00:00Z'),
        endDate: new Date('3000-01-20T23:59Z'),
        maxClaims: 1,
        rewardsPerClaim: 10,
        rewardBalance: 100_000,
        totalRewards: 100_000,
      }).save();

      claimAirdropResponse = await campaignService.claimCampaignsAirdrop(
        accountId,
        CampaignType.FRIEND_REFERRAL
      );
    });

    afterAll(async () => {
      await campaign.deleteOne();
    });

    it('should return NO_CONTENT when airdrop claim has been submitted successfully', async () => {
      expect(claimAirdropResponse).toBeUndefined();
    });

    it('should return REACHED_MAX_CLAIMS when user reached the maximum limit of claims', async () => {
      await expect(
        campaignService.claimCampaignsAirdrop(
          accountId,
          CampaignType.FRIEND_REFERRAL
        )
      ).rejects.toThrowError('Reached the maximum limit of claims');
    });
  });
});
