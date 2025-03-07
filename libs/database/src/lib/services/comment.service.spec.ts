import { UserProducer } from '@castcle-api/utils/queue';
import { MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { MongooseAsyncFeatures, MongooseForFeatures } from '../database.module';
import { ContentType } from '../dtos';
import { Comment, Content, User } from '../schemas';
import { AuthenticationService } from './authentication.service';
import { CommentService } from './comment.service';
import { ContentService } from './content.service';
import { HashtagService } from './hashtag.service';
import { UserService } from './user.service';

describe('ContentService', () => {
  let mongod: MongoMemoryServer;
  let app: TestingModule;
  let service: CommentService;
  let authService: AuthenticationService;
  let contentService: ContentService;
  let userService: UserService;
  let comment: Comment;
  let content: Content;
  let user: User;

  beforeAll(async () => {
    mongod = await MongoMemoryServer.create();
    app = await Test.createTestingModule({
      imports: [
        MongooseModule.forRoot(mongod.getUri()),
        MongooseAsyncFeatures,
        MongooseForFeatures,
      ],
      providers: [
        AuthenticationService,
        CommentService,
        ContentService,
        HashtagService,
        UserProducer,
        UserService,
      ],
    }).compile();

    authService = app.get(AuthenticationService);
    contentService = app.get(ContentService);
    service = app.get(CommentService);
    userService = app.get(UserService);

    const result = await authService.createAccount({
      deviceUUID: 'test-uuid',
      languagesPreferences: ['th', 'th'],
      header: { platform: 'ios' },
      device: 'test',
    });

    await authService.signupByEmail(result.accountDocument, {
      displayId: 'sp',
      displayName: 'sp002',
      email: 'sompop.kulapalanont@gmail.com',
      password: 'test1234567',
    });

    user = await userService.getUserFromCredential(result.credentialDocument);
    content = await contentService.createContentFromUser(user, {
      payload: { message: 'hi' },
      type: ContentType.Short,
      castcleId: user.displayId,
    });

    comment = await contentService.createCommentForContent(user, content, {
      message: 'Hello #hello',
    });
  });

  afterAll(async () => {
    await app.close();
    await mongod.stop();
  });

  describe('#convertCommentToCommentResponse', () => {
    it('should return comment in type of CommentResponse', async () => {
      const response = await service.convertCommentToCommentResponse(
        user,
        comment,
        [],
        { hasRelationshipExpansion: false }
      );

      expect(response.author.followed).toBeUndefined();
      expect(response.metrics.likeCount).toEqual(
        comment.engagements.like.count
      );
    });

    it('should return comment in type of CommentResponse with relationships', async () => {
      const response = await service.convertCommentToCommentResponse(
        user,
        comment,
        [],
        { hasRelationshipExpansion: true }
      );

      expect(response.author.followed).toBeDefined();
    });
  });

  describe('#getCommentsByContentId()', () => {
    it('should get comment and reply from content', async () => {
      const comments = await service.getCommentsByContentId(user, content._id);

      expect(comments.meta.resultCount).toEqual(1);
    });
  });
});
