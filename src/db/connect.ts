import mongoose from "mongoose";
import { getEnv } from "../config/env.js";

interface MongooseCache {
  conn: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalForMongoose = globalThis as typeof globalThis & {
  mongooseCache?: MongooseCache;
};

const cache: MongooseCache =
  globalForMongoose.mongooseCache ?? { conn: null, promise: null };

if (!globalForMongoose.mongooseCache) {
  globalForMongoose.mongooseCache = cache;
}

export async function connectDb(): Promise<typeof mongoose> {
  if (cache.conn) {
    return cache.conn;
  }
  if (!cache.promise) {
    const { MONGODB_URI } = getEnv();
    cache.promise = mongoose.connect(MONGODB_URI).then((m) => m);
  }
  cache.conn = await cache.promise;
  return cache.conn;
}
