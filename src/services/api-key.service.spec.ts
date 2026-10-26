import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyService } from './api-key.service';
import { DRIZZLE_DB } from '../database/database.module';
import { REDIS_CLIENT } from '../infra';
import { BadRequestException } from '@nestjs/common';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let dbMock: any;
  let redisMock: any;

  beforeEach(async () => {
    dbMock = {
      select: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      query: {
        api_key: {
          findFirst: jest.fn(),
        },
      },
    };

    redisMock = {
      del: jest.fn(),
      hget: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ApiKeyService,
        {
          provide: DRIZZLE_DB,
          useValue: dbMock,
        },
        {
          provide: REDIS_CLIENT,
          useValue: redisMock,
        },
      ],
    }).compile();

    service = module.get<ApiKeyService>(ApiKeyService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createApiKey', () => {
    it('should create an api key successfully', async () => {
      const userId = 'user_123';
      dbMock.where.mockResolvedValueOnce([{ count: 0 }]);
      dbMock.values.mockResolvedValueOnce({});

      const result = await service.createApiKey(userId);

      expect(result).toHaveProperty('key');
      expect(result.key).toMatch(/^VMX_[a-f0-9]{32}_/);
      expect(dbMock.insert).toHaveBeenCalled();
    });

    it('should throw BadRequestException if user has 5 or more keys', async () => {
      const userId = 'user_123';
      dbMock.where.mockResolvedValueOnce([{ count: 5 }]);

      await expect(service.createApiKey(userId)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('listApiKeys', () => {
    it('should return a list of api keys', async () => {
      const userId = 'user_123';
      const mockKeys = [{ id: '1', prefix: 'VMX_...' }];
      dbMock.where.mockResolvedValueOnce(mockKeys);

      const result = await service.listApiKeys(userId);

      expect(result).toEqual(mockKeys);
      expect(dbMock.select).toHaveBeenCalled();
    });
  });

  describe('deleteApiKeys', () => {
    it('should delete (revoke) an api key', async () => {
      const userId = 'user_123';
      const keyId = 'key_123';
      dbMock.where.mockResolvedValueOnce({});
      redisMock.del.mockResolvedValueOnce(1);

      await service.deleteApiKeys(userId, keyId);

      expect(dbMock.update).toHaveBeenCalled();
      expect(redisMock.del).toHaveBeenCalled();
    });
  });

  describe('regenerateApiKey', () => {
    it('should regenerate an api key', async () => {
      const userId = 'user_123';
      const keyId = 'key_123';
      dbMock.where.mockResolvedValueOnce({});

      const result = await service.regenerateApiKey(userId, keyId);

      expect(result).toHaveProperty('key');
      expect(dbMock.update).toHaveBeenCalled();
    });
  });

  describe('getApiKeyLastUsed', () => {
    it('should return last used from redis if available', async () => {
      const keyId = 'key_123';
      const now = Date.now();
      redisMock.hget.mockResolvedValueOnce(now.toString());

      const result = await service.getApiKeyLastUsed(keyId);

      expect(result).toEqual({ last_used_at: new Date(now) });
    });

    it('should return last used from db if not in redis', async () => {
      const keyId = 'key_123';
      const lastUsedAt = new Date();
      redisMock.hget.mockResolvedValueOnce(null);
      dbMock.query.api_key.findFirst.mockResolvedValueOnce({
        last_used_at: lastUsedAt,
      });

      const result = await service.getApiKeyLastUsed(keyId);

      expect(result).toEqual(lastUsedAt);
    });
  });
});
