import PocketBase from 'pocketbase';

// Same origin in prod (served from pb_public) and in dev (Vite proxy).
export const pb = new PocketBase('/');
