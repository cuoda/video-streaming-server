import { Test, TestingModule } from '@nestjs/testing';
import { ApiKeyController } from './api-key.controller';
import { ApiKeyService } from '../services/api-key.service';
import { ClerkAuthGuard } from '../guards/clerk.guard';

describe('ApiKeyController', () => {
  let controller: ApiKeyController;
  let serviceMock: any;

  beforeEach(async () => {
    serviceMock = {
      createApiKey: jest.fn(),
      listApiKeys: jest.fn(),
      deleteApiKeys: jest.fn(),
      regenerateApiKey: jest.fn(),
      getApiKeyLastUsed: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [ApiKeyController],
      providers: [
        {
          provide: ApiKeyService,
          useValue: serviceMock,
        },
      ],
    })
      .overrideGuard(ClerkAuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get<ApiKeyController>(ApiKeyController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('createApiKey', () => {
    it('should call service.createApiKey with user id', async () => {
      const req = { user: { id: 'user_123' } };
      serviceMock.createApiKey.mockResolvedValueOnce({ key: 'plaintext_key' });

      const result = await controller.createApiKey(req);

      expect(serviceMock.createApiKey).toHaveBeenCalledWith('user_123');
      expect(result).toEqual({ key: 'plaintext_key' });
    });
  });

  describe('listApiKeys', () => {
    it('should call service.listApiKeys with user id', async () => {
      const req = { user: { id: 'user_123' } };
      const mockKeys = [{ id: '1', prefix: 'VMX_...' }];
      serviceMock.listApiKeys.mockResolvedValueOnce(mockKeys);

      const result = await controller.listApiKeys(req);

      expect(serviceMock.listApiKeys).toHaveBeenCalledWith('user_123');
      expect(result).toEqual(mockKeys);
    });
  });

  describe('apiKeyLastUsed', () => {
    it('should call service.getApiKeyLastUsed with key id', async () => {
      const id = 'key_123';
      const lastUsedAt = new Date();
      serviceMock.getApiKeyLastUsed.mockResolvedValueOnce(lastUsedAt);

      const result = await controller.apiKeyLastUsed(id);

      expect(serviceMock.getApiKeyLastUsed).toHaveBeenCalledWith(id);
      expect(result).toEqual(lastUsedAt);
    });
  });

  describe('deleteApiKeys', () => {
    it('should call service.deleteApiKeys with user id and key id', async () => {
      const req = { user: { id: 'user_123' } };
      const id = 'key_123';
      serviceMock.deleteApiKeys.mockResolvedValueOnce(undefined);

      await controller.deleteApiKeys(req, id);

      expect(serviceMock.deleteApiKeys).toHaveBeenCalledWith('user_123', id);
    });
  });

  describe('regenerateApiKey', () => {
    it('should call service.regenerateApiKey with user id and key id', async () => {
      const req = { user: { id: 'user_123' } };
      const id = 'key_123';
      serviceMock.regenerateApiKey.mockResolvedValueOnce({
        key: 'new_plaintext_key',
      });

      const result = await controller.regenerateApiKey(req, id);

      expect(serviceMock.regenerateApiKey).toHaveBeenCalledWith('user_123', id);
      expect(result).toEqual({ key: 'new_plaintext_key' });
    });
  });
});
