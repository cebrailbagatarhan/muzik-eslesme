export type Config = {
  mode: 'demo' | 'beta'; host: string; port: number; databaseUrl: string; dataDir: string;
  redisUrl: string; origins: string[]; dataKey: string; mediaKey: string; minRatings: number;
  spotifyEnabled: boolean; spotifyClientId: string; spotifyRedirectUri: string; spotifyAllowlist: string[];
  ageSecret: string; scannerUrl: string; scannerToken: string; authDeliveryUrl: string; authDeliveryToken: string; rateMultiplier: number;
};
export function readConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const mode = env.APP_MODE ?? 'demo';
  if (!['demo','beta'].includes(mode)) throw new Error('APP_MODE demo veya beta olmalı.');
  const c: Config = {
    mode: mode as Config['mode'], host: env.HOST ?? '127.0.0.1', port: Number(env.PORT ?? 4000),
    databaseUrl: env.DATABASE_URL ?? '', dataDir: env.PGLITE_DATA_DIR ?? '../../data/postgres',
    redisUrl: env.REDIS_URL ?? '', origins: (env.ALLOWED_ORIGINS ?? 'http://localhost:8081').split(',').map(v=>v.trim()).filter(Boolean),
    dataKey: env.DATA_ENCRYPTION_KEY ?? '', mediaKey: env.MEDIA_SIGNING_KEY ?? '',
    minRatings: Number(env.MIN_MUSIC_RATINGS ?? 20), spotifyEnabled: env.SPOTIFY_ENABLED === 'true',
    spotifyClientId: env.SPOTIFY_CLIENT_ID ?? '', spotifyRedirectUri: env.SPOTIFY_REDIRECT_URI ?? '',
    spotifyAllowlist: (env.SPOTIFY_ALLOWED_USER_IDS ?? '').split(',').map(v=>v.trim()).filter(Boolean),
    ageSecret: env.AGE_WEBHOOK_SECRET ?? '', scannerUrl: env.PHOTO_SCANNER_URL ?? '',
    scannerToken: env.PHOTO_SCANNER_TOKEN ?? '', authDeliveryUrl: env.AUTH_DELIVERY_URL ?? '',
    authDeliveryToken: env.AUTH_DELIVERY_TOKEN ?? '', rateMultiplier: 1,
  };
  for (const key of [c.dataKey,c.mediaKey]) if (!/^[a-f0-9]{64}$/i.test(key)) throw new Error('32 bayt hex anahtar gerekli. Önce npm run setup çalıştır.');
  if (!Number.isInteger(c.minRatings) || c.minRatings < 20) throw new Error('En az 20 müzik değerlendirmesi gerekir.');
  if (c.mode === 'beta' && (!c.databaseUrl || !c.redisUrl || c.ageSecret.length < 32 || !c.scannerUrl.startsWith('https://') || !c.scannerToken)) {
    throw new Error('Beta için PostgreSQL, Redis, yaş webhook anahtarı ve HTTPS fotoğraf tarayıcısı zorunlu.');
  }
  if (c.mode === 'beta' && (!c.authDeliveryUrl.startsWith('https://') || c.authDeliveryToken.length < 24)) {
    throw new Error('Beta için HTTPS kimlik e-postası teslim webhooku ve güçlü bearer token zorunlu.');
  }
  if (c.mode === 'beta' && c.origins.some(o => !o.startsWith('https://'))) throw new Error('Beta origin adresleri HTTPS olmalı.');
  if (c.spotifyEnabled && (!c.spotifyClientId || !c.spotifyRedirectUri.startsWith('https://') || !c.spotifyAllowlist.length)) {
    throw new Error('Spotify için client id, HTTPS callback ve kullanıcı allowlist gerekli.');
  }
  return c;
}
