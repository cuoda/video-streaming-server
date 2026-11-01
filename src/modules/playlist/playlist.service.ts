import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DRIZZLE_DB } from 'src/database/database.module';
import { count, max, eq, and } from 'drizzle-orm';
import { playlist } from 'src/database/schema';
import { CreatePlaylistDto } from './dto/create-playlist.dto';
import { DEFAULT_PLAYLIST_LIMIT } from 'src/configs/constant-global';
import { Playlist } from 'src/interfaces/create-playlist.interface';

@Injectable()
export class playlistService {
  constructor(@Inject(DRIZZLE_DB) private readonly db: any) {}

  async create(userId: string, dto: CreatePlaylistDto) {
    const [result] = await this.db
      .select({
        count: count(),
        limit: max(playlist.limit),
      })
      .from(playlist)
      .where(eq(playlist.user_id, userId));

    const effectiveLimit = result?.limit ?? DEFAULT_PLAYLIST_LIMIT;

    if (result.count >= effectiveLimit) {
      throw new BadRequestException(
        'You have reached the maximum limit of playlists. Please contact support teams for creating more playlists.',
      );
    }

    const [created] = await this.db
      .insert(playlist)
      .values({
        user_id: userId,
        name: dto.name,
        description: dto.description,
        created_at: new Date(),
      })
      .returning();

    return created as Playlist;
  }

  async findAll(userId: string) {
    return this.db.select().from(playlist).where(eq(playlist.user_id, userId));
  }

  async findOne(userId: string, id: string) {
    const record = await this.db.query.playlist.findFirst({
      where: (p: typeof playlist) => and(eq(p.id, id), eq(p.user_id, userId)),
      columns: {
        id: true,
        name: true,
        description: true,
        limit: true,
        totalVideos: true,
        created_at: true,
        updated_at: true,
      },
    });
    if (!record) {
      throw new NotFoundException('Playlist not found');
    }
    return record;
  }

  async update(userId: string, id: string, dto: CreatePlaylistDto) {
    const [updated] = await this.db
      .update(playlist)
      .set({
        name: dto.name,
        description: dto.description,
        updated_at: new Date(),
      })
      .where(and(eq(playlist.id, id), eq(playlist.user_id, userId)))
      .returning();

    if (!updated) {
      throw new NotFoundException('Playlist not found');
    }

    return updated as Playlist;
  }

  async delete(userId: string, id: string) {
    const [deleted] = await this.db
      .delete(playlist)
      .where(and(eq(playlist.id, id), eq(playlist.user_id, userId)))
      .returning();

    if (!deleted) {
      throw new NotFoundException('Playlist not found');
    }

    return deleted;
  }
}
