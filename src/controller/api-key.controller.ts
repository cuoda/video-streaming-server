import {
  Controller,
  Get,
  Post,
  Param,
  Delete,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiKeyService } from '../services/api-key.service';
import { ClerkAuthGuard } from 'src/guards/clerk.guard';

@Controller('api-key')
@ApiTags('API Keys')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiOperation({
    summary: 'Create a new API key',
  })
  async createApiKey(@Req() req: any) {
    return this.apiKeyService.createApiKey(req.user?.id);
  }

  @Get()
  @ApiOperation({
    summary: 'Get all API keys',
  })
  async listApiKeys(@Req() req: any): Promise<any[]> {
    return Promise.resolve<any[]>(
      await this.apiKeyService.listApiKeys(req.user?.id),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'API keys last used',
  })
  async apiKeyLastUsed(@Req() req: any, @Param('id') id: string): Promise<any> {
    return this.apiKeyService.getApiKeyLastUsed(req.user?.id, id);
  }

  @Delete(':id')
  @ApiOperation({
    summary: 'Revoke (Delete) an API keys',
  })
  async deleteApiKeys(@Req() req: any, @Param('id') id: string) {
    return this.apiKeyService.deleteApiKeys(req.user?.id, id);
  }

  @Post(':id/regenerate')
  @ApiOperation({
    summary: 'Regenerate an API key',
  })
  async regenerateApiKey(@Req() req: any, @Param('id') id: string) {
    return this.apiKeyService.regenerateApiKey(req.user?.id, id);
  }
}
