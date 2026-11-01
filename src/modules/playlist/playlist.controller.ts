import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ClerkAuthGuard } from 'src/guards/clerk.guard';
import { playlistService } from './playlist.service';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { UpdatePlaylistDto } from './dto/update-playlist.dto';

@Controller('playlist')
@ApiTags('Playlist')
@UseGuards(ClerkAuthGuard)
@ApiBearerAuth()
export class PlaylistController {
  constructor(private readonly playlistService: playlistService) {}

  @Post()
  @ApiOperation({ summary: 'Create playlist' })
  create(@Req() req: any, @Body() dto: CreatePlaylistDto) {
    return this.playlistService.create(req.userId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'Get all playlists for logged in user' })
  findAll(@Req() req: any) {
    return this.playlistService.findAll(req.user.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a playlist by id' })
  findOne(@Req() req: any, @Param('id') id: string) {
    return this.playlistService.findOne(req.user.id, id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update a playlist by id' })
  update(
    @Req() req: any,
    @Param('id') id: string,
    @Body() dto: UpdatePlaylistDto,
  ) {
    return this.playlistService.update(req.user.id, id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a playlist by id' })
  remove(@Req() req: any, @Param('id') id: string) {
    return this.playlistService.delete(req.user.id, id);
  }
}
