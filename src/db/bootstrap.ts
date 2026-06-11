import { getMeta, setMeta } from './schema';
import { newId } from './ids';
import { seedIfEmpty } from './seed';

export const SCHEMA_VERSION = 1;

/** Ensure deviceId + schemaVersion exist and the Welcome board is seeded. */
export async function bootstrapDb(): Promise<{ deviceId: string }> {
  let deviceId = await getMeta<string>('deviceId');
  if (!deviceId) {
    deviceId = newId();
    await setMeta('deviceId', deviceId);
  }
  const schemaVersion = await getMeta<number>('schemaVersion');
  if (schemaVersion === undefined) {
    await setMeta('schemaVersion', SCHEMA_VERSION);
  }
  await seedIfEmpty();
  return { deviceId };
}
