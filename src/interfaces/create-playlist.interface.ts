export type Playlist = {
  id: string;
  user_id: string;
  name: string;
  description: string;
  limit: number;
  totalVideos: number;
  created_at: Date;
  updated_at: Date;
};
