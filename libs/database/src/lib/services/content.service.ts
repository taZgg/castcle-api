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
import { Environment } from '@castcle-api/environments';
import { CastLogger } from '@castcle-api/logger';
import { CastcleRegExp } from '@castcle-api/utils/commons';
import { CastcleException } from '@castcle-api/utils/exception';
import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { getLinkPreview } from 'link-preview-js';
import * as mongoose from 'mongoose';
import { FilterQuery, Model, Types } from 'mongoose';
import { createTransport } from 'nodemailer';
import { ContentAggregator } from '../aggregations';
import {
  Author,
  CastcleContentQueryOptions,
  CastcleIncludes,
  CommentDto,
  ContentPayloadItem,
  ContentResponse,
  ContentsResponse,
  ContentType,
  createFilterQuery,
  DEFAULT_CONTENT_QUERY_OPTIONS,
  EntityVisibility,
  FeedItemDto,
  GetLinkPreview,
  GetSearchRecentDto,
  GuestFeedItemDto,
  IncludeUser,
  Link,
  LinkType,
  Meta,
  SaveContentDto,
  ShortPayload,
  SortDirection,
  UpdateCommentDto,
} from '../dtos';
import {
  Comment,
  User,
  UserType,
  Account,
  CommentType,
  Content,
  toSignedContentPayloadItem,
  Engagement,
  EngagementType,
  FeedItem,
  GuestFeedItem,
  GuestFeedItemType,
  Relationship,
  Revision,
} from '../schemas';
import {
  createCastcleFilter,
  createCastcleMeta,
  createPagination,
} from '../utils/common';
import { HashtagService } from './hashtag.service';

@Injectable()
export class ContentService {
  private logger = new CastLogger(ContentService.name);
  private transporter = createTransport({
    host: Environment.SMTP_HOST,
    port: Environment.SMTP_PORT,
    secure: true,
    auth: {
      user: Environment.SMTP_USERNAME,
      pass: Environment.SMTP_PASSWORD,
    },
  });

  constructor(
    @InjectModel('Account') public _accountModel: Model<Account>,
    @InjectModel('Credential')
    public _credentialModel: Model<Credential>,
    @InjectModel('User')
    public _userModel: Model<User>,
    @InjectModel('Content')
    public _contentModel: Model<Content>,
    @InjectModel('Revision')
    public _revisionModel: Model<Revision>,
    @InjectModel('Engagement')
    public _engagementModel: Model<Engagement>,
    @InjectModel('Comment')
    public _commentModel: Model<Comment>,
    @InjectModel('FeedItem')
    public _feedItemModel: Model<FeedItem>,
    public hashtagService: HashtagService,
    @InjectModel('GuestFeedItem')
    public _guestFeedItemModel: Model<GuestFeedItem>,
    @InjectModel('Relationship')
    private relationshipModel: Model<Relationship>
  ) {}

  /**
   * @param {string} contentId
   */
  getContentById = async (contentId: string) => {
    const content = await this._contentModel
      .findOne({ _id: contentId, visibility: EntityVisibility.Publish })
      .exec();

    if (!content) throw CastcleException.REQUEST_URL_NOT_FOUND;

    return content;
  };

  /**
   *
   * @param {User} user the user that create this content if contentDto has no author this will be author by default
   * @param {SaveContentDto} contentDto the content Dto that required for create a content
   * @returns {Content} content.save() result
   */
  async createContentFromUser(user: User, contentDto: SaveContentDto) {
    const author = this._getAuthorFromUser(user);
    const hashtags = this.hashtagService.extractHashtagFromContentPayload(
      contentDto.payload
    );

    await this.hashtagService.createFromTags(hashtags);
    await this.updatePayloadMessage(contentDto.payload);

    const newContent = {
      author: author,
      payload: contentDto.payload,
      revisionCount: 0,
      type: contentDto.type,
      visibility: EntityVisibility.Publish,
      hashtags: hashtags,
    } as Content;
    const content = new this._contentModel(newContent);

    return content.save();
  }

  /**
   *
   * @param {Author} author the user that create this content
   * @param {SaveContentDto[]} contentsDtos contents to save
   * @returns {Content[]} saved contents
   */
  async createContentsFromAuthor(
    author: Author,
    contentsDtos: SaveContentDto[]
  ): Promise<Content[]> {
    const contentsToCreate = contentsDtos.map(async ({ payload, type }) => {
      const hashtags =
        this.hashtagService.extractHashtagFromContentPayload(payload);

      await this.hashtagService.createFromTags(hashtags);
      await this.updatePayloadMessage(payload);

      return {
        author,
        payload,
        revisionCount: 0,
        type,
        visibility: EntityVisibility.Publish,
        hashtags: hashtags,
      } as Content;
    });

    const contents = await Promise.all(contentsToCreate);

    return this._contentModel.create(contents);
  }

  async getAuthorFromId(authorId: string) {
    const user = await this._userModel.findById(authorId);

    return this._getAuthorFromUser(user);
  }

  updatePayloadMessage = async (shortPayload: ShortPayload) => {
    const LAST_LINK_PATTERN = / https?:\/\/[0-9A-Za-z-.@:%_+~#=/]+$/;
    const linkIndex = shortPayload.message?.search(LAST_LINK_PATTERN);

    if (linkIndex >= 0) {
      const twitterLink = shortPayload.message.slice(linkIndex);
      const linkPreview = (await getLinkPreview(twitterLink)) as GetLinkPreview;
      const link = {
        type: LinkType.Other,
        url: linkPreview.url,
        title: linkPreview.title,
        description: linkPreview.description,
        imagePreview: linkPreview.images?.[0],
      } as Link;

      shortPayload.message = shortPayload.message.slice(0, linkIndex);
      shortPayload.link = shortPayload.link
        ? [...shortPayload.link, link]
        : [link];
    }
  };

  /**
   *
   * @param {string} id get content from content's id
   */
  getContentFromId = (id: string) => {
    return this._contentModel
      .findOne({ _id: id, visibility: EntityVisibility.Publish })
      .exec();
  };

  /**
   * @param {string} id content ID
   * @throws {CastcleException} with CastcleStatus.REQUEST_URL_NOT_FOUND
   */
  findContent = async (id: string) => {
    const content = await this.getContentFromId(id);

    if (!content) throw CastcleException.REQUEST_URL_NOT_FOUND;

    return content;
  };

  /**
   * Set content visibility to deleted
   * @param {string} id
   * @returns {Content}
   */
  deleteContentFromId = async (id: string) => {
    const content = await this._contentModel.findById(id).exec();
    content.visibility = EntityVisibility.Deleted;
    //remove engagement
    if (content.isRecast || content.isQuote) {
      const engagement = await this._engagementModel
        .findOne({ itemId: content._id })
        .exec();
      await engagement.remove();
    }
    if (content.hashtags) {
      this.hashtagService.removeFromTags(content.hashtags);
    }
    console.debug('*********deleteContentFromId', id);
    return content.save();
  };

  getRecastContent = (originalPostId: string, authorId: string) => {
    return this._contentModel
      .findOne({
        'author.id': mongoose.Types.ObjectId(authorId),
        'originalPost._id': mongoose.Types.ObjectId(originalPostId),
        isRecast: true,
      })
      .exec();
  };

  /**
   * Delete Recast Content from orginal post and author
   * @param {string} originalPostId
   * @param {string} authorId
   * @returns {null}
   */
  deleteRecastContentFromOriginalAndAuthor = async (
    originalPostId: string,
    authorId: string
  ) => {
    this.logger.log('get content for delete.');
    const content = await this.getRecastContent(originalPostId, authorId);

    if (!content) return;

    this.logger.log('delete engagement.');
    await this._engagementModel
      .findOneAndRemove({ itemId: content._id })
      .exec();
    if (content.hashtags) {
      this.hashtagService.removeFromTags(content.hashtags);
    }
    this.logger.log('delete content.');
    await content.remove();
  };
  /**
   * update aggregator of recast/quote and get content status back to publish
   * @param {string} id of content
   * @returns {Content | null}
   */
  recoverContentFromId = async (id: string) => {
    const content = await this._contentModel.findById(id).exec();
    if (content.visibility !== EntityVisibility.Publish) {
      //recover engagement quote/recast
      if (content.isQuote || content.isRecast) {
        const sourceContent = await this._contentModel
          .findById(content.originalPost)
          .exec();
        const engagementType = content.isQuote
          ? EngagementType.Quote
          : EngagementType.Recast;
        const incEngagement: { [key: string]: number } = {};
        incEngagement[`engagements.${engagementType}.count`] = 1;
        //use update to byPass save hook to prevent recursive and revision api
        const updateResult = await this._contentModel
          .updateOne(
            { _id: sourceContent._id },
            {
              $inc: incEngagement,
            }
          )
          .exec();
        //if update not success return false
        console.log(updateResult);
      }
      content.visibility = EntityVisibility.Publish;
      return content.save();
    } else return null; //content already recover;
  };

  /**
   *
   * @param {string} id
   * @param {SaveContentDto} contentDto
   * @returns {Content}
   */
  updateContentFromId = async (id: string, contentDto: SaveContentDto) => {
    const content = await this._contentModel.findById(id).exec();
    content.payload = contentDto.payload;
    content.type = contentDto.type;
    const newHashtags = this.hashtagService.extractHashtagFromContentPayload(
      contentDto.payload
    );
    //TODO !!! need to improve performance
    await this.hashtagService.updateFromTags(newHashtags, content.hashtags);
    content.hashtags = this.hashtagService.extractHashtagFromContentPayload(
      contentDto.payload
    );
    return content.save();
  };

  /**
   * check content.author.id === user._id
   * @param {User} user
   * @param {Content} content
   * @returns {Promise<boolean>}
   */
  checkUserPermissionForEditContent = async (user: User, content: Content) =>
    content.author.id === user._id;

  /**
   *
   * @param {User} user
   * @param {CastcleQueryOptions} options contain option for sorting page = skip + 1,
   * @returns {Promise<{items:Content[], total:number, pagination: {Pagination}}>}
   */
  getContentsFromUser = async (
    userId: string,
    options: CastcleContentQueryOptions = DEFAULT_CONTENT_QUERY_OPTIONS
  ) => {
    let findFilter: FilterQuery<Content> = {
      'author.id': typeof userId === 'string' ? Types.ObjectId(userId) : userId,
      visibility: EntityVisibility.Publish,
    };
    if (options.type) findFilter.type = options.type;
    findFilter = createCastcleFilter(findFilter, options);
    const query = this._contentModel.find(findFilter).limit(options.maxResults);
    const totalDocument = await this._contentModel
      .countDocuments(findFilter)
      .exec();

    if (options.sortBy.type === 'desc') {
      console.log('sort');
      return {
        total: totalDocument,
        items: await query.sort(`-${options.sortBy.field}`).exec(),
        pagination: createPagination(options, totalDocument),
      };
    } else
      return {
        total: totalDocument,
        items: await query.sort(`${options.sortBy.field}`).exec(),
        pagination: createPagination(options, totalDocument),
      };
  };

  getContentRevisions = async (content: Content) =>
    this._revisionModel
      .find({
        objectRef: {
          $ref: 'content',
          $id: content._id,
        },
      })
      .exec();

  likeContent = async (content: Content, user: User) => {
    let engagement = await this._engagementModel.findOne({
      user: user._id,
      targetRef: {
        $ref: 'content',
        $id: content._id,
      },
      type: EngagementType.Like,
    });
    if (!engagement)
      engagement = new this._engagementModel({
        type: EngagementType.Like,
        user: user._id,
        targetRef: {
          $ref: 'content',
          $id: content._id,
        },
        visibility: EntityVisibility.Publish,
      });
    engagement.type = EngagementType.Like;
    engagement.visibility = EntityVisibility.Publish;
    return engagement.save();
  };

  unLikeContent = async (content: Content, user: User) => {
    const engagement = await this._engagementModel
      .findOne({
        user: user._id,
        targetRef: {
          $ref: 'content',
          $id: content._id,
        },
        type: EngagementType.Like,
      })
      .exec();
    if (!engagement) return null;
    return engagement.remove();
  };

  getContentEngagement = async (
    content: Content,
    engagementType: EngagementType,
    user: User
  ) => {
    const engagement = await this._engagementModel
      .findOne({
        user: user._id,
        targetRef: {
          $ref: 'content',
          $id: content._id,
        },
        type: engagementType,
        visibility: EntityVisibility.Publish,
      })
      .exec();
    return engagement;
  };

  getCommentEngagement = async (
    comment: Comment,
    engagementType: EngagementType,
    user: User
  ) => {
    const engagement = await this._engagementModel
      .findOne({
        user: user._id,
        targetRef: {
          $ref: 'comment',
          $id: comment._id,
        },
        type: engagementType,
        visibility: EntityVisibility.Publish,
      })
      .exec();
    return engagement;
  };

  /**
   * get how many user like this content by populate user from engagement and filter it with user._id
   * @param {Content} content current content
   * @param {User} user current user
   * @returns {liked:boolean, participant:string[]}
   */
  getLikeParticipants = async (content: Content, user: User) => {
    //get whether use is like
    const likeResult = await this._engagementModel
      .find({
        targetRef: {
          $ref: 'content',
          $id: content._id,
        },
        type: EngagementType.Like,
        visibility: EntityVisibility.Publish,
      })
      .populate('user')
      .exec();
    const liked = likeResult.find(
      (engagement) => engagement.user._id === user._id
    )
      ? true
      : false;
    const participants = likeResult.map((eng) => eng.user.displayName);
    return { liked, participants };
  };

  /**
   * transform User => Author object for create a content and use as DTO
   * @private
   * @param {User} user
   * @returns {Author}
   */
  _getAuthorFromUser = (user: User) => {
    return new Author({
      id: user._id,
      avatar: user.profile?.images?.avatar || null,
      castcleId: user.displayId,
      displayName: user.displayName,
      type: user.type === UserType.Page ? UserType.Page : UserType.People,
      verified: user.verified,
    });
  };

  /**
   * Create a short content from other content
   * @param {Content} content
   * @param {User} user
   * @param {string} message
   * @returns {Content, Engagement}
   */
  quoteContentFromUser = async (
    content: Content,
    user: User,
    message?: string
  ) => {
    const author = this._getAuthorFromUser(user);
    const sourceContentId =
      content.isRecast || content.isQuote
        ? content.originalPost._id
        : content._id;
    /*const sourceContentId =
      content.type === ContentType.Recast || content.type === ContentType.Quote
        ? (content.payload as RecastPayload).source
        : content._id;*/
    const newContent = {
      author: author,
      payload: {
        message: message,
      } as ShortPayload,
      revisionCount: 0,
      type: ContentType.Short,
      isQuote: true,
      originalPost:
        content.isQuote || content.isRecast ? content.originalPost : content,
    } as Content;
    const quoteContent = await new this._contentModel(newContent).save();
    const engagement = await new this._engagementModel({
      type: EngagementType.Quote,
      user: user._id,
      targetRef: {
        $ref: 'content',
        $id: sourceContentId,
      },
      itemId: quoteContent._id,
      visibility: EntityVisibility.Publish,
    }).save();
    return { quoteContent, engagement };
  };

  /**
   * Recast a content
   * @param {Content} content
   * @param {User} user
   * @returns {Content, Engagement}
   */
  recastContentFromUser = async (content: Content, user: User) => {
    const author = this._getAuthorFromUser(user);
    const sourceContentId =
      content.isRecast || content.isQuote
        ? content.originalPost._id
        : content._id;
    /*const sourceContentId =
      content.is === ContentType.Recast || content.type === ContentType.Quote
        ? (content.payload as RecastPayload).source
        : content._id;*/
    const newContent = {
      author: author,
      payload: {} as ShortPayload,
      revisionCount: 0,
      type: ContentType.Short,
      originalPost:
        content.isQuote || content.isRecast ? content.originalPost : content,
      isRecast: true,
    } as Content;
    const recastContent = await new this._contentModel(newContent).save();
    const engagement = await new this._engagementModel({
      type: EngagementType.Recast,
      user: user._id,
      targetRef: {
        $ref: 'content',
        $id: sourceContentId,
      },
      itemId: recastContent._id,
      visibility: EntityVisibility.Publish,
    }).save();
    return { recastContent, engagement };
  };

  /**
   * Get content this was meant to give to admin only
   * @param {CastcleContentQueryOptions} options
   * @returns
   */
  getContentsForAdmin = async (
    options: CastcleContentQueryOptions = DEFAULT_CONTENT_QUERY_OPTIONS
  ) => {
    let findFilter: any = {
      visibility: EntityVisibility.Publish,
    };
    if (options.type) findFilter.type = options.type;
    findFilter = createCastcleFilter(findFilter, options);
    const query = this._contentModel.find(findFilter).limit(options.maxResults);
    const items =
      options.sortBy.type === 'desc'
        ? await query.sort(`-${options.sortBy.field}`).exec()
        : await query.sort(`${options.sortBy.field}`).exec();
    return {
      items,
      includes: new CastcleIncludes({
        users: items.map(({ author }) => author),
      }),
      meta: createCastcleMeta(items),
    };
  };

  /**
   * Update Comment Engagement from Content or Comment
   * @param {Comment} comment
   */
  _updateCommentCounter = async (comment: Comment, commentBy?: any) => {
    if (![CommentType.Comment, CommentType.Reply].includes(comment.type)) {
      return true;
    }

    const query: FilterQuery<Engagement> = {
      type: EngagementType.Comment,
      targetRef: {
        $ref: comment.type === CommentType.Comment ? 'content' : 'comment',
        $id: comment.targetRef.$id ?? comment.targetRef.oid,
      },
    };

    if (comment.visibility === EntityVisibility.Publish) {
      await new this._engagementModel({
        ...query,
        visibility: EntityVisibility.Publish,
        user: commentBy,
      }).save();
    } else {
      const engagements = await this._engagementModel.find(query).exec();

      await Promise.all(engagements.map((engagement) => engagement.remove()));
    }

    return true;
  };

  /**
   * Creat a comment for content
   * @param {User} author
   * @param {Content} content
   * @param {UpdateCommentDto} updateCommentDto
   * @returns {Promise<Comment>}
   */
  createCommentForContent = async (
    author: User,
    content: Content,
    updateCommentDto: UpdateCommentDto
  ) => {
    const dto = {
      author: author as User,
      message: updateCommentDto.message,
      targetRef: {
        $id: content._id,
        $ref: 'content',
      },
      type: CommentType.Comment,
    } as CommentDto;

    const comment = new this._commentModel(dto);

    comment.hashtags = this.hashtagService.extractHashtagFromCommentDto(dto);

    await Promise.all([
      this.hashtagService.createFromTags(comment.hashtags),
      comment.save(),
    ]);

    await this._updateCommentCounter(comment, author._id);

    return comment;
  };

  /**
   * Create a comment for comment(reply)
   * @param {User} author
   * @param {Comment} rootComment
   * @param {UpdateCommentDto} updateCommentDto
   * @returns {Promise<Comment>}
   */
  replyComment = async (
    author: User,
    rootComment: Comment,
    updateCommentDto: UpdateCommentDto
  ) => {
    const dto = {
      author: author as User,
      message: updateCommentDto.message,
      targetRef: {
        $id: rootComment._id,
        $ref: 'comment',
      },
      type: CommentType.Reply,
    } as CommentDto;
    const newComment = new this._commentModel(dto);
    newComment.hashtags = this.hashtagService.extractHashtagFromCommentDto(dto);
    await this.hashtagService.createFromTags(newComment.hashtags);
    const comment = await newComment.save();
    await this._updateCommentCounter(comment, author._id);
    return comment;
  };

  /**
   *
   * @param {Comment} rootComment
   * @param {UpdateCommentDto} updateCommentDto
   * @returns {Comment}
   */
  updateComment = async (
    rootComment: Comment,
    updateCommentDto: UpdateCommentDto
  ) => {
    const comment = await this._commentModel.findById(rootComment._id);
    comment.message = updateCommentDto.message;
    const tags = this.hashtagService.extractHashtagFromText(
      updateCommentDto.message
    );
    await this.hashtagService.updateFromTags(tags, comment.hashtags);
    comment.hashtags = tags;
    return comment.save();
  };

  /**
   *
   * @param {Comment} rootComment
   * @returns {Comment}
   */
  deleteComment = async (rootComment: Comment) => {
    const comment = await this._commentModel.findById(rootComment._id);
    comment.visibility = EntityVisibility.Deleted;
    const result = comment.save();
    if (comment.hashtags)
      await this.hashtagService.removeFromTags(comment.hashtags);
    this._updateCommentCounter(comment);
    return result;
  };

  /**
   * Update Engagement.like of the comment
   * @param {User} user
   * @param {Comment} comment
   * @returns  {Engagement}
   */
  likeComment = async (user: User, comment: Comment) => {
    let engagement = await this._engagementModel.findOne({
      user: user._id,
      targetRef: {
        $ref: 'comment',
        $id: comment._id,
      },
      type: EngagementType.Like,
    });
    if (!engagement)
      engagement = new this._engagementModel({
        type: EngagementType.Like,
        user: user._id,
        targetRef: {
          $ref: 'comment',
          $id: comment._id,
        },
        visibility: EntityVisibility.Publish,
      });
    engagement.type = EngagementType.Like;
    engagement.visibility = EntityVisibility.Publish;
    return engagement.save();
  };

  /**
   * Update Engagement.like of the comment
   * @param {User} user
   * @param {Comment} comment
   * @returns  {Engagement}
   */
  unlikeComment = async (user: User, comment: Comment) => {
    const engagement = await this._engagementModel
      .findOne({
        user: user._id,
        targetRef: {
          $ref: 'comment',
          $id: comment._id,
        },
        type: EngagementType.Like,
      })
      .exec();
    if (!engagement) return null;
    return engagement.remove();
  };

  /**
   * get content by id that visibility = equal true
   * @param commentId
   * @returns
   */
  getCommentById = async (commentId: string) =>
    this._commentModel
      .findOne({ _id: commentId, visibility: EntityVisibility.Publish })
      .exec();

  /**
   * Get all engagement that this user engage to content (like, cast, recast, quote)
   * @param {Content} content
   * @param {User} user
   * @returns {Engagement[]}
   */
  getAllEngagementFromContentAndUser = async (content: Content, user: User) =>
    this._engagementModel
      .find({
        targetRef: { $ref: 'content', $id: content._id },
        user: user._id,
      })
      .exec();

  /**
   * Get all engagement that this user engage to contents (like, cast, recast, quote)
   * @param {Content[]} contents
   * @param {User} userId
   * @returns {Engagement[]}
   */
  getAllEngagementFromContentsAndUser = async (
    contents: Content[],
    userId: string
  ) => {
    const contentIds = contents.map((c) => c._id);
    console.debug('contentIds', contentIds);
    return this.getAllEngagementFromContentIdsAndUser(contentIds, userId);
  };

  /**
   *
   * @param contentIds
   * @param {string} userId
   * @returns
   */
  getAllEngagementFromContentIdsAndUser = async (
    contentIds: any[],
    userId: string
  ) => {
    return this._engagementModel
      .find({
        targetRef: {
          $in: contentIds.map((id) => ({
            $ref: 'content',
            $id: id,
          })),
        },
        user: userId as any,
      })
      .exec();
  };

  /**
   * Get all engagement that this user engage to comment (like, cast, recast, quote)
   * @param {Comment} comment
   * @param {User} user
   * @returns  {Engagement[]}
   */
  getAllEngagementFromCommentAndUser = async (comment: Comment, user: User) =>
    this._engagementModel
      .find({
        targetRef: { $ref: 'comment', $id: comment._id },
        user: user._id,
      })
      .exec();

  /**
   *
   * @param {User} author
   * @param {User} viewer
   * @returns {Promise<FeedItem[]>}
   */
  //[deprecate]
  /*createFeedItemFromAuthorToViewer = async (author: User, viewer: User) => {
    const contents = await this._contentModel
      .find({ 'author.id': author._id, visibility: EntityVisibility.Publish })
      .exec();
    const promisesFeedItem = contents.map((content) =>
      new this._feedItemModel({
        called: false,
        viewer: viewer,
        content: content._id,
        aggregator: {
          createTime: new Date(),
          following: true,
        } as ContentAggregator,
      } as FeedItemDto).save()
    );
    return await Promise.all(promisesFeedItem);
  };*/

  /**
   * Convert content => feedItem to group of viewers
   * @param {Content} content
   * @param {Account[]} viewers
   * @returns {Promise<FeedItem[]>}
   */
  //[deprecate]
  _createFeedItemFromAuthorToViewers = async (
    content: Content,
    viewers: Account[]
  ) => {
    const promisesFeedItem = viewers.map((viewer) => {
      return new this._feedItemModel({
        calledAt: new Date(),
        viewer: viewer,
        content: content._id,
        aggregator: {
          createTime: new Date(),
          following: true,
        } as ContentAggregator,
      } as FeedItemDto).save();
    });
    const result = await Promise.all(promisesFeedItem);
    console.debug('result feed ', result);
    return result;
  };

  /**
   * Create a feed item to every user in the system
   * @param {Content} content
   * @returns {Promise<FeedItem[]>}
   */
  //[deprecate]
  createFeedItemFromAuthorToEveryone = async (content: Content) => {
    //TODO !!! should do pagination later on
    const viewers = await this._accountModel.find().exec();
    console.debug('publish to ', viewers);
    return this._createFeedItemFromAuthorToViewers(content, viewers);
  };

  /**
   * Create a feed item to every user in the system
   * @param {ObjectId} contentId
   * @returns {Promise<FeedItem[]>}
   */
  //[deprecate]
  /*
  createFeedItemFromAuthorIdToEveryone = async (contentId: any) => {
    const content = await this._contentModel.findById(contentId).exec();
    console.debug('create feed with content', content);
    return this.createFeedItemFromAuthorToEveryone(content);
  };*/

  /**
   *
   * @param {ObjectId} authorId
   * @param {ObjectId}  viewerId
   * @returns {Promise<FeedItem[]>}
   */ //[deprecate]
  /*
  createFeedItemFromAuthorIdToViewerId = async (
    authorId: any,
    viewerId: any
  ) => {
    const author = await this._userModel.findById(authorId).exec();
    const viewer = await this._userModel.findById(viewerId).exec();
    return this.createFeedItemFromAuthorToViewer(author, viewer);
  };*/

  /**
   *
   * @param contentId
   * @returns {GuestFeedItem}
   */
  createGuestFeedItemFromAuthorId = async (contentId: any) => {
    const newGuestFeedItem = new this._guestFeedItemModel({
      score: 0,
      type: GuestFeedItemType.Content,
      content: contentId,
    } as GuestFeedItemDto);
    newGuestFeedItem.__v = 2;
    return newGuestFeedItem.save();
  };

  async reportContent(user: User, content: Content, message: string) {
    if (!content) throw CastcleException.CONTENT_NOT_FOUND;

    const engagementFilter = {
      user: user._id,
      targetRef: { $ref: 'content', $id: content._id },
      type: EngagementType.Report,
    };

    await this._engagementModel
      .updateOne(
        engagementFilter,
        { ...engagementFilter, visibility: EntityVisibility.Publish },
        { upsert: true }
      )
      .exec();

    const mail = await this.transporter.sendMail({
      from: 'castcle-noreply" <no-reply@castcle.com>',
      subject: `Report content: ${content._id}`,
      to: Environment.SMTP_ADMIN_EMAIL,
      text: `Content: ${content._id} has been reported.
Author: ${content.author.displayName} (${content.author.id})
Body: ${JSON.stringify(content.payload, null, 2)}

ReportedBy: ${user.displayName} (${user._id})
Message: ${message}`,
    });

    this.logger.log(`Report has been submitted ${mail.messageId}`);
  }

  /**
   * @param {User} viewer
   * @param {Content} content
   * @param {Engagement[]} engagements
   */
  async convertContentToContentResponse(
    viewer: User,
    content: Content,
    engagements: Engagement[] = [],
    hasRelationshipExpansion = false
  ) {
    const users: IncludeUser[] = [];
    const authorIds = [];
    const engagementsOriginal = content.originalPost
      ? await this.getAllEngagementFromContentIdsAndUser(
          [content.originalPost?._id],
          viewer?.id
        )
      : [];
    const casts = content.originalPost
      ? [toSignedContentPayloadItem(content.originalPost, engagementsOriginal)]
      : [];

    if (content.author) {
      users.push(new Author(content.author));
      authorIds.push(content.author.id);
    }

    if (content.originalPost?.author) {
      users.push(new Author(content.originalPost.author));
      authorIds.push(content.originalPost.author.id);
    }

    if (hasRelationshipExpansion) {
      await this.updateUserRelationships(viewer, authorIds, users);
    }

    return {
      payload: content.toContentPayloadItem(engagements),
      includes: new CastcleIncludes({ casts, users }),
    } as ContentResponse;
  }

  /**
   * @param {User} viewer
   * @param {Content} content
   * @param {CastcleMeta} meta
   * @param hasRelationshipExpansion
   */
  async convertContentsToContentsResponse(
    viewer: User | null,
    contents: Content[],
    hasRelationshipExpansion = false
  ): Promise<ContentsResponse> {
    const meta = createCastcleMeta(contents);
    const users: IncludeUser[] = [];
    const authorIds = [];
    const casts: ContentPayloadItem[] = [];
    const payload: ContentPayloadItem[] = [];
    const engagements = await this.getAllEngagementFromContentsAndUser(
      contents,
      viewer?.id
    );

    contents.forEach((content) => {
      const contentEngagements = engagements.filter(
        (engagement) =>
          String(engagement.targetRef.$id) === String(content.id) ||
          String(engagement.targetRef.oid) === String(content.id)
      );

      payload.push(content.toContentPayloadItem(contentEngagements));

      if (content.originalPost) {
        casts.push(toSignedContentPayloadItem(content.originalPost));
      }

      if (content.originalPost?.author) {
        users.push(new Author(content.originalPost.author).toIncludeUser());
        authorIds.push(content.originalPost.author.id);
      }

      if (content.author) {
        users.push(new Author(content.author).toIncludeUser());
        authorIds.push(content.author.id);
      }
    });

    if (hasRelationshipExpansion) {
      await this.updateUserRelationships(viewer, authorIds, users);
    }

    return {
      payload,
      includes: new CastcleIncludes({ users, casts }),
      meta,
    };
  }

  /**
   * Get Content from orginal post
   * @param {string} originalPostId
   * @param {number} maxResults
   * @param {string} sinceId
   * @param {string} untilId
   * @returns {Content[], totalDocument}
   */
  getContentFromOriginalPost = async (
    originalPostId: string,
    maxResults: number,
    sinceId?: string,
    untilId?: string
  ) => {
    let filter: FilterQuery<Content> = {
      'originalPost._id': mongoose.Types.ObjectId(originalPostId),
    };
    const totalDocument = await this._contentModel
      .countDocuments(filter)
      .exec();
    if (sinceId) {
      filter = {
        ...filter,
        'author.id': {
          $gt: mongoose.Types.ObjectId(sinceId),
        },
      };
    } else if (untilId) {
      filter = {
        ...filter,
        'author.id': {
          $lt: mongoose.Types.ObjectId(untilId),
        },
      };
    }
    const result = await this._contentModel
      .find(filter)
      .limit(maxResults)
      .sort({ createdAt: -1 })
      .exec();

    return {
      total: totalDocument,
      items: result,
    };
  };

  private async updateUserRelationships(
    viewer: User,
    authorIds: any[],
    users: IncludeUser[]
  ) {
    const relationships = viewer
      ? await this.relationshipModel.find({
          $or: [
            { user: viewer._id, followedUser: { $in: authorIds } },
            { user: { $in: authorIds }, followedUser: viewer._id },
          ],
          visibility: EntityVisibility.Publish,
        })
      : [];

    users.forEach((author) => {
      const authorRelationship = relationships.find(
        ({ followedUser, user }) =>
          String(user) === String(author.id) &&
          String(followedUser) === String(viewer?.id)
      );

      const getterRelationship = relationships.find(
        ({ followedUser, user }) =>
          String(followedUser) === String(author.id) &&
          String(user) === String(viewer?.id)
      );

      author.blocked = Boolean(getterRelationship?.blocking);
      author.blocking = Boolean(authorRelationship?.blocking);
      author.followed = Boolean(getterRelationship?.following);
    });
  }

  getSearchRecent({
    contentType,
    keyword,
    maxResults,
    sinceId,
    untilId,
  }: GetSearchRecentDto) {
    const query = createFilterQuery<Content>(sinceId, untilId);

    if (contentType) query[`payload.${contentType}`] = { $exists: true };
    if (keyword) {
      const pattern = CastcleRegExp.fromString(keyword, { exactMatch: false });

      query.$or = [{ 'payload.message': pattern }, { hashtags: pattern }];
    }

    return this.getContents(query, maxResults);
  }

  async getContents(query: FilterQuery<Content>, maxResults: number) {
    const total = await this._contentModel.countDocuments(query);
    const contents = total
      ? await this._contentModel
          .find(query)
          .limit(maxResults)
          .sort({ createdAt: SortDirection.DESC })
      : [];

    return { contents, meta: Meta.fromDocuments(contents, total) };
  }
}
