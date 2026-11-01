import { Module } from '@nestjs/common';
import { PlaylistController } from './playlist.controller';
import { playlistService } from './playlist.service';

@Module({
  controllers: [PlaylistController],
  providers: [playlistService],
  exports: [],
})
export default class PlaylistModule {}
