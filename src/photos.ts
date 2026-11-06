/*
 * The photos of the table, one per player turn, kept on this device (IndexedDB) until the next
 * game starts: the battle report shows them in turn order, and they can be saved all at once.
 * Each photo is kept whole, to be studied later, with a small copy for the thumbnails: a phone
 * would choke decoding ten full-size photos at once.
 */

/** Which player turn a photo closes: the table as that player left it */
export type PhotoTurn = { round: number; player: 1 | 2 };

export type Photo = PhotoTurn & {
  /** The game it belongs to (GameState.gameId) */
  game: string;
  /** When it was taken: the same photo received back from another device is not stored twice */
  at: number;
  full: Blob;
  thumb: Blob;
  /** Taken on this device, rather than received from another one in the room */
  local: boolean;
};

const DB_NAME = "warhammerClock";
const STORE = "photos";
const THUMB_SIDE = 480;

export const photoKey = (game: string, { round, player }: PhotoTurn): string => `${game}_${round}_${player}`;

let opening: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  opening ??= new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }).catch((error: unknown) => {
    opening = null;
    throw error;
  });
  return opening;
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then(
    (base) =>
      new Promise<T>((resolve, reject) => {
        const request = work(base.transaction(STORE, mode).objectStore(STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      }),
  );
}

/** Decoded through an <img>: unlike a bitmap, it applies the camera's orientation everywhere */
async function decode(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
    return img;
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** A JPEG copy whose longest side is at most `side` pixels */
export async function scaled(blob: Blob, side: number, quality: number): Promise<Blob> {
  const img = await decode(blob);
  const k = Math.min(1, side / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * k));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * k));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((out) => (out ? resolve(out) : reject(new Error("toBlob"))), "image/jpeg", quality),
  );
}

export async function savePhoto(game: string, turn: PhotoTurn, full: Blob, at: number, local: boolean): Promise<Photo> {
  const photo: Photo = { game, ...turn, at, full, thumb: await scaled(full, THUMB_SIDE, 0.8), local };
  await run("readwrite", (store) => store.put(photo, photoKey(game, turn)));
  return photo;
}

export function getPhoto(game: string, turn: PhotoTurn): Promise<Photo | undefined> {
  return run<Photo | undefined>("readonly", (store) => store.get(photoKey(game, turn)) as IDBRequest<Photo | undefined>).catch(() => undefined);
}

export function deletePhoto(game: string, turn: PhotoTurn): Promise<void> {
  return run("readwrite", (store) => store.delete(photoKey(game, turn))).then(
    () => undefined,
    () => undefined,
  );
}

/** The game's photos, in no particular order */
export async function gamePhotos(game: string): Promise<Photo[]> {
  if (!game) return [];
  const all = await run<Photo[]>("readonly", (store) => store.getAll() as IDBRequest<Photo[]>).catch(() => []);
  return all.filter((photo) => photo.game === game);
}

/** A new game starts: the photos of the ones before go */
export async function keepOnlyGame(game: string): Promise<void> {
  const keys = await run<IDBValidKey[]>("readonly", (store) => store.getAllKeys()).catch(() => []);
  const stale = keys.filter((key) => !String(key).startsWith(`${game}_`));
  await Promise.all(stale.map((key) => run("readwrite", (store) => store.delete(key)).catch(() => undefined)));
}

/* ---------- Sent to the other devices of an online game ---------- */

/**
 * Sharp enough to read the table, light enough for the database: each device in the room
 * downloads every photo, and that download is what the free plan counts
 */
const SHARE_SIDE = 1280;

export async function shareable(full: Blob): Promise<string> {
  for (const [side, quality] of [
    [SHARE_SIDE, 0.78],
    [1024, 0.7],
    [800, 0.6],
  ] as const) {
    const url = await blobToDataUrl(await scaled(full, side, quality));
    if (url.length < 900_000) return url;
  }
  throw new Error("photo too large");
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export async function dataUrlToBlob(url: string): Promise<Blob> {
  return (await fetch(url)).blob();
}
